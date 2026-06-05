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
 * Waste        | W-     | W-101       | Wastage records
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
 *
 * Gap-aware ID generation (added):
 *   When a user manually edits a record number (e.g. changes S-106 → S-103)
 *   the counter is updated to that value (even if lower than the current
 *   counter), becoming the new base.  On the next auto-generation the system
 *   scans forward from counter+1 and skips any number that already exists in
 *   the DB, so gaps caused by manual edits or deletions are automatically
 *   back-filled before moving on to a fresh high-water mark.
 *
 *   Example: existing = {101,102,105}, user manually saves 103 → counter=103.
 *     next peek → 104 (free)   → counter=104
 *     next peek → 106 (105 exists, skip) → counter=106
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

// Per-category sets of already-used numeric parts.
// Populated by seedCountersFromFirestore; updated by confirmID & generatePrefixedID.
// Used by peekNextID / generatePrefixedID to skip gaps caused by manual edits.
const _existingNumbers: Map<string, Set<number>> = new Map();

// Maximum number of sequential slots scanned when looking for the next gap.
const MAX_GAP_SCAN = 10_000;

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
 * Call this ONCE after fetching existing records from Firestore so that the
 * in-memory counters are always ≥ the highest ID already in the database.
 * This is the primary defence against duplicate IDs across devices/sessions.
 *
 * Also builds an in-memory Set<number> of every numeric part seen for this
 * category so that peekNextID / generatePrefixedID can skip gaps.
 *
 *@example
 * const ledgerDocs = await ApiService.getAll(uid, 'ledger_entries');
 * seedCountersFromFirestore(ledgerDocs.map(d => d.data().invoice_no), 'sales');
 */
export const seedCountersFromFirestore = (
  existingIds: (string | number | undefined | null)[],
  category: keyof IDCounters
): void => {
  const baseCount    = Number(_memCounters[category]);
  const expectedPrefix = PREFIX_MAP[category as IDCategory];

  const numSet: Set<number> = _existingNumbers.get(category) ?? new Set();
  let maxNum = baseCount;

  existingIds.forEach(raw => {
    if (raw == null || raw === '') return;
    const str = String(raw);

    let n: number | null = null;

    // Pure numeric IDs (legacy data) — accept as-is into the category.
    if (/^\d+$/.test(str)) {
      n = parseInt(str, 10);
    } else {
      // Prefixed IDs — only accept if the prefix matches THIS category, so a
      // stray "PAY-205" inside the sales collection can't push the sales counter.
      if (expectedPrefix && !str.startsWith(expectedPrefix)) return;
      const digits = str.slice(expectedPrefix.length).replace(/[^0-9]/g, '');
      if (!digits) return;
      n = parseInt(digits, 10);
    }

    if (n == null || isNaN(n)) return;
    numSet.add(n);
    if (n > maxNum) maxNum = n;
  });

  _existingNumbers.set(category, numSet);

  if (maxNum > _memCounters[category]) {
    _memCounters[category] = maxNum;
    saveCounters(_memCounters);
  }
};

/**
 * Scan forward from `start` and return the first number not in `existing`.
 * Caps at MAX_GAP_SCAN iterations to avoid infinite loops on pathological data.
 */
function findNextAvailable(start: number, existing: Set<number> | undefined): number {
  if (!existing || existing.size === 0) return start;
  let n = start;
  let scanned = 0;
  while (existing.has(n) && scanned < MAX_GAP_SCAN) { n++; scanned++; }
  return n;
}

/**
 * Generate a new prefixed ID for the given category.
 * Uses the in-memory counter (seeded from Firestore when possible).
 * Skips any number that is already in the existing-IDs set so that gaps
 * created by manual edits or deletions are back-filled automatically.
 * @param category - The category type
 * @returns A new unique ID like "S-101", "REC-102", etc.
 */
export const generatePrefixedID = (category: IDCategory): string => {
  const existing = _existingNumbers.get(category);
  const next = findNextAvailable(_memCounters[category] + 1, existing);
  _memCounters[category] = next;
  saveCounters(_memCounters);
  existing?.add(next);
  return `${PREFIX_MAP[category]}${next}`;
};

