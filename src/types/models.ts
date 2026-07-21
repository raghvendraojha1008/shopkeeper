// Strict TypeScript Interfaces for Data Models

/* ─── Staff Management ─────────────────────────────────────────────────────── */

export type SalaryType = 'monthly' | 'daily' | 'weekly' | 'contract';
export type StaffStatus = 'active' | 'inactive';

export interface StaffMember {
  id?: string;                      // Firestore doc ID = immutable staffId
  staff_code?: string;              // ST-0001 — display ID, auto-assigned
  name: string;
  phone?: string;
  address?: string;
  joining_date?: string;            // ISO date YYYY-MM-DD
  monthly_salary?: number;
  salary_type: SalaryType;
  status: StaffStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export type StaffTxType =
  | 'SALARY_PAYMENT'      // owner pays salary — tracked separately, not in balance
  | 'SALARY_ADVANCE'      // cash advance against salary — increases money with staff
  | 'EXPENSE_ADVANCE'     // petty cash handed to staff — increases money with staff
  | 'STAFF_EXPENSE'       // staff spent on business (petrol, food…) — decreases balance
  | 'COLLECTION'          // staff collected from customer/vendor — increases balance
  | 'SETTLEMENT'          // staff returns cash to owner — decreases balance
  | 'REIMBURSEMENT'       // owner repays staff's out-of-pocket spend
  | 'ADJUSTMENT';         // manual correction (signed amount)

export interface StaffTransaction {
  id?: string;
  staff_id: string;                  // immutable staffId — NEVER the name
  type: StaffTxType;
  date: string;                      // YYYY-MM-DD
  amount: number;                    // always positive; direction inferred from type
  payment_mode?: 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'Other';
  purpose?: string;                  // salary month description, expense category, etc.
  description?: string;
  notes?: string;
  reference_number?: string;         // UPI ref, cheque number, bank ref
  attachment_url?: string;
  salary_month?: string;             // "2026-06" — required for SALARY_PAYMENT & SALARY_ADVANCE
  linked_transaction_id?: string;    // back-ref to transactions/{id} if applicable
  linked_ledger_id?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  deleted?: boolean;                 // soft-delete; never hard-delete
}

export interface StaffBalance {
  staffId: string;
  moneyWithStaff: number;           // positive = staff holds biz cash; negative = owner owes
  totalCollections: number;
  totalExpenseAdvances: number;
  totalSalaryAdvances: number;
  totalExpenses: number;
  totalSettlements: number;
  totalAdjustments: number;         // signed
  salaryPaidThisMonth: number;
  salaryDueThisMonth: number;
  pendingSalaryThisMonth: number;
}

export interface SalarySummary {
  month: string;                    // "2026-06"
  monthlySalary: number;
  totalPaid: number;
  totalAdvance: number;
  pending: number;
  payments: StaffTransaction[];
}

/* ─── End Staff Management ─────────────────────────────────────────────────── */

export interface ServiceItem {
  id?: string;
  service_code?: string;
  name: string;
  unit: string;
  rate_per_unit: number;
  category?: string;
  notes?: string;
  created_at?: string;
}

export interface InventoryItem {
  id?: string;
  name: string;
  unit: 'Pcs' | 'Kg' | 'Bag' | 'Ltr' | 'Mtr' | 'Box' | 'Set' | 'Doz' | string;
  hsn_code?: string;
  gst_percent?: number;
  price_type: 'inclusive' | 'exclusive';
  sale_rate: number;
  purchase_rate: number;
  current_stock: number;
  min_stock: number;
  primary_supplier?: string;
  created_at?: string;
}

export interface Party {
  id?: string;
  party_code?: string;
  name: string;
  role: 'customer' | 'supplier';
  contact?: string;
  address?: string;
  gstin?: string;
  legal_name?: string;
  site?: string;
  state?: string;
  credit_limit?: number;
  linked_items?: string[];
  opening_balance?: number;
  opening_balance_type?: 'they_owe' | 'we_owe';
  created_at?: string;
}

export interface LedgerEntry {
  id?: string;
  date: string;
  type: 'sell' | 'purchase';
  party_name: string;
  invoice_no?: string;
  bill_no?: string;
  items: LedgerItem[];
  total_amount: number;
  discount_amount?: number;
  vehicle?: string;
  vehicle_rent?: number;
  address?: string;
  notes?: string;
  payment_received_by?: string;
  paid_to?: string;
  created_at?: string;
}

export interface LedgerItem {
  item_name: string;
  quantity: number;
  rate: number;
  unit?: string;
  hsn_code?: string;
  gst_percent?: number;
  price_type?: 'inclusive' | 'exclusive';
  total: number;
}

export interface Transaction {
  id?: string;
  date: string;
  type: 'received' | 'paid';
  party_name: string;
  amount: number;
  payment_mode?: string;
  payment_purpose?: string;
  bill_no?: string;
  notes?: string;
  received_by?: string;
  paid_by?: string;
  transaction_id?: string;
  created_at?: string;
}

export interface Expense {
  id?: string;
  expense_no?: string;
  date: string;
  category: string;
  amount: number;
  notes?: string;
  created_at?: string;
}

export interface Vehicle {
  id?: string;
  vehicle_number: string;
  model?: string;
  driver_name?: string;
  driver_phone?: string;
  created_at?: string;
}

// Query configuration for paginated data
export interface QueryConfig {
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  searchTerm?: string;
  dateFilter?: {
    start: string;
    end: string;
  };
  typeFilter?: string;
}

export interface WasteEntry {
  id?: string;
  item_id: string;
  item_name: string;
  quantity: number;
  date: string;
  reason: 'Wasted' | 'Self-Used';
  note: string;
  uid?: string;
  prefixed_id?: string;
  created_at?: string;
}

// Offline command for AI queuing
export interface OfflineCommand {
  id: string;
  text: string;
  file?: {
    name: string;
    type: string;
    data?: string;       // base64 (web only)
    nativePath?: string; // Capacitor Filesystem path (native only)
  };
  timestamp: number;
  status: 'pending' | 'processing' | 'failed';
  retries: number;
}







