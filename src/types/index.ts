export interface UserProfile {
  firm_name: string;
  address: string;
  gstin: string;
  contact: string;
  state: string;
  financial_year_start: string;
  currency_symbol: string;
  date_format: string;
  invoice_prefix: string;
}

export interface RolePermissions {
  can_delete: boolean;
  can_export: boolean;
  can_edit_locked: boolean;
  allowed_sections: string[];
}

export interface AutomationSettings {
  enable_date_filter: boolean;
  auto_calculate_gst: boolean;
  auto_update_inventory: boolean;
  auto_distribute_payments: boolean;
  show_delete_btn: boolean;
  enable_vibration: boolean;
  allow_negative_stock: boolean; // --- FIXED VARIABLE NAME ---
  default_payment_mode: string;
  default_gst_percent: number;
  default_price_type: 'inclusive' | 'exclusive';
  default_unit: string;
  default_filter_period: 'current_month' | 'current_year' | 'current_business_year' | 'all';
}

export interface SecuritySettings {
    enabled: boolean;
    pin: string;
    timeout: number;
    enable_biometrics: boolean;
}

export interface AISettings {
  enabled: boolean;
  language: string;
  auto_process: boolean;
}

export interface UserDefaults {
  payment_mode: string;
  gst_percent: number;
  price_type: string;
  unit: string;
}

export interface FieldVisibility {
  transactions: { received_by: boolean; payment_purpose: boolean; notes: boolean; payment_mode: boolean; paid_by: boolean; };
  ledger: { address: boolean; vehicle: boolean; vehicle_rent: boolean; notes: boolean; invoice_no: true; payment_received_by: true; paid_to: true };
  inventory: { hsn_code: boolean; gst_percent: boolean; price_type: boolean; supplier_name: boolean; default_rate: boolean };
  parties: { gstin: boolean; site: boolean; state: boolean; address: boolean };
  vehicles: { driver_name: boolean; model: boolean; notes: boolean };
}

export interface AppSettings {
  profile: UserProfile;
  roles: { owner: RolePermissions; manager: RolePermissions; accountant: RolePermissions; staff: RolePermissions };
  automation: AutomationSettings;
  security: SecuritySettings;
  ai: AISettings;
  defaults: UserDefaults;
  active_role: 'owner' | 'manager' | 'accountant' | 'staff';
  field_visibility: FieldVisibility;
  custom_lists: {
      expense_types: string[];
      payment_modes: string[];
      received_by_names: string[];
      paid_by_names: string[];
      purposes: string[];
      staff_members?: string[];
      charge_types?: string[];
      vehicle_types?: string[];
      inventory_units?: string[];
  };
}







