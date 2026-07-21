/**
 * staffService.ts
 *
 * Pure business-logic layer for Staff Management.
 * All Firestore operations go through ApiService (offline-first via SDK persistence).
 *
 * Balance accounting rules:
 *   CREDIT (increases money with staff): COLLECTION, EXPENSE_ADVANCE, SALARY_ADVANCE
 *   DEBIT  (decreases money with staff): STAFF_EXPENSE, SETTLEMENT
 *   NEUTRAL (tracked separately):        SALARY_PAYMENT, REIMBURSEMENT
 *   SIGNED:                              ADJUSTMENT (positive = credit, negative = debit)
 */

import { ApiService } from './api';
import {
  StaffMember,
  StaffTransaction,
  StaffTxType,
  StaffBalance,
  SalarySummary,
} from '../types/models';
import { generateStaffCode, confirmStaffCode, seedStaffCounter } from '../utils/idGenerator';

const STAFF_COL = 'staff';
const STAFF_TX_COL = 'staff_transactions';

/* ─── Type helpers ─────────────────────────────────────────────────────────── */

/** Types that increase "money with staff" (credits to the staff pool). */
const CREDIT_TYPES: StaffTxType[] = ['COLLECTION', 'EXPENSE_ADVANCE', 'SALARY_ADVANCE'];

/** Types that decrease "money with staff" (debits from the staff pool). */
const DEBIT_TYPES: StaffTxType[] = ['STAFF_EXPENSE', 'SETTLEMENT'];

/** Human-readable labels for each transaction type. */
export const STAFF_TX_LABELS: Record<StaffTxType, string> = {
  SALARY_PAYMENT:  'Salary Payment',
  SALARY_ADVANCE:  'Salary Advance',
  EXPENSE_ADVANCE: 'Expense Advance',
  STAFF_EXPENSE:   'Staff Expense',
  COLLECTION:      'Collection',
  SETTLEMENT:      'Settlement',
  REIMBURSEMENT:   'Reimbursement',
  ADJUSTMENT:      'Adjustment',
};

export const EXPENSE_PURPOSES = [
  'Petrol / Fuel', 'Delivery / Transport', 'Labour', 'Loading / Unloading',
  'Food', 'Accommodation', 'Purchases', 'Miscellaneous',
];

export const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other'] as const;

/* ─── Balance Calculation ──────────────────────────────────────────────────── */

/**
 * Pure function — derive StaffBalance from an array of transactions.
 * Called client-side from the TanStack Query cache — zero Firestore reads.
 */
export function calculateBalance(
  txs: StaffTransaction[],
  staff: StaffMember,
): StaffBalance {
  const active = txs.filter(t => !t.deleted);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let totalCollections    = 0;
  let totalExpenseAdv     = 0;
  let totalSalaryAdv      = 0;
  let totalExpenses       = 0;
  let totalSettlements    = 0;
  let totalAdjustments    = 0;
  let salaryPaidThisMonth = 0;
  let salaryAdvThisMonth  = 0;

  active.forEach(t => {
    const amt = Number(t.amount) || 0;
    switch (t.type) {
      case 'COLLECTION':      totalCollections  += amt; break;
      case 'EXPENSE_ADVANCE': totalExpenseAdv   += amt; break;
      case 'SALARY_ADVANCE':  totalSalaryAdv    += amt; break;
      case 'STAFF_EXPENSE':   totalExpenses     += amt; break;
      case 'SETTLEMENT':      totalSettlements  += amt; break;
      case 'ADJUSTMENT':      totalAdjustments  += amt; break; // signed
      case 'SALARY_PAYMENT':
        if (t.salary_month === currentMonth) salaryPaidThisMonth += amt;
        break;
      default: break;
    }
    if (t.type === 'SALARY_ADVANCE' && t.salary_month === currentMonth) {
      salaryAdvThisMonth += amt;
    }
  });

  const moneyWithStaff =
    totalCollections + totalExpenseAdv + totalSalaryAdv
    - totalExpenses - totalSettlements
    + totalAdjustments;

  const salaryDueThisMonth    = Number(staff.monthly_salary) || 0;
  const pendingSalaryThisMonth = salaryDueThisMonth - salaryPaidThisMonth - salaryAdvThisMonth;

  return {
    staffId: staff.id!,
    moneyWithStaff,
    totalCollections,
    totalExpenseAdvances: totalExpenseAdv,
    totalSalaryAdvances:  totalSalaryAdv,
    totalExpenses,
    totalSettlements,
    totalAdjustments,
    salaryPaidThisMonth,
    salaryDueThisMonth,
    pendingSalaryThisMonth,
  };
}

/**
 * Build a salary summary for a given month ("2026-06").
 */
