// Strict TypeScript Interfaces for Data Models

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







