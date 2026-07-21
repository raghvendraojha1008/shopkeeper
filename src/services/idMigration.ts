/**
 * idMigration — One-time migration that ensures every existing record has a
 * unique prefixed ID (S-, P-, REC-, PAY-, I-, EXP-, C-/V-, ST-, W-).
 *
 * Runs once per user-session, tracked by a localStorage flag.
 * Safe to run on databases of any size:
 *   - Fetches each collection once (parallel reads)
 *   - Seeds counters from valid existing IDs before generating new ones
 *   - Writes updates in Firestore batches of 450 (Firestore limit is 500)
 *   - Null IDs are assigned a fresh unique ID
 *   - Duplicate IDs: the first occurrence is kept; duplicates get a new ID
 */
import { getDocs, collection, writeBatch, doc } from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  seedCountersFromFirestore,
  generatePrefixedID,
  seedPartyCounter,
  generatePartyCode,
  seedStaffCounter,
  generateStaffCode,
} from '../utils/idGenerator';

const MIGRATION_FLAG = (uid: string) => `id_migration_v2_${uid}`;
const BATCH_SIZE = 450;

export async function runIdMigrationIfNeeded(uid: string): Promise<void> {
  if (!uid) return;
  if (localStorage.getItem(MIGRATION_FLAG(uid)) === 'done') return;

  try {
    const count = await runIdMigration(uid);
    localStorage.setItem(MIGRATION_FLAG(uid), 'done');
    if (count > 0) {
      console.info(`[IdMigration] Assigned unique IDs to ${count} existing record(s).`);
    }
  } catch (e) {
    console.warn('[IdMigration] Migration failed (will retry on next app open):', e);
  }
}

async function runIdMigration(uid: string): Promise<number> {
  const col = (name: string) => collection(db, 'users', uid, name);

  // ── 1. Fetch all collections in parallel ──────────────────────────────────
  const [
    ledgerSnap, txnSnap, inventorySnap,
    partiesSnap, expensesSnap, staffSnap, wasteSnap,
  ] = await Promise.all([
    getDocs(col('ledger_entries')),
    getDocs(col('transactions')),
    getDocs(col('inventory')),
    getDocs(col('parties')),
    getDocs(col('expenses')),
    getDocs(col('staff')),
    getDocs(col('waste_entries')),
  ]);

  // ── 2. Seed counters from all existing valid IDs ───────────────────────────
  seedCountersFromFirestore(
    ledgerSnap.docs.filter(d => d.data().type === 'sell').map(d => d.data().invoice_no), 'sales'
  );
  seedCountersFromFirestore(
    ledgerSnap.docs.filter(d => d.data().type === 'purchase').map(d => d.data().bill_no), 'purchases'
  );
  seedCountersFromFirestore(
    txnSnap.docs.filter(d => d.data().type === 'received').map(d => d.data().transaction_id), 'receipts'
  );
  seedCountersFromFirestore(
    txnSnap.docs.filter(d => d.data().type === 'paid').map(d => d.data().transaction_id), 'payments'
  );
  seedCountersFromFirestore(inventorySnap.docs.map(d => d.data().item_id), 'inventory');
  seedCountersFromFirestore(expensesSnap.docs.map(d => d.data().expense_no), 'expenses');
  seedCountersFromFirestore(wasteSnap.docs.map(d => d.data().prefixed_id), 'waste');
  seedPartyCounter(partiesSnap.docs.map(d => d.data().party_code));
  seedStaffCounter(staffSnap.docs.map(d => d.data().staff_code));

  // ── 3. Collect updates ────────────────────────────────────────────────────
  const updates: { ref: ReturnType<typeof doc>; data: Record<string, any> }[] = [];

  // Helper: tracks seen IDs per field to detect duplicates.
  function assign<T extends string | undefined>(
    seen: Set<string>,
    current: T,
    generate: () => string,
  ): string | null {
    if (current && !seen.has(current)) {
      seen.add(current);
      return null; // no update needed
    }
    const newId = generate();
    seen.add(newId);
    return newId;
  }

  // Ledger entries
  const seenInvoice = new Set<string>();
  const seenBill    = new Set<string>();
  ledgerSnap.docs.forEach(d => {
    const data = d.data();
    if (data.type === 'sell') {
      const newId = assign(seenInvoice, data.invoice_no, () => generatePrefixedID('sales'));
      if (newId) updates.push({ ref: doc(db, 'users', uid, 'ledger_entries', d.id), data: { invoice_no: newId } });
    } else if (data.type === 'purchase') {
      const newId = assign(seenBill, data.bill_no, () => generatePrefixedID('purchases'));
      if (newId) updates.push({ ref: doc(db, 'users', uid, 'ledger_entries', d.id), data: { bill_no: newId } });
    }
  });

  // Transactions
  const seenTxn = new Set<string>();
  txnSnap.docs.forEach(d => {
    const data = d.data();
    const cat = data.type === 'paid' ? 'payments' : 'receipts';
    const newId = assign(seenTxn, data.transaction_id, () => generatePrefixedID(cat));
    if (newId) updates.push({ ref: doc(db, 'users', uid, 'transactions', d.id), data: { transaction_id: newId } });
  });

  // Inventory
  const seenItem = new Set<string>();
  inventorySnap.docs.forEach(d => {
    const data = d.data();
    const newId = assign(seenItem, data.item_id, () => generatePrefixedID('inventory'));
    if (newId) updates.push({ ref: doc(db, 'users', uid, 'inventory', d.id), data: { item_id: newId } });
  });

  // Expenses
  const seenExp = new Set<string>();
  expensesSnap.docs.forEach(d => {
    const data = d.data();
    const newId = assign(seenExp, data.expense_no, () => generatePrefixedID('expenses'));
    if (newId) updates.push({ ref: doc(db, 'users', uid, 'expenses', d.id), data: { expense_no: newId } });
  });

  // Parties
  const seenParty = new Set<string>();
  partiesSnap.docs.forEach(d => {
    const data = d.data();
    const newCode = assign(seenParty, data.party_code, () =>
      generatePartyCode(data.role === 'supplier' ? 'supplier' : 'customer')
    );
    if (newCode) updates.push({ ref: doc(db, 'users', uid, 'parties', d.id), data: { party_code: newCode } });
  });

  // Staff
  const seenStaff = new Set<string>();
  staffSnap.docs.forEach(d => {
    const data = d.data();
    const newCode = assign(seenStaff, data.staff_code, () => generateStaffCode());
    if (newCode) updates.push({ ref: doc(db, 'users', uid, 'staff', d.id), data: { staff_code: newCode } });
  });

  // Waste entries
  const seenWaste = new Set<string>();
  wasteSnap.docs.forEach(d => {
    const data = d.data();
    const newId = assign(seenWaste, data.prefixed_id, () => generatePrefixedID('waste'));
    if (newId) updates.push({ ref: doc(db, 'users', uid, 'waste_entries', d.id), data: { prefixed_id: newId } });
  });

  // ── 4. Write updates in batches ───────────────────────────────────────────
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }

  return updates.length;
}
