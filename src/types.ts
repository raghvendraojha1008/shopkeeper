export interface UserProfile {
  firm_name: string;
  owner_name: string;
  contact: string;
  address: string;
  gstin: string;
  currency_symbol: string;
  state?: string;
  invoice_prefix?: string;
  terms?: string;
  bank_details?: string;
  site_name?: string;
  credit_limit?: number;
  logo_base64?: string;
  authorized_signatory?: string;
  business_email?: string;

}

export interface AppSettings {
  visibility?: any;
  profile: UserProfile;
  preferences: {
      dark_mode: boolean;
      haptics_enabled: boolean;
      language: string;
      theme?: string;
      custom_primary_hsl?: { h: number; s: number; l: number };
  };
  security?: { 
      enabled: boolean;
      pin: string;
      enable_biometrics: boolean;
  };
  automation: {
      enable_date_filter: boolean;
      auto_calculate_gst: boolean;
      auto_update_inventory: boolean;
      show_delete_btn: boolean;
      enable_vibration: boolean;
      default_unit: string;
      low_stock_warning: boolean;
      allow_negative_stock: boolean;
      auto_reminder_enabled?: boolean;
      auto_reminder_days?: number;
  };
  field_visibility: {
      ledger: {
          invoice_no: boolean;
          vehicle: boolean;
          vehicle_rent: boolean;
          payment_received_by: boolean;
          notes: boolean;
          address: boolean;
          paid_to: boolean;
      };
      transactions: {
          received_by: boolean;
          paid_by: boolean;
          notes: boolean;
      };
      inventory: {
          hsn_code: boolean;
          gst_percent: boolean;
          price_type: boolean;
          supplier_name: boolean;
      };
      parties: {
          gstin: boolean;
          address: boolean;
          site: boolean;
          state: boolean;
      };
      vehicles: {
          driver_name: boolean;
          model: boolean;
          notes: boolean;
      };
  };
  custom_lists: {
      expense_types: string[];
      payment_modes: string[];
      received_by_names: string[];
      paid_by_names: string[];
      purposes: string[];
      staff?: string[];
      charge_types?: string[];
      inventory_units?: string[];
  };
  invoice_template?: any;
  edit_password?: {
    enabled: boolean;
    password: string;
  };
}







