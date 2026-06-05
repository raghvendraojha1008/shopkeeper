import { db } from '../config/firebase';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

// FIX: Single canonical collection list used by BOTH createBackup and restoreBackup.
// Previously these two functions had different lists, causing waste_entries to be
// missing from backups and settings naming inconsistency (settings vs app_settings).
const BACKUP_COLLECTIONS = [
  'ledger_entries',
  'transactions',
  'inventory',
  'parties',
  'vehicles',
  'expenses',
  'waste_entries',
  'settings',          // stored as users/{uid}/settings/config — included for completeness
] as const;

export const BackupService = {
  /**
   * Exports all user collections to a JSON object.
   * Returns a structured object that can be passed back to restoreBackup.
   */
  createBackup: async (userId: string) => {
    const backupData: any = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      data: {},
    };

    for (const colName of BACKUP_COLLECTIONS) {
      const colRef = collection(db, `users/${userId}/${colName}`);
      const snap = await getDocs(colRef);
      backupData.data[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    return backupData;
  },

  /**
   * Restores data from a JSON object into Firestore.
   *
   * FIX: The previous implementation reused a single writeBatch object after calling
   * .commit() on it.  Calling .set() on an already-committed batch throws
   * "A write batch can no longer be used after commit() has been called."
   * This crashed every restore that contained more than 450 records.
   *
   * Fix: create a fresh writeBatch after each commit().
   */
  restoreBackup: async (userId: string, backupData: any) => {
    if (!backupData || !backupData.data) throw new Error('Invalid Backup File');

    const MAX_BATCH_SIZE = 450; // Firestore hard limit is 500
    let batch = writeBatch(db);   // ← new batch for each chunk
    let opCount = 0;

    const collections = Object.keys(backupData.data);

    for (const colName of collections) {
      const items = backupData.data[colName];
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        const { id, ...data } = item;
        const docRef = id
          ? doc(db, `users/${userId}/${colName}`, id)
          : doc(collection(db, `users/${userId}/${colName}`));

        batch.set(docRef, data, { merge: true });
        opCount++;

        if (opCount >= MAX_BATCH_SIZE) {
          await batch.commit();
          // FIX: Create a FRESH batch — never reuse after commit().
          batch = writeBatch(db);
          opCount = 0;
        }
      }
    }

    if (opCount > 0) await batch.commit();
    return true;
  },
};

