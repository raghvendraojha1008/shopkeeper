import {
  collection, deleteDoc, doc, getDocs, query, getDoc, setDoc, writeBatch
} from 'firebase/firestore';
import { db } from '../config/firebase';

const BIN_RETENTION_DAYS = 30;

export interface DeletedItem {
  id: string;
  original_id: string;
  collection_name: string;
  data: any;
  deleted_at: string;
}

export const TrashService = {
  moveToTrash: async (userId: string, collectionName: string, docId: string) => {
    const docRef  = doc(db, 'users', userId, collectionName, docId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) throw new Error('Document not found');
    const data = docSnap.data();

    const batch    = writeBatch(db);
    const trashRef = doc(collection(db, 'users', userId, 'recycle_bin'));
    batch.set(trashRef, {
      original_id:     docId,
      collection_name: collectionName,
      data,
      deleted_at: new Date().toISOString(),
    });
    batch.delete(docRef);
    await batch.commit();
    return true;
  },

  getTrashItems: async (userId: string): Promise<DeletedItem[]> => {
    const snap = await getDocs(query(collection(db, 'users', userId, 'recycle_bin')));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as DeletedItem));

    // Auto-expire items older than BIN_RETENTION_DAYS
    const cutoff = Date.now() - BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const expired = items.filter(it => new Date(it.deleted_at).getTime() < cutoff);
    if (expired.length > 0) {
      const batch = writeBatch(db);
      expired.forEach(it => batch.delete(doc(db, 'users', userId, 'recycle_bin', it.id)));
      await batch.commit().catch(e => console.warn('[Trash] auto-expire failed:', e));
    }

    return items.filter(it => new Date(it.deleted_at).getTime() >= cutoff);
  },

  restoreItem: async (userId: string, item: DeletedItem): Promise<{ restored: boolean; usedNewId: boolean }> => {
    const batch   = writeBatch(db);
    const origRef = doc(db, 'users', userId, item.collection_name, item.original_id);
    const binRef  = doc(db, 'users', userId, 'recycle_bin', item.id);

    const existing = await getDoc(origRef);
    let targetRef = origRef;
    let usedNewId = false;

    if (existing.exists()) {
      targetRef = doc(collection(db, 'users', userId, item.collection_name));
      usedNewId = true;
    }

    batch.set(targetRef, item.data);
    batch.delete(binRef);
    await batch.commit();
    return { restored: true, usedNewId };
  },

  permanentDelete: async (userId: string, trashId: string) => {
    await deleteDoc(doc(db, 'users', userId, 'recycle_bin', trashId));
  },

  /** Days remaining before permanent auto-deletion (0 if expired) */
  daysRemaining: (deletedAt: string): number => {
    const elapsed = Date.now() - new Date(deletedAt).getTime();
    const remaining = BIN_RETENTION_DAYS - elapsed / (24 * 60 * 60 * 1000);
    return Math.max(0, Math.ceil(remaining));
  },
};
