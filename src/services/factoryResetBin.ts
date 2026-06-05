import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const RETENTION_DAYS = 30;
const ITEMS_PER_CHUNK = 40;
const MAX_BATCH_OPS = 440;

const COLLECTIONS = [
  'ledger_entries',
  'transactions',
  'inventory',
  'parties',
  'vehicles',
  'expenses',
  'waste_entries',
  'settings',
];

function metaPath(uid: string) {
  return `users/${uid}/factory_reset_snapshots`;
}
function dataPath(uid: string) {
  return `users/${uid}/factory_reset_data`;
}

export const FactoryResetBinService = {
  savePreResetSnapshot: async (uid: string): Promise<string> => {
    const resetId = `reset_${Date.now()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 24 * 3600 * 1000);

    const allData: Record<string, any[]> = {};
    for (const colName of COLLECTIONS) {
      const snap = await getDocs(collection(db, `users/${uid}/${colName}`));
      allData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    const totalItems = Object.values(allData).reduce((s, arr) => s + arr.length, 0);

    await setDoc(doc(db, metaPath(uid), resetId), {
      reset_id: resetId,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      total_items: totalItems,
      collections: COLLECTIONS,
    });

    let batch = writeBatch(db);
    let batchOps = 0;

    for (const colName of COLLECTIONS) {
      const items = allData[colName];
      const numChunks = Math.max(1, Math.ceil(items.length / ITEMS_PER_CHUNK));
      for (let c = 0; c < numChunks; c++) {
        const chunk = items.slice(c * ITEMS_PER_CHUNK, (c + 1) * ITEMS_PER_CHUNK);
        if (chunk.length === 0 && c > 0) break;
        const chunkRef = doc(db, dataPath(uid), `${resetId}_${colName}_${c}`);
        batch.set(chunkRef, {
          reset_id: resetId,
          collection: colName,
          chunk: c,
          items: chunk,
        });
        batchOps++;
        if (batchOps >= MAX_BATCH_OPS) {
          await batch.commit();
          batch = writeBatch(db);
          batchOps = 0;
        }
      }
    }

    if (batchOps > 0) await batch.commit();

    return resetId;
  },

  listSnapshots: async (uid: string): Promise<any[]> => {
    const snap = await getDocs(collection(db, metaPath(uid)));
    const now = new Date();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(s => new Date(s.expires_at) > now)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  restoreSnapshot: async (uid: string, resetId: string): Promise<void> => {
    const dataSnap = await getDocs(collection(db, dataPath(uid)));
    const chunks = dataSnap.docs
      .filter(d => d.id.startsWith(`${resetId}_`))
      .map(d => d.data() as any);

    const reassembled: Record<string, any[]> = {};
    for (const chunk of chunks) {
      if (!reassembled[chunk.collection]) reassembled[chunk.collection] = [];
      reassembled[chunk.collection].push(...(chunk.items || []));
    }

    const MAX_BATCH = 440;
    let batch = writeBatch(db);
    let opCount = 0;

    for (const colName of COLLECTIONS) {
      const items = reassembled[colName] || [];
      for (const item of items) {
        const docId = item.id || item._id;
        const { id: _i1, _id: _i2, ...docData } = item;
        const ref = docId
          ? doc(db, 'users', uid, colName, docId)
          : doc(collection(db, 'users', uid, colName));
        batch.set(ref, docData);
        opCount++;
        if (opCount >= MAX_BATCH) {
          await batch.commit();
          batch = writeBatch(db);
          opCount = 0;
        }
      }
    }
    if (opCount > 0) await batch.commit();
  },
};
