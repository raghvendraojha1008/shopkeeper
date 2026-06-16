import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  writeBatch,
  query,
  limit,
  startAfter,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { AuditService } from './audit';

// FIX: Audit logging is fire-and-forget.  The old implementation awaited every
// audit write inside add/update/delete, which:
//   (a) doubled the perceived latency for every write operation, and
//   (b) doubled Firestore write costs on every mutation.
//
// Audit logs are non-critical — a failure to record an audit entry should never
// block or error the primary operation.  We fire the log asynchronously and
// swallow any rejection (AuditService.log already swallows internally, but the
// outer await was still forcing a serial round-trip).
function auditAsync(...args: Parameters<typeof AuditService.log>) {
  AuditService.log(...args).catch(() => { /* intentionally swallowed */ });
}

/**
 * WRITE TIMEOUT GUARD
 * ─────────────────────────────────────────────────────────────────────────────
 * With persistentLocalCache, every Firestore write lands in local IndexedDB
 * and resolves in < 100 ms regardless of network state.  This timeout now acts
 * as a last-resort sentinel for a genuine IndexedDB lock freeze (e.g. storage
 * quota exceeded, corrupted database).  Under normal conditions it should never
 * fire.  8 s is a generous allowance for first-launch IndexedDB initialisation
 * while being short enough that a real freeze doesn't block the UI for long.
 */
const WRITE_TIMEOUT_MS = 8_000;

function withWriteTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        const err: any = new Error(
          'Save timed out — queued for background sync.',
        );
        err.code = 'WRITE_TIMEOUT';
        reject(err);
      }, WRITE_TIMEOUT_MS),
    ),
  ]);
}

/**
 * Recursively removes undefined values from an object so Firestore never
 * receives `undefined` fields (which it rejects with an error).
 */
function sanitizeForFirestore(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, sanitizeForFirestore(v)])
    );
  }
  return obj;
}

