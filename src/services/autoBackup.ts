import { Capacitor } from '@capacitor/core';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
// MODULE 5 — single source of truth for "Last backup at X"
import { LastBackupTracker } from './lastBackupTracker';

const COLLECTIONS = ['ledger_entries', 'transactions', 'inventory', 'parties', 'vehicles', 'expenses', 'waste_entries', 'settings'];

function getEmailPrefix(userEmail?: string): string {
  return userEmail ? userEmail.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_') : 'default';
}

function getBackupFolder(userEmail?: string): string {
  const prefix = getEmailPrefix(userEmail);
  const year = new Date().getFullYear();
  return `ShopkeeperLedger_backups/${prefix}/${year}`;
}

function getFYBounds(): { start: string; end: string } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const fyStart = month >= 4 ? year : year - 1;
  return { start: `${fyStart}-04-01`, end: `${fyStart + 1}-03-31` };
}

function filterFY<T extends { date?: string; created_at?: string }>(
  items: T[],
  today: string,
): T[] {
  const { start, end } = getFYBounds();
  return items.filter(it => {
    const d = (it as any).date || (it as any).created_at || '';
    const dateStr = d.length >= 10 ? d.slice(0, 10) : '';
    return dateStr >= start && dateStr <= end && dateStr < today;
  });
}

function toCsv(headers: string[], rows: any[][]): string {
  const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
}

async function saveBackupFile(backupFolder: string, filename: string, content: string): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  try {
    await Filesystem.mkdir({ path: backupFolder, directory: Directory.Documents, recursive: true });
  } catch (_) {}
  await Filesystem.writeFile({
    path: `${backupFolder}/${filename}`,
    data: content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  });
}

async function listNamesInFolder(folder: string): Promise<string[]> {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const result = await Filesystem.readdir({ path: folder, directory: Directory.Documents });
    return result.files.map((f: any) => (typeof f === 'string' ? f : f.name));
  } catch {
    return [];
  }
}

async function deleteFileInFolder(folder: string, name: string): Promise<void> {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.deleteFile({ path: `${folder}/${name}`, directory: Directory.Documents });
  } catch (_) {}
}

function extractDate(filename: string): string {
  const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '0000-00-00';
}

async function rotateByPrefix(folder: string, prefix: string, suffix: string, keep: number): Promise<void> {
  const all = await listNamesInFolder(folder);
  const relevant = all
    .filter(n => n.startsWith(prefix) && n.endsWith(suffix))
    .sort((a, b) => {
      const da = extractDate(a);
      const db = extractDate(b);
      if (da !== db) return da > db ? -1 : 1;
      return a > b ? -1 : 1;
    });
  for (const old of relevant.slice(keep)) {
    await deleteFileInFolder(folder, old);
  }
}

function isLastDayOfFY(): boolean {
  const now = new Date();
  return now.getMonth() === 2 && now.getDate() === 31;
}

