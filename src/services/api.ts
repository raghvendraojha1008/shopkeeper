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
    const result = await addDoc(collection(db, `users/${uid}/${col}`), sanitizeForFirestore(data));

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
    await updateDoc(doc(db, `users/${uid}/${col}`, id), sanitizeForFirestore(data));

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
    await deleteDoc(doc(db, `users/${uid}/${col}`, id));

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

  // --- SETTINGS HELPERS ---
  settings: {
    get: async (uid: string) => {
      const snap = await getDoc(doc(db, `users/${uid}/settings`, 'config'));
      return snap.exists() ? snap.data() : null;
    },
    save: async (uid: string, data: any) => {
      return await setDoc(doc(db, `users/${uid}/settings`, 'config'), sanitizeForFirestore(data), { merge: true });
    },
  },

  updateSettings: async (uid: string, settings: any) => {
    return await setDoc(doc(db, `users/${uid}/settings`, 'config'), sanitizeForFirestore(settings), { merge: true });
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