export function getSalarySummary(
  txs: StaffTransaction[],
  staff: StaffMember,
  month: string,
): SalarySummary {
  const relevant = txs.filter(
    t => !t.deleted && t.salary_month === month &&
      (t.type === 'SALARY_PAYMENT' || t.type === 'SALARY_ADVANCE')
  );
  const payments = relevant.filter(t => t.type === 'SALARY_PAYMENT');
  const advances = relevant.filter(t => t.type === 'SALARY_ADVANCE');

  const totalPaid    = payments.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalAdvance = advances.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const due          = Number(staff.monthly_salary) || 0;

  return {
    month,
    monthlySalary: due,
    totalPaid,
    totalAdvance,
    pending: due - totalPaid - totalAdvance,
    payments: relevant,
  };
}

/* ─── Derived ledger helpers ───────────────────────────────────────────────── */

/**
 * Filter existing transactions/ledger to those attributed to a staff member.
 * This is a READ-ONLY derived view — no writes.
 */
export function deriveStaffActivity(
  staffName: string,
  transactions: any[],
  ledgerEntries: any[],
): { collections: any[]; payments: any[] } {
  const n = staffName.toLowerCase().trim();
  const collections = [
    ...transactions.filter(t => (t.received_by || '').toLowerCase().trim() === n && t.type === 'received'),
    ...ledgerEntries.filter(l => (l.payment_received_by || '').toLowerCase().trim() === n),
  ];
  const payments = [
    ...transactions.filter(t => (t.paid_by || '').toLowerCase().trim() === n && t.type === 'paid'),
    ...ledgerEntries.filter(l => (l.paid_to || '').toLowerCase().trim() === n),
  ];
  return { collections, payments };
}

/* ─── CRUD ─────────────────────────────────────────────────────────────────── */

export const StaffService = {
  /** Fetch all staff for a user (not deleted via status). */
  getAll: async (uid: string): Promise<StaffMember[]> => {
    const snap = await ApiService.getAll(uid, STAFF_COL);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })) as StaffMember[];
  },

  /** Fetch all staff transactions for a user (filter by staffId in-memory for cache reuse). */
  getAllTransactions: async (uid: string): Promise<StaffTransaction[]> => {
    const snap = await ApiService.getAll(uid, STAFF_TX_COL);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })) as StaffTransaction[];
  },

  /** Create a new staff member. Returns the created doc with its ID. */
  create: async (uid: string, data: Omit<StaffMember, 'id' | 'staff_code'>, createdBy: string): Promise<StaffMember> => {
    const now = new Date().toISOString();
    const staff_code = generateStaffCode();
    const payload: Omit<StaffMember, 'id'> = {
      ...data,
      staff_code,
      created_at: now,
      updated_at: now,
      created_by: createdBy,
    };
    const docRef = await ApiService.add(uid, STAFF_COL, payload);
    confirmStaffCode(staff_code);
    return { id: docRef.id, ...payload };
  },

  /** Update a staff member. */
  update: async (uid: string, staffId: string, data: Partial<StaffMember>, updatedBy: string): Promise<void> => {
    const payload = { ...data, updated_at: new Date().toISOString(), updated_by: updatedBy };
    await ApiService.update(uid, STAFF_COL, staffId, payload);
  },

  /** Soft-deactivate (never hard-delete). */
  deactivate: async (uid: string, staffId: string): Promise<void> => {
    await ApiService.update(uid, STAFF_COL, staffId, {
      status: 'inactive', updated_at: new Date().toISOString(),
    });
  },

  /** Add a staff transaction. */
  addTransaction: async (
    uid: string,
    tx: Omit<StaffTransaction, 'id' | 'created_at' | 'updated_at'>,
    createdBy: string,
  ): Promise<StaffTransaction> => {
    const now = new Date().toISOString();
    const payload: Omit<StaffTransaction, 'id'> = {
      ...tx,
      created_at: now,
      updated_at: now,
      created_by: createdBy,
      deleted: false,
    };
    const docRef = await ApiService.add(uid, STAFF_TX_COL, payload);
    return { id: docRef.id, ...payload };
  },

  /** Update a staff transaction. */
  updateTransaction: async (uid: string, txId: string, data: Partial<StaffTransaction>): Promise<void> => {
    await ApiService.update(uid, STAFF_TX_COL, txId, {
      ...data,
      updated_at: new Date().toISOString(),
    });
  },

  /** Soft-delete a transaction — sets deleted: true. */
  deleteTransaction: async (uid: string, txId: string): Promise<void> => {
    await ApiService.update(uid, STAFF_TX_COL, txId, {
      deleted: true, updated_at: new Date().toISOString(),
    });
  },

  /** Seed counter from existing staff codes (call on app init). */
  seedCounter: (staff: StaffMember[]) => {
    seedStaffCounter(staff.map(s => s.staff_code));
  },

  CREDIT_TYPES,
  DEBIT_TYPES,
};