export const ApiService = {
  // --- GENERIC METHODS ---
  getAll: async (uid: string, col: string, constraints: any[] = []) => {
    const q = query(collection(db, `users/${uid}/${col}`), ...constraints);
    return await getDocs(q);
  },

  add: async (
    uid: string,
    col: string,
    data: any,
    auditInfo?: { userEmail?: string; userName?: string },
  ) => {
    const result = await withWriteTimeout(addDoc(collection(db, `users/${uid}/${col}`), sanitizeForFirestore(data)));

    // FIX: fire-and-forget — does not block or add latency to the primary write.
    const itemName = data.name || data.party_name || data.item_name || data.invoice_no || 'Item';
    auditAsync(uid, 'create', col, result.id, `Created ${col.replace('_', ' ')}: ${itemName}`, {
      userEmail: auditInfo?.userEmail,
      userName:  auditInfo?.userName,
      metadata:  { created_data: data },
    });

    return result;
  },

  update: async (
    uid: string,
    col: string,
    id: string,
    data: any,
    auditInfo?: { userEmail?: string; userName?: string; oldData?: any },
  ) => {
    await withWriteTimeout(updateDoc(doc(db, `users/${uid}/${col}`, id), sanitizeForFirestore(data)));

    const itemName = data.name || data.party_name || data.item_name || data.invoice_no || 'Item';
    const changes  = auditInfo?.oldData
      ? AuditService.generateChangeSummary(auditInfo.oldData, data)
      : undefined;

    auditAsync(uid, 'update', col, id, `Updated ${col.replace('_', ' ')}: ${itemName}`, {
      userEmail: auditInfo?.userEmail,
      userName:  auditInfo?.userName,
      changes,
    });
  },

  delete: async (
    uid: string,
    col: string,
    id: string,
    auditInfo?: { userEmail?: string; userName?: string; itemName?: string },
  ) => {
    await withWriteTimeout(deleteDoc(doc(db, `users/${uid}/${col}`, id)));

    auditAsync(uid, 'delete', col, id, `Deleted ${col.replace('_', ' ')}: ${auditInfo?.itemName || id}`, {
      userEmail: auditInfo?.userEmail,
      userName:  auditInfo?.userName,
    });
  },

  getOne: async (uid: string, col: string, id: string) => {
    const snap = await getDoc(doc(db, `users/${uid}/${col}`, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  // Pagination helper
  query: async (uid: string, col: string, constraints: any[] = [], lastDoc: any = null) => {
    let q = query(collection(db, `users/${uid}/${col}`), ...constraints, limit(20));
    if (lastDoc) q = query(q, startAfter(lastDoc));
    return await getDocs(q);
  },

  batchAdd: async (uid: string, items: any[]) => {
    const batch = writeBatch(db);
    items.forEach(item => {
      const { _collection, ...data } = item;
      if (_collection) {
        const ref = doc(collection(db, `users/${uid}/${_collection}`));
        batch.set(ref, sanitizeForFirestore(data));
      }
    });
    return await batch.commit();
  },

  /**
   * Execute multiple add/update operations as a SINGLE Firestore WriteBatch.
   * One IndexedDB transaction instead of N separate round-trips — dramatically
   * faster on Android WebView which serializes IndexedDB transactions.
   * Returns an array (same order as input) with { type, id } for each op.
   */
  batchSave: async (
    uid: string,
    operations: Array<{ type: 'add' | 'update'; col: string; data: any; id?: string }>,
  ): Promise<{ type: string; id: string }[]> => {
    if (operations.length === 0) return [];
    const batch = writeBatch(db);
    const results: { type: string; id: string }[] = [];
    for (const op of operations) {
      if (op.type === 'add') {
        const ref = doc(collection(db, `users/${uid}/${op.col}`));
        batch.set(ref, sanitizeForFirestore(op.data));
        results.push({ type: 'add', id: ref.id });
      } else if (op.type === 'update' && op.id) {
        const ref = doc(db, `users/${uid}/${op.col}`, op.id);
        batch.update(ref, sanitizeForFirestore(op.data));
        results.push({ type: 'update', id: op.id });
      }
    }
    await withWriteTimeout(batch.commit());
    return results;
  },

  /**
   * NON-BLOCKING variant of batchSave.
   *
   * Builds the WriteBatch and generates document IDs SYNCHRONOUSLY — Firestore
   * generates IDs client-side (CUID algorithm, no network call).  Returns the
   * IDs immediately alongside a `commit()` function that writes to local
   * IndexedDB (persistentLocalCache) and returns.  The caller can close its UI,
   * then fire commit() in the background.
   *
   * With persistentLocalCache commit() resolves in < 100 ms regardless of
   * network state. Firestore syncs to the server silently afterwards.
   */
  prepareBatch: (
    uid: string,
    operations: Array<{ type: 'add' | 'update'; col: string; data: any; id?: string }>,
  ): { results: { type: string; id: string }[]; commit: () => Promise<void> } => {
    if (operations.length === 0) {
      return { results: [], commit: () => Promise.resolve() };
    }
    const batch = writeBatch(db);
    const results: { type: string; id: string }[] = [];
    for (const op of operations) {
      if (op.type === 'add') {
        const ref = doc(collection(db, `users/${uid}/${op.col}`));
        batch.set(ref, sanitizeForFirestore(op.data));
        results.push({ type: 'add', id: ref.id });
      } else if (op.type === 'update' && op.id) {
        const ref = doc(db, `users/${uid}/${op.col}`, op.id);
        batch.update(ref, sanitizeForFirestore(op.data));
        results.push({ type: 'update', id: op.id });
      }
    }
    return {
      results,
      commit: () => withWriteTimeout(batch.commit()),
    };
  },

  // --- SETTINGS HELPERS ---
  settings: {
    get: async (uid: string) => {
      const snap = await getDoc(doc(db, `users/${uid}/settings`, 'config'));
      return snap.exists() ? snap.data() : null;
    },
    save: async (uid: string, data: any) => {
      return await withWriteTimeout(setDoc(doc(db, `users/${uid}/settings`, 'config'), sanitizeForFirestore(data), { merge: true }));
    },
  },

  updateSettings: async (uid: string, settings: any) => {
    return await withWriteTimeout(setDoc(doc(db, `users/${uid}/settings`, 'config'), sanitizeForFirestore(settings), { merge: true }));
  },

  // --- LEGACY HELPERS (backward compatibility) ---
  ledger: {
    add: async (uid: string, data: any) => addDoc(collection(db, `users/${uid}/ledger_entries`), sanitizeForFirestore(data)),
    get: async (uid: string) => getDocs(collection(db, `users/${uid}/ledger_entries`)),
  },
  transactions: {
    add: async (uid: string, data: any) => addDoc(collection(db, `users/${uid}/transactions`), sanitizeForFirestore(data)),
    get: async (uid: string) => getDocs(collection(db, `users/${uid}/transactions`)),
  },

  // --- DATA MANAGEMENT ---
  createBackup: async (_uid: string) => true, // logic lives in BackupService

  restoreBackup: async (uid: string, data: any) => {
    const MAX_BATCH_SIZE = 450;
    const collections = [
      'ledger_entries',
      'transactions',
      'inventory',
      'parties',
      'vehicles',
      'expenses',
      'waste_entries',
      'settings',
    ];

    let batch = writeBatch(db);
    let opCount = 0;

    for (const colName of collections) {
      if (data[colName] && Array.isArray(data[colName])) {
        for (const item of data[colName]) {
          const docId = item.id || item._id;
          const docRef = docId
            ? doc(db, 'users', uid, colName, docId)
            : doc(collection(db, 'users', uid, colName));

          const { id: _id1, _id: _id2, ...docData } = item;
          batch.set(docRef, docData);
          opCount++;

          if (opCount >= MAX_BATCH_SIZE) {
            await batch.commit();
            // FIX: fresh batch after every commit
            batch = writeBatch(db);
            opCount = 0;
          }
        }
      }
    }

    if (opCount > 0) await batch.commit();
  },

  factoryReset: async (uid: string) => {
    // FIX: Also clear audit_logs and recycle_bin that the old version left intact.
    const collections = [
      'ledger_entries',
      'transactions',
      'inventory',
      'parties',
      'vehicles',
      'expenses',
      'waste_entries',
      'settings',
      'audit_logs',
      'recycle_bin',
    ];

    for (const colName of collections) {
      const q = await getDocs(collection(db, `users/${uid}/${colName}`));
      await Promise.all(q.docs.map(d => deleteDoc(d.ref)));
    }
  },
};