async function saveDetailedCsvFiles(
  backupFolder: string,
  dateStr: string,
  data: Record<string, any[]>,
  today: string,
): Promise<void> {
  const partyHeaders = ['id', 'party_code', 'name', 'role', 'contact', 'gstin', 'legal_name', 'address', 'state', 'site', 'credit_limit', 'linked_items'];
  const partyRows = (data['parties'] || []).map((p: any) => [
    p.id, p.party_code ?? '', p.name, p.role, p.contact, p.gstin ?? '', p.legal_name ?? '',
    p.address ?? '', p.state ?? '', p.site ?? '', p.credit_limit ?? '',
    Array.isArray(p.linked_items) ? p.linked_items.join('|') : (p.linked_items ?? ''),
  ]);
  await saveBackupFile(backupFolder, `parties_${dateStr}.csv`, toCsv(partyHeaders, partyRows));
  await rotateByPrefix(backupFolder, 'parties_', '.csv', 3);

  const ledgerFiltered = filterFY(data['ledger_entries'] || [], today);
  const ledgerHeaders = ['date', 'invoice_no', 'type', 'party_name', 'site', 'item_name', 'qty', 'unit', 'rate', 'item_total', 'gst_pct', 'rent', 'handling_charges', 'discount', 'grand_total', 'payment_mode', 'vehicle', 'source_supplier', 'seller_invoice_no', 'notes'];
  const ledgerRows: any[][] = [];
  for (const e of ledgerFiltered) {
    const items: any[] = Array.isArray(e.items) && e.items.length > 0 ? e.items : [null];
    items.forEach((item: any, idx: number) => {
      ledgerRows.push([
        idx === 0 ? (e.date || '') : '',
        idx === 0 ? (e.invoice_no || e.bill_no || e.prefixed_id || '') : '',
        idx === 0 ? (e.type || '') : '',
        idx === 0 ? (e.party_name || '') : '',
        idx === 0 ? (e.site || '') : '',
        item ? item.item_name : '',
        item ? (item.quantity ?? '') : '',
        item ? (item.unit || '') : '',
        item ? (item.rate ?? '') : '',
        item ? (item.total ?? '') : '',
        item ? (item.gst_percent ?? '') : '',
        idx === 0 ? (e.vehicle_rent ?? '') : '',
        idx === 0 ? (e.handling_charges ?? '') : '',
        idx === 0 ? (e.discount_amount ?? '') : '',
        idx === 0 ? (e.total_amount ?? '') : '',
        idx === 0 ? (e.payment_mode || '') : '',
        idx === 0 ? (e.vehicle || '') : '',
        idx === 0 ? (e.source_supplier || '') : '',
        idx === 0 ? (e.seller_invoice_no || '') : '',
        idx === 0 ? (e.notes || '') : '',
      ]);
    });
  }
  await saveBackupFile(backupFolder, `ledger_${dateStr}.csv`, toCsv(ledgerHeaders, ledgerRows));
  await rotateByPrefix(backupFolder, 'ledger_', '.csv', 3);

  const txFiltered = filterFY(data['transactions'] || [], today);
  const txHeaders = ['date', 'type', 'party_name', 'amount', 'payment_mode', 'purpose', 'notes', 'payment_received_by', 'paid_by', 'transaction_id', 'bill_no'];
  const txRows = txFiltered.map((t: any) => [
    t.date, t.type, t.party_name, t.amount, t.payment_mode, t.payment_purpose, t.notes,
    t.payment_received_by ?? '', t.paid_by ?? '', t.transaction_id ?? '', t.bill_no ?? '',
  ]);
  await saveBackupFile(backupFolder, `transactions_${dateStr}.csv`, toCsv(txHeaders, txRows));
  await rotateByPrefix(backupFolder, 'transactions_', '.csv', 3);

  const expFiltered = filterFY(data['expenses'] || [], today);
  const expHeaders = ['date', 'category', 'amount', 'notes'];
  const expRows = expFiltered.map((e: any) => [e.date, e.category, e.amount, e.notes]);
  await saveBackupFile(backupFolder, `expenses_${dateStr}.csv`, toCsv(expHeaders, expRows));
  await rotateByPrefix(backupFolder, 'expenses_', '.csv', 3);
}

