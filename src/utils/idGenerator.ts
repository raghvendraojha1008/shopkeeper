/**
 * ID Prefix Strategy for Scannable Records
 *
 * Category     | Prefix | Example ID  | Purpose
 * -------------|--------|-------------|--------------------
 * Sales        | S-     | S-1001      | Customer Invoices
 * Purchases    | P-     | P-1001      | Supplier Bills
 * Customers    | C-     | C-101       | Party Master (Clients)
 * Suppliers    | V-     | V-101       | Party Master (Vendors)
 * Inventory    | I-     | I-101       | Product/Item Master
 * Receipts     | REC-   | REC-101     | Money In (Payments Received)
 * Payments     | PAY-   | PAY-101     | Money Out (Payments Made)
 *
 * FIX (High #4): ID counters are NO LONGER stored in localStorage as the
 * primary source of truth. localStorage resets on every new device/browser
 * session, causing duplicate IDs like "S-101" to collide with existing Firestore
 * records. The new strategy:
 *
 *   1. The ManualEntryModal already fetches `ledger_entries` / `transactions` /
 *      `inventory` on open and derives the max existing number from those records.
 *      That Firestore-derived number is set into `formData.invoice_no` etc.
 *
 *   2. `getIDForEntry()` below is the LAST-RESORT fallback — used only when the
 *      modal's async fetch hasn't completed yet, or for non-ledger entry types
 *      (parties, inventory). It uses an in-memory counter seeded from a
 *      conservative base that can be overridden at startup by calling
 *      `seedCountersFromFirestore()` once the Firestore snapshot is available.
 *
 *   3. localStorage is still written as a within-session cache so rapid
 *      consecutive creates on the same device don't repeat IDs before the
 *      next Firestore open — but it is never the sole source of truth.
 */

let _currentUserId = '';
const counterKey = (uid: string) => uid ? `app_id_counters_${uid}` : 'app_id_counters';

interface IDCounters {
  sales: number;
  purchases: number;
  customers: number;
  suppliers: number;
  inventory: number;
  receipts: number;
  payments: number;
  waste: number;
}

const DEFAULT_COUNTERS: IDCounters = {
  sales: 100,
  purchases: 100,
  customers: 100,
  suppliers: 100,
  inventory: 100,
  receipts: 100,
  payments: 100,
  waste: 100,
};

// In-memory counters — authoritative during the current JS session.
// Seeded from Firestore on first data load (see seedCountersFromFirestore).
let _memCounters: IDCounters = { ...DEFAULT_COUNTERS };

const readLocalCounters = (uid?: string): IDCounters | null => {
  const key = counterKey(uid || _currentUserId);
  try {
    const stored = localStorage.getItem(key);
    if (stored) return { ...DEFAULT_COUNTERS, ...JSON.parse(stored) };
  } catch (_) {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) return { ...DEFAULT_COUNTERS, ...JSON.parse(stored) };
    } catch (__) { /* ignore */ }
  }
  return null;
};

const saveCounters = (counters: IDCounters): void => {
  const key = counterKey(_currentUserId);
  try {
    localStorage.setItem(key, JSON.stringify(counters));
  } catch (_) {
    try {
      sessionStorage.setItem(key, JSON.stringify(counters));
    } catch (__) {
      console.warn('ID counters: unable to persist counters, IDs may repeat on hard refresh');
    }
  }
};

/**
 * Call this immediately after login with the authenticated user's UID.
 * Switches the in-memory counter set to the correct user's namespace,
 * preventing collisions between multiple users on the same device.
 */
export const initCountersForUser = (userId: string): void => {
  if (!userId || userId === _currentUserId) return;
  _currentUserId = userId;
  const stored = readLocalCounters(userId);
  if (stored) {
    _memCounters = stored;
  } else {
    _memCounters = { ...DEFAULT_COUNTERS };
  }
};

// Initialise in-memory counters from local storage (same-session cache).
// Firestore-derived values can then upgrade these via seedCountersFromFirestore.
const localCounters = readLocalCounters();
if (localCounters) {
  _memCounters = localCounters;
}

/**
 * Call this ONCE after fetching existing records from Firestore so that the
 * in-memory counters are always ≥ the highest ID already in the database.
 * This is the primary defence against duplicate IDs across devices/sessions.
 *
 *@example
 * const ledgerDocs = await ApiService.getAll(uid, 'ledger_entries');
 * seedCountersFromFirestore(ledgerDocs.map(d => d.data().invoice_no), 'sales');
 */
