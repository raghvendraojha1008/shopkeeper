import { Capacitor } from '@capacitor/core';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';

const SNAPSHOT_ROOT_BASE = 'ShopkeeperLedger';
const MAX_DAYS = 7;
const LAST_SNAPSHOT_KEY_PREFIX = 'last_daily_snapshot_date_';

/** Returns account-specific snapshot root */
function getSnapshotRoot(userIdentifier?: string): string {
  const prefix = userIdentifier
    ? userIdentifier.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_')
    : 'anonymous';
  return `${SNAPSHOT_ROOT_BASE}/${prefix}/DailySnapshots`;
}

/** Get current financial year boundaries (India: Apr 1 – Mar 31) */
function getFYBounds(): { start: string; end: string } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const fyStart = month >= 4 ? year : year - 1;
  return {
    start: `${fyStart}-04-01`,
    end:   `${fyStart + 1}-03-31`,
  };
}

// ── CSV helpers ──────────────────────────────────────────────────────────────

function escapeCSV(val: any): string {
  const s = String(val ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function buildCSV(rows: any[], columns: { key: string; label: string }[]): string {
  const header = columns.map(c => c.label).join(',');
  const body = rows.map(row =>
    columns.map(c => escapeCSV(row[c.key])).join(',')
  );
  return [header, ...body].join('\r\n');
}

// ── Column definitions ────────────────────────────────────────────────────────

const TRANSACTION_COLS = [
  { key: 'date',            label: 'Date' },
  { key: 'type',            label: 'Type' },
  { key: 'party_name',      label: 'Party' },
  { key: 'amount',          label: 'Amount' },
  { key: 'payment_mode',    label: 'Payment Mode' },
  { key: 'payment_purpose', label: 'Purpose' },
  { key: 'bill_no',         label: 'Bill No' },
  { key: 'transaction_id',  label: 'Transaction ID' },
  { key: 'notes',           label: 'Notes' },
  { key: 'created_at',      label: 'Created At' },
];

const LEDGER_COLS = [
  { key: 'date',            label: 'Date' },
  { key: 'type',            label: 'Type' },
  { key: 'party_name',      label: 'Party' },
  { key: 'invoice_no',      label: 'Invoice No' },
  { key: 'total_amount',    label: 'Total Amount' },
  { key: 'discount_amount', label: 'Discount' },
  { key: 'items_summary',   label: 'Items Summary' },
  { key: 'vehicle',         label: 'Vehicle' },
  { key: 'notes',           label: 'Notes' },
  { key: 'created_at',      label: 'Created At' },
];

const EXPENSE_COLS = [
  { key: 'date',       label: 'Date' },
  { key: 'category',   label: 'Category' },
  { key: 'amount',     label: 'Amount' },
  { key: 'notes',      label: 'Notes' },
  { key: 'created_at', label: 'Created At' },
];

const INVENTORY_COLS = [
  { key: 'name',             label: 'Item Name' },
  { key: 'unit',             label: 'Unit' },
  { key: 'current_stock',    label: 'Current Stock' },
  { key: 'min_stock',        label: 'Min Stock' },
  { key: 'sale_rate',        label: 'Sale Rate' },
  { key: 'purchase_rate',    label: 'Purchase Rate' },
  { key: 'gst_percent',      label: 'GST %' },
  { key: 'hsn_code',         label: 'HSN Code' },
  { key: 'price_type',       label: 'Price Type' },
  { key: 'primary_supplier', label: 'Primary Supplier' },
  { key: 'created_at',       label: 'Created At' },
];

const PARTY_COLS = [
  { key: 'name',         label: 'Name' },
  { key: 'role',         label: 'Role' },
  { key: 'contact',      label: 'Contact' },
  { key: 'gstin',        label: 'GSTIN' },
  { key: 'address',      label: 'Address' },
  { key: 'site',         label: 'Site' },
  { key: 'state',        label: 'State' },
  { key: 'credit_limit', label: 'Credit Limit' },
  { key: 'created_at',   label: 'Created At' },
];

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchAllDocs(userId: string, colName: string): Promise<any[]> {
  const ref = collection(db, `users/${userId}/${colName}`);
  const snap = await getDocs(ref);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Filter by financial year AND exclude today */
function filterFYExcludeToday(items: any[], today: string): any[] {
  const { start, end } = getFYBounds();
  return items.filter(it => {
    const d = it.date || it.created_at || '';
    const dateStr = d.length >= 10 ? d.slice(0, 10) : '';
    return dateStr >= start && dateStr <= end && dateStr < today;
  });
}

// ── File system helpers ──────────────────────────────────────────────────────

async function ensureDir(path: string, Directory: any, Filesystem: any) {
  try {
    await Filesystem.mkdir({ path, directory: Directory.Documents, recursive: true });
  } catch (_) {}
}

async function writeSnapshotFile(
  snapshotRoot: string,
  dateStr: string,
  fileName: string,
  content: string,
  Filesystem: any,
  Directory: any,
  Encoding: any,
) {
  const dir = `${snapshotRoot}/${dateStr}`;
  await ensureDir(dir, Directory, Filesystem);
  await Filesystem.writeFile({
    path: `${dir}/${fileName}`,
    data: content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export const DailySnapshotService = {

  checkAndRunDailySnapshot: async (userId: string, userEmail?: string): Promise<void> => {
    if (!Capacitor.isNativePlatform()) return;

    const today = new Date().toISOString().split('T')[0];
    const LAST_SNAPSHOT_KEY = LAST_SNAPSHOT_KEY_PREFIX + userId;
    const lastRun = localStorage.getItem(LAST_SNAPSHOT_KEY);
    if (lastRun === today) return;

    const identifier = userEmail || userId;
    try {
      await DailySnapshotService.createSnapshot(userId, today, identifier);
      localStorage.setItem(LAST_SNAPSHOT_KEY, today);
      await DailySnapshotService.rotateOldSnapshots(identifier);
    } catch (e) {
      console.error('[DailySnapshot] failed:', e);
    }
  },

  createSnapshot: async (userId: string, dateStr: string, userEmail?: string): Promise<void> => {
    if (!Capacitor.isNativePlatform()) throw new Error('Snapshots only available on Android/iOS');

    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const snapshotRoot = getSnapshotRoot(userEmail);
    const today = dateStr; // snapshot date = the "today" we exclude

    const [transactions, ledgerEntries, expenses, inventory, parties] = await Promise.all([
      fetchAllDocs(userId, 'transactions'),
      fetchAllDocs(userId, 'ledger_entries'),
      fetchAllDocs(userId, 'expenses'),
      fetchAllDocs(userId, 'inventory'),
      fetchAllDocs(userId, 'parties'),
    ]);

    // Apply FY filter & exclude today for date-based collections
    const txFiltered  = filterFYExcludeToday(transactions,  today);
    const ldFiltered  = filterFYExcludeToday(ledgerEntries, today);
    const expFiltered = filterFYExcludeToday(expenses,       today);

    const ledgerWithSummary = ldFiltered.map(entry => ({
      ...entry,
      items_summary: Array.isArray(entry.items)
        ? entry.items.map((it: any) => `${it.item_name}(${it.quantity}${it.unit ?? ''})`).join('; ')
        : '',
    }));

    const txCsv   = buildCSV(txFiltered,       TRANSACTION_COLS);
    const ldCsv   = buildCSV(ledgerWithSummary, LEDGER_COLS);
    const exCsv   = buildCSV(expFiltered,       EXPENSE_COLS);
    const invCsv  = buildCSV(inventory,         INVENTORY_COLS); // all inventory
    const partyCsv = buildCSV(parties,           PARTY_COLS);    // all parties

    await Promise.all([
      writeSnapshotFile(snapshotRoot, dateStr, 'transactions.csv',  txCsv,    Filesystem, Directory, Encoding),
      writeSnapshotFile(snapshotRoot, dateStr, 'ledger.csv',        ldCsv,    Filesystem, Directory, Encoding),
      writeSnapshotFile(snapshotRoot, dateStr, 'expenses.csv',      exCsv,    Filesystem, Directory, Encoding),
      writeSnapshotFile(snapshotRoot, dateStr, 'inventory.csv',     invCsv,   Filesystem, Directory, Encoding),
      writeSnapshotFile(snapshotRoot, dateStr, 'parties.csv',       partyCsv, Filesystem, Directory, Encoding),
    ]);
  },

  rotateOldSnapshots: async (userEmail?: string): Promise<void> => {
    if (!Capacitor.isNativePlatform()) return;
    const snapshotRoot = getSnapshotRoot(userEmail);
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      let entries: any[] = [];
      try {
        const result = await Filesystem.readdir({ path: snapshotRoot, directory: Directory.Documents });
        entries = result.files ?? [];
      } catch (_) { return; }

      const dateFolders = entries
        .filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f.name))
        .sort((a, b) => (a.name > b.name ? -1 : 1));

      const toDelete = dateFolders.slice(MAX_DAYS);
      for (const folder of toDelete) {
        try {
          const inner = await Filesystem.readdir({
            path: `${snapshotRoot}/${folder.name}`,
            directory: Directory.Documents,
          });
          for (const file of inner.files ?? []) {
            await Filesystem.deleteFile({
              path: `${snapshotRoot}/${folder.name}/${file.name}`,
              directory: Directory.Documents,
            });
          }
          await Filesystem.rmdir({
            path: `${snapshotRoot}/${folder.name}`,
            directory: Directory.Documents,
          });
        } catch (e) {
          console.warn('[DailySnapshot] rotation error for', folder.name, e);
        }
      }
    } catch (e) {
      console.warn('[DailySnapshot] rotate failed:', e);
    }
  },

  listSnapshotDates: async (userEmail?: string): Promise<string[]> => {
    if (!Capacitor.isNativePlatform()) return [];
    const snapshotRoot = getSnapshotRoot(userEmail);
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const result = await Filesystem.readdir({ path: snapshotRoot, directory: Directory.Documents });
      const allDateFolders = (result.files ?? [])
        .filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f.name))
        .map(f => f.name)
        .sort((a, b) => (a > b ? -1 : 1))
        .slice(0, MAX_DAYS);

      const validDates: string[] = [];
      for (const dateStr of allDateFolders) {
        try {
          const inner = await Filesystem.readdir({
            path: `${snapshotRoot}/${dateStr}`,
            directory: Directory.Documents,
          });
          const csvCount = (inner.files ?? []).filter((f: any) => f.name.endsWith('.csv')).length;
          if (csvCount > 0) validDates.push(dateStr);
        } catch (_) {}
      }
      return validDates;
    } catch (_) { return []; }
  },

  listFilesForDate: async (dateStr: string, userEmail?: string): Promise<string[]> => {
    if (!Capacitor.isNativePlatform()) return [];
    const snapshotRoot = getSnapshotRoot(userEmail);
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const result = await Filesystem.readdir({
        path: `${snapshotRoot}/${dateStr}`,
        directory: Directory.Documents,
      });
      return (result.files ?? []).filter(f => f.name.endsWith('.csv')).map(f => f.name).sort();
    } catch (_) { return []; }
  },

  readSnapshotFile: async (dateStr: string, fileName: string, userEmail?: string): Promise<string> => {
    if (!Capacitor.isNativePlatform()) throw new Error('Only available on Android/iOS');
    const snapshotRoot = getSnapshotRoot(userEmail);
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const result = await Filesystem.readFile({
      path: `${snapshotRoot}/${dateStr}/${fileName}`,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    return result.data as string;
  },

  shareSnapshotFile: async (dateStr: string, fileName: string, userEmail?: string): Promise<void> => {
    if (!Capacitor.isNativePlatform()) throw new Error('Only available on Android/iOS');
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');

    const content = await DailySnapshotService.readSnapshotFile(dateStr, fileName, userEmail);
    const shareName = `${dateStr}_${fileName}`;

    const result = await Filesystem.writeFile({
      path: shareName,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });

    let uri = result.uri;
    if (!uri) {
      const uriResult = await Filesystem.getUri({ path: shareName, directory: Directory.Cache });
      uri = uriResult.uri;
    }
    // Use files[] (not url) so WhatsApp/Drive treat this as a real file attachment.
    // AbortError = user dismissed the share sheet — file is already saved, not a failure.
    try {
      await Share.share({ title: shareName, dialogTitle: shareName, files: [uri] });
    } catch (e: any) {
      if (e?.name !== 'AbortError') throw e;
    }
  },
};