export const AutoBackupService = {
  createLocalBackup: async (userId: string, userEmail?: string, label?: string) => {
    if (!Capacitor.isNativePlatform()) {
      return { success: false, message: 'Auto-backup only available on Android/iOS' };
    }

    const today = new Date().toISOString().split('T')[0];
    const backupFolder = getBackupFolder(userEmail);
    const { start: fyStart, end: fyEnd } = getFYBounds();

    const rawData: Record<string, any[]> = {};
    for (const colName of COLLECTIONS) {
      const colRef = collection(db, `users/${userId}/${colName}`);
      const snap = await getDocs(colRef);
      rawData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    const backupData: any = {
      version: '2.0',
      timestamp: new Date().toISOString(),
      financial_year: `${fyStart} to ${fyEnd}`,
      userId,
      data: {
        ...rawData,
        ledger_entries: filterFY(rawData['ledger_entries'] || [], today),
        transactions: filterFY(rawData['transactions'] || [], today),
        expenses: filterFY(rawData['expenses'] || [], today),
      },
    };

    const fileName = label
      ? `backup_${label}_${today}.json`
      : `backup_${today}.json`;

    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      try {
        await Filesystem.mkdir({ path: backupFolder, directory: Directory.Documents, recursive: true });
      } catch (_) {}

      await Filesystem.writeFile({
        path: `${backupFolder}/${fileName}`,
        data: JSON.stringify(backupData, null, 2),
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });

      await rotateByPrefix(backupFolder, 'backup_', '.json', 3);

      if (isLastDayOfFY()) {
        const fy = `${fyStart}-${fyStart + 1}`;
        const yearEndData = {
          ...backupData,
          year_end: true,
          data: rawData,
        };
        await Filesystem.writeFile({
          path: `${backupFolder}/backup_yearend_${fy}.json`,
          data: JSON.stringify(yearEndData, null, 2),
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
      }

      try {
        await saveDetailedCsvFiles(backupFolder, today, rawData, today);
      } catch (csvErr) {
        console.warn('CSV step failed (JSON still saved):', csvErr);
      }

      // MODULE 5 — record the timestamp so the "Last backup" UI can show
      // "Today 2:30 PM" right after this completes (web + native both).
      LastBackupTracker.markCompleted(userId, label === 'manual' ? 'manual-device' : 'auto');

      return { success: true, fileName, message: `Backup saved: ${fileName}` };
    } catch (e: any) {
      console.error('Auto backup failed:', e);
      return { success: false, message: e.message || 'Backup failed' };
    }
  },

  rotateBackups: async (userEmail?: string) => {
    if (!Capacitor.isNativePlatform()) return 0;
    const backupFolder = getBackupFolder(userEmail);
    await rotateByPrefix(backupFolder, 'backup_', '.json', 2);
    return 0;
  },

  listBackups: async (userEmail?: string) => {
    if (!Capacitor.isNativePlatform()) return [];
    const backupFolder = getBackupFolder(userEmail);
    try {
      const names = await listNamesInFolder(backupFolder);
      return names
        .filter(n => n.startsWith('backup_') && n.endsWith('.json'))
        .sort((a, b) => (a > b ? -1 : 1))
        .map(name => ({
          name,
          date: name.match(/backup_(?:\w+_)?(\d{4}-\d{2}-\d{2})/)?.[1] || 'Unknown',
        }));
    } catch {
      return [];
    }
  },

  restoreFromFile: async (fileName: string, userEmail?: string) => {
    if (!Capacitor.isNativePlatform()) throw new Error('Restore from file is only available on Android/iOS');
    const backupFolder = getBackupFolder(userEmail);
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const result = await Filesystem.readFile({
        path: `${backupFolder}/${fileName}`,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      return JSON.parse(result.data as string);
    } catch (e: any) {
      console.error('Restore read failed:', e);
      throw new Error('Could not read backup file');
    }
  },

  createManualBackup: async (userId: string, userEmail?: string, dayLabel?: string) => {
    return AutoBackupService.createLocalBackup(userId, userEmail, dayLabel || 'manual');
  },

  checkAndRunDailyBackup: async (userId: string, userEmail?: string) => {
    if (!Capacitor.isNativePlatform()) return null;

    const LAST_BACKUP_KEY = `last_auto_backup_date_${userId}`;
    const today = new Date().toISOString().split('T')[0];

    let lastBackup: string | null = null;
    try { lastBackup = localStorage.getItem(LAST_BACKUP_KEY); }
    catch (_) { try { lastBackup = sessionStorage.getItem(LAST_BACKUP_KEY); } catch (__) {} }

    if (lastBackup === today) return null;

    try {
      const result = await AutoBackupService.createLocalBackup(userId, userEmail);
      if (result.success) {
        try { localStorage.setItem(LAST_BACKUP_KEY, today); }
        catch (_) { try { sessionStorage.setItem(LAST_BACKUP_KEY, today); } catch (__) {} }
      }
      return result;
    } catch (e) {
      console.error('Daily auto-backup error:', e);
      return null;
    }
  },
};
