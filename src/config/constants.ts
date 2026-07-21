import { AppSettings } from '../types';

const _sysDark =
  typeof window !== 'undefined'
    ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true)
    : true;

// FIX: Cast (import.meta as any) to bypass strict TS check on .env
export const GEMINI_API_KEY = (import.meta as any).env.VITE_GEMINI_API_KEY || "";

export const EDIT_PASSWORD_DEFAULT = '1234';

export const DEFAULT_SETTINGS: AppSettings = {
  profile: {
      firm_name: "My Enterprise",
      owner_name: "Owner",
      address: "",
      gstin: "",
      contact: "",
      currency_symbol: "₹",
  },
  preferences: {
      dark_mode: _sysDark,
      haptics_enabled: true,
      language: 'en',
      // Heartwarming default accent
      theme: 'warm-saffron',
  },
  security: {
      enabled: false,
      pin: '',
      enable_biometrics: false,
  },
  automation: {
      enable_date_filter: true,
      auto_calculate_gst: true,
      auto_update_inventory: true,
      show_delete_btn: true,
      enable_vibration: true,
      default_unit: 'Pcs',
      low_stock_warning: true,
      allow_negative_stock: true,
      last_order_autofill: true,
      last_order_autofill_fields: {
          rate: true,
          gst_percent: true,
          unit: true,
          quantity: true,
      },
  },
  edit_password: {
      enabled: false,
      password: '1234',
  },
  field_visibility: {
      ledger: {
          invoice_no: true,
          vehicle: true,
          vehicle_rent: true,
          payment_received_by: true,
          notes: true,
          address: true,
          paid_to: true
      },
      transactions: {
          received_by: true,
          paid_by: true,
          notes: true
      },
      inventory: {
          hsn_code: true,
          gst_percent: true,
          price_type: true,
          supplier_name: true
      },
      parties: {
          gstin: true,
          address: true,
          site: true,
          state: true
      },
      vehicles: {
          driver_name: true,
          model: true,
          notes: true
      }
  },
  custom_lists: {
      expense_types: ['Rent', 'Electricity', 'Salary', 'Tea/Snacks', 'Fuel', 'Maintenance', 'Other'],
      payment_modes: ['Cash', 'UPI', 'Bank Transfer', 'Cheque'],
      received_by_names: ['Owner', 'Manager', 'Staff'],
      paid_by_names: ['Owner', 'Manager'],
      purposes: ['Advance', 'Bill Payment', 'Loan', 'Other'],
      charge_types: ['Loading', 'Unloading', 'Loading & Unloading', 'Handling', 'Packing'],
      staff_members: ['Owner', 'Staff'],
      inventory_units: ['Pcs', 'Kg', 'Gm', 'Mg', 'Ton', 'Ltr', 'Ml', 'Mtr', 'Cm', 'Ft', 'Inch', 'Bag', 'Box', 'Set', 'Doz', 'Pair', 'Pack', 'Roll', 'Sheet', 'Bundle', 'Carton', 'Bottle', 'Can', 'Tube', 'Sack', 'Plate', 'Unit'],
  }
};







