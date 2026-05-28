import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { exportService } from './export';

export const DataService = {
  backupData: async (uid: string) => {
    try {
      const collections = ['ledger_entries', 'transactions', 'parties', 'vehicles', 'inventory', 'expenses', 'settings'];
      const backup: any = {};

      for (const col of collections) {
        const snap = await getDocs(collection(db, `users/${uid}/${col}`));
        backup[col] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      const json = JSON.stringify(backup, null, 2);
      const filename = `backup_${new Date().toISOString().split('T')[0]}.json`;

      // Cross-platform: uses Capacitor Share on native, browser download on web
      await exportService.shareOrDownload(json, filename, 'application/json');

      return { success: true, message: 'Backup Downloaded' };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'Backup Failed' };
    }
  }
};