/**
 * Peek at the next ID for the given category WITHOUT incrementing the counter.
 * Use this to pre-fill form fields on open. Call confirmID() on actual save
 * so the counter only advances when data is truly persisted.
 *
 * Gap-aware: skips numbers that already exist in the DB (populated via
 * seedCountersFromFirestore) so the suggestion always reflects the next
 * free slot, not merely counter+1.
 */
export const peekNextID = (category: IDCategory): string => {
  const existing = _existingNumbers.get(category);
  const next = findNextAvailable(_memCounters[category] + 1, existing);
  return `${PREFIX_MAP[category]}${next}`;
};

/**
 * Confirm that the counter has advanced to the number in `idString`.
 *
 * Unlike the old behaviour (only update when new > current), this ALWAYS
 * sets the counter to the confirmed number — even when the user manually
 * typed a lower value.  This makes the manually-entered number the new base
 * so the next auto-generation continues from the next available gap after it.
 *
 * Example: counter=105, user manually saves "S-103" → counter becomes 103.
 *   Next peek → 104 (if 104 is free), then 106 (if 105 exists).
 */
export const confirmID = (idString: string, category: IDCategory): void => {
  const prefix = PREFIX_MAP[category as IDCategory] ?? '';
  let str = String(idString ?? '').trim();

  // Strip expected prefix to isolate the numeric part
  if (prefix && str.startsWith(prefix)) str = str.slice(prefix.length);

  // Also handle pure-numeric legacy IDs or any remaining digits
  const digits = str.replace(/[^0-9]/g, '');
  if (!digits) return;
  const n = parseInt(digits, 10);
  if (isNaN(n)) return;

  // Always update counter to the confirmed value (enables "go-back" edits)
  _memCounters[category] = n;
  saveCounters(_memCounters);

  // Track this number in the existing set so it is never re-suggested
  if (!_existingNumbers.has(category)) _existingNumbers.set(category, new Set());
  _existingNumbers.get(category)!.add(n);
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
  _existingNumbers.clear();
  saveCounters(_memCounters);
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Party Code utilities  (P-0001, P-0002, …)
 * A unified sequential tag given to every party regardless of customer/supplier
 * role.  Kept separate from the C- / V- internal IDs so the displayed tag is
 * always the same format and starts from 0001.
 * ───────────────────────────────────────────────────────────────────────────── */

let _partyCounter = 0;
const _existingPartyCodes = new Set<number>();

/** Call this whenever existing party codes are available (e.g. after a
 *  Firestore fetch or when the DataContext list updates).  Safe to call
 *  multiple times — the counter only ever increases. */
export const seedPartyCounter = (existingCodes: (string | undefined | null)[]): void => {
  let max = _partyCounter;
  existingCodes.forEach(code => {
    if (!code) return;
    const n = parseInt(String(code).replace(/^P-0*/,''), 10);
    if (!isNaN(n)) {
      _existingPartyCodes.add(n);
      if (n > max) max = n;
    }
  });
  if (max > _partyCounter) _partyCounter = max;
};

/** Return the next party code WITHOUT advancing the counter (use for previews).
 *  Gap-aware: skips codes that already exist. */
export const peekNextPartyCode = (): string => {
  let next = _partyCounter + 1;
  let scanned = 0;
  while (_existingPartyCodes.has(next) && scanned < MAX_GAP_SCAN) { next++; scanned++; }
  return `P-${String(next).padStart(4, '0')}`;
};

/** Generate the next party code and advance the counter (use on actual save).
 *  Gap-aware: skips codes that already exist. */
export const generatePartyCode = (): string => {
  let next = _partyCounter + 1;
  let scanned = 0;
  while (_existingPartyCodes.has(next) && scanned < MAX_GAP_SCAN) { next++; scanned++; }
  _partyCounter = next;
  _existingPartyCodes.add(next);
  return `P-${String(next).padStart(4, '0')}`;
};

/** Ensure the counter has advanced to at least the number in `code`.
 *  Call after a save so the counter stays in sync even when the user
 *  manually edits the code field.
 *  Always updates (enables going back to a lower code by manual edit). */
export const confirmPartyCode = (code: string): void => {
  const n = parseInt(String(code).replace(/^P-0*/,''), 10);
  if (isNaN(n)) return;
  // Always update (same pattern as confirmID — supports manual lower-value edits)
  _partyCounter = n;
  _existingPartyCodes.add(n);
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