export const seedCountersFromFirestore = (
  existingIds: (string | number | undefined | null)[],
  category: keyof IDCounters
): void => {
  const baseCount = Number(_memCounters[category]);
  const expectedPrefix = PREFIX_MAP[category as IDCategory]; // e.g. "S-", "REC-"

  const maxNum = existingIds.reduce<number>((max, raw) => {
    if (raw == null || raw === '') return max;
    const str = String(raw);

    // Pure numeric IDs (legacy data) — accept as-is into the category.
    if (/^\d+$/.test(str)) {
      const n = parseInt(str, 10);
      return !isNaN(n) && n > max ? n : max;
    }

    // Prefixed IDs — only accept if the prefix matches THIS category, so a
    // stray "PAY-205" inside the sales collection can't push the sales counter.
    if (expectedPrefix && !str.startsWith(expectedPrefix)) return max;

    const digits = str.slice(expectedPrefix.length).replace(/[^0-9]/g, '');
    if (!digits) return max;
    const n = parseInt(digits, 10);
    return !isNaN(n) && n > max ? n : max;
  }, baseCount);

  if (maxNum > _memCounters[category]) {
    _memCounters[category] = maxNum;
    saveCounters(_memCounters);
  }
};
type IDCategory = 'sales' | 'purchases' | 'customers' | 'suppliers' | 'inventory' | 'receipts' | 'payments' | 'waste';

const PREFIX_MAP: Record<IDCategory, string> = {
  sales: 'S-',
  purchases: 'P-',
  customers: 'C-',
  suppliers: 'V-',
  inventory: 'I-',
  receipts: 'REC-',
  payments: 'PAY-',
  waste: 'W-',
};

/**
 * Generate a new prefixed ID for the given category.
 * Uses the in-memory counter (seeded from Firestore when possible).
 * @param category - The category type
 * @returns A new unique ID like "S-101", "REC-102", etc.
 */
export const generatePrefixedID = (category: IDCategory): string => {
  _memCounters[category] += 1;
  saveCounters(_memCounters);
  return `${PREFIX_MAP[category]}${_memCounters[category]}`;
};

/**
 * Determine ID category based on entry type and context.
 * @param type - The transaction or entry type
 * @param role - Optional party role for party-specific IDs
 */
export const getIDForEntry = (
  type: 'sell' | 'purchase' | 'received' | 'paid' | 'party' | 'inventory',
  role?: 'customer' | 'supplier'
): string => {
  switch (type) {
    case 'sell':      return generatePrefixedID('sales');
    case 'purchase':  return generatePrefixedID('purchases');
    case 'received':  return generatePrefixedID('receipts');
    case 'paid':      return generatePrefixedID('payments');
    case 'party':     return role === 'supplier'
                        ? generatePrefixedID('suppliers')
                        : generatePrefixedID('customers');
    case 'inventory': return generatePrefixedID('inventory');
    default:          return generatePrefixedID('sales');
  }
};

/**
 * Reset all in-memory and persisted counters back to 100 (next ID starts at 101).
 * Only use this for testing / data wipes.
 */
export const resetAllCounters = (): void => {
  _memCounters = { ...DEFAULT_COUNTERS };
  saveCounters(_memCounters);
};

/**
 * Parse a prefixed ID to extract category prefix and number.
 * @param id - The prefixed ID like "S-101"
 */
export const parseID = (id: string): { prefix: string; number: number } | null => {
  if (!id) return null;

  // Strict form: "PREFIX-1234" (no trailing chars).
  const strict = id.match(/^([A-Z]+-?)(\d+)$/);
  if (strict) {
    return { prefix: strict[1], number: parseInt(strict[2], 10) };
  }

  // Lenient fallback: any leading prefix followed by a digit run, with
  // optional trailing characters (e.g. "S-101A", "INV-2024-001-rev").
  // This prevents the seeder from silently dropping slightly-malformed IDs.
  const lenient = id.match(/^([A-Z]+-?)(\d+)/);
  if (lenient) {
    return { prefix: lenient[1], number: parseInt(lenient[2], 10) };
  }

  // Pure numeric ID (legacy data with no prefix).
  if (/^\d+$/.test(id)) {
    return { prefix: '', number: parseInt(id, 10) };
  }

  return null;
};

