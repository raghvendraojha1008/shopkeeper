import React, { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { BackStack } from '../../services/backStack';
import {
  ArrowLeft, Upload, Download, CheckCircle2, AlertTriangle, XCircle,
  Loader2, Package, Users, ChevronRight, RefreshCw, Eye, EyeOff,
  Wallet, Truck, Receipt, TrendingUp, TrendingDown, BookOpen, FileDown,
  Sparkles, Zap,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { ApiService } from '../../services/api';
import { invalidateAll } from '../../context/DataContext';
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import { getGeminiApiKey, isGeminiConfigured } from '../../services/geminiKey';

type ImportType = 'inventory' | 'parties' | 'sale' | 'purchase' | 'transactions' | 'expenses' | 'vehicles';
type Step = 'type' | 'upload' | 'map' | 'preview' | 'done';
interface ColDef { key: string; label: string; required: boolean; hint?: string; }
interface RowResult { mapped: Record<string, string>; errors: string[]; }
interface ImportResult { success: number; skipped: number; rowErrors: string[]; }

const ITEM_SLOTS = 5;

function makeItemCols(slots: number): ColDef[] {
  const cols: ColDef[] = [];
  for (let i = 1; i <= slots; i++) {
    cols.push(
      { key: `item${i}_name`, label: `Item ${i} Name`, required: false },
      { key: `item${i}_qty`,  label: `Item ${i} Qty`,  required: false, hint: 'Quantity' },
      { key: `item${i}_rate`, label: `Item ${i} Rate`, required: false, hint: 'Unit rate' },
    );
  }
  return cols;
}

const SALE_ITEM_COLS: ColDef[] = makeItemCols(ITEM_SLOTS);
const PURCHASE_ITEM_COLS: ColDef[] = makeItemCols(ITEM_SLOTS);

function detectMaxItemSlot(headers: string[]): number {
  let max = 0;
  for (const h of headers) {
    const m = h.match(/item\s*(\d+)/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

function buildDynamicSchema(type: 'sale' | 'purchase', slots: number): ColDef[] {
  const base = SCHEMA[type].filter(c => !c.key.startsWith('item'));
  return [...base, ...makeItemCols(slots)];
}

const SCHEMA: Record<ImportType, ColDef[]> = {
  inventory: [
    { key: 'name',             label: 'Item Name',        required: true  },
    { key: 'sale_rate',        label: 'Sale Rate',        required: true  },
    { key: 'purchase_rate',    label: 'Purchase Rate',    required: false },
    { key: 'quantity',         label: 'Opening Stock',    required: false, hint: 'Default 0' },
    { key: 'unit',             label: 'Unit',             required: false, hint: 'Pcs/Kg/Bag…' },
    { key: 'hsn_code',         label: 'HSN Code',         required: false },
    { key: 'gst_percent',      label: 'GST %',            required: false, hint: '0/5/12/18/28' },
    { key: 'price_type',       label: 'GST Type',         required: false, hint: 'inclusive/exclusive' },
    { key: 'min_stock',        label: 'Min Stock Alert',  required: false },
    { key: 'primary_supplier', label: 'Primary Supplier', required: false },
  ],
  parties: [
    { key: 'name',         label: 'Party Name',   required: true  },
    { key: 'role',         label: 'Role',         required: true,  hint: 'customer / supplier' },
    { key: 'contact',      label: 'Phone',        required: false },
    { key: 'gstin',        label: 'GSTIN',        required: false },
    { key: 'legal_name',   label: 'Legal Name',   required: false },
    { key: 'address',      label: 'Address',      required: false },
    { key: 'site',         label: 'Site',         required: false },
    { key: 'state',        label: 'State',        required: false },
    { key: 'credit_limit', label: 'Credit Limit', required: false },
  ],
  sale: [
    { key: 'date',              label: 'Date (YYYY-MM-DD)',   required: true  },
    { key: 'party_name',        label: 'Party Name',          required: true  },
    { key: 'total_amount',      label: 'Total Amount',        required: false, hint: 'Auto-calc from items if left blank' },
    { key: 'invoice_no',        label: 'Invoice No',          required: false },
    { key: 'bill_no',           label: 'Bill No',             required: false },
    { key: 'seller_invoice_no', label: 'Seller Invoice No',   required: false },
    { key: 'vehicle',           label: 'Vehicle',             required: false },
    { key: 'vehicle_rent',      label: 'Vehicle Rent',        required: false },
    { key: 'discount_amount',   label: 'Discount',            required: false },
    { key: 'address',           label: 'Address',             required: false },
    { key: 'notes',             label: 'Notes',               required: false },
    ...SALE_ITEM_COLS,
  ],
  purchase: [
    { key: 'date',              label: 'Date (YYYY-MM-DD)',   required: true  },
    { key: 'party_name',        label: 'Supplier Name',       required: true  },
    { key: 'total_amount',      label: 'Total Amount',        required: false, hint: 'Auto-calc from items if left blank' },
    { key: 'bill_no',           label: 'Purchase Bill No',    required: false },
    { key: 'invoice_no',        label: 'Invoice No',          required: false },
    { key: 'seller_invoice_no', label: 'Seller Invoice No',   required: false },
    { key: 'vehicle',           label: 'Vehicle',             required: false },
    { key: 'vehicle_rent',      label: 'Vehicle Rent',        required: false },
    { key: 'discount_amount',   label: 'Discount',            required: false },
    { key: 'address',           label: 'Address',             required: false },
    { key: 'notes',             label: 'Notes',               required: false },
    ...PURCHASE_ITEM_COLS,
  ],
  transactions: [
    { key: 'date',                  label: 'Date (YYYY-MM-DD)',    required: true  },
    { key: 'type',                  label: 'Type',                 required: true,  hint: 'received / paid' },
    { key: 'party_name',            label: 'Party Name',           required: true  },
    { key: 'amount',                label: 'Amount',               required: true  },
    { key: 'payment_mode',          label: 'Payment Mode',         required: false, hint: 'Cash/UPI/Bank Transfer' },
    { key: 'payment_purpose',       label: 'Payment Purpose',      required: false },
    { key: 'transaction_reference', label: 'Bank Ref / UTR No',    required: false },
    { key: 'bill_no',               label: 'Bill No',              required: false },
    { key: 'notes',                 label: 'Notes',                required: false },
  ],
  expenses: [
    { key: 'date',     label: 'Date (YYYY-MM-DD)', required: true  },
    { key: 'category', label: 'Category',          required: true  },
    { key: 'amount',   label: 'Amount',            required: true  },
    { key: 'notes',    label: 'Notes',             required: false },
  ],
  vehicles: [
    { key: 'vehicle_number', label: 'Vehicle Number', required: true  },
    { key: 'model',          label: 'Model',          required: false },
    { key: 'owner_name',     label: 'Owner Name',     required: false },
    { key: 'owner_phone',    label: 'Owner Phone',    required: false },
    { key: 'driver_name',    label: 'Driver Name',    required: false },
    { key: 'driver_phone',   label: 'Driver Phone',   required: false },
  ],
};

function makeItemCsvHeaders() {
  const h: string[] = [];
  for (let i = 1; i <= ITEM_SLOTS; i++) h.push(`Item ${i} Name`, `Item ${i} Qty`, `Item ${i} Rate`);
  return h.join(',');
}

const TEMPLATES: Record<ImportType, string> = {
  inventory: 'Item Name,Sale Rate,Purchase Rate,Opening Stock,Unit,HSN Code,GST %,GST Type,Min Stock Alert,Primary Supplier\nCement Bag 50kg,380,340,100,Bag,2523,18,exclusive,10,Ambuja Cements\nSteel Rod 12mm,72,68,500,Kg,7213,18,inclusive,50,Tata Steel',
  parties:   'Party Name,Role,Phone,GSTIN,Legal Name,Address,Site,State,Credit Limit\nRamesh Enterprises,customer,9876543210,27ABCDE1234F1Z5,Ramesh Pvt Ltd,Mumbai,Main Branch,Maharashtra,50000\nSuresh Traders,supplier,9123456789,,,,Warehouse,Delhi,',
  sale:      `Date (YYYY-MM-DD),Party Name,Total Amount,Invoice No,Bill No,Seller Invoice No,Vehicle,Vehicle Rent,Discount,Address,Notes,${makeItemCsvHeaders()}\n2024-04-01,Ramesh Enterprises,,INV/001,,,,,0,,Cash Sale,Cement Bag 50kg,10,380,Steel Rod 12mm,5,72,,,,,,,,\n2024-04-02,Suresh Retail,4500,INV/002,,,,MH12AB1234,2000,0,Mumbai,Monthly delivery,,,,,,,,,,,,,,`,
  purchase:  `Date (YYYY-MM-DD),Supplier Name,Total Amount,Purchase Bill No,Invoice No,Seller Invoice No,Vehicle,Vehicle Rent,Discount,Address,Notes,${makeItemCsvHeaders()}\n2024-04-01,Suresh Traders,,PO/001,,SEL-001,MH12AB1234,2000,500,Mumbai,Monthly stock,Cement Bag 50kg,200,340,,,,,,,,,,,\n2024-04-02,Ambuja Cements,48000,,INV/2024-01,,,,0,Gujarat,Bulk purchase,,,,,,,,,,,,,,`,
  transactions: 'Date (YYYY-MM-DD),Type,Party Name,Amount,Payment Mode,Payment Purpose,Bank Ref / UTR No,Bill No,Notes\n2024-04-01,received,Ramesh Enterprises,5000,UPI,Bill Payment,UTR123456789,,Against INV/001\n2024-04-02,paid,Suresh Traders,12000,Bank Transfer,Advance,NEFT987654321,PO/001,',
  expenses:  'Date (YYYY-MM-DD),Category,Amount,Notes\n2024-04-01,Fuel,500,Delivery truck\n2024-04-02,Electricity,3200,Monthly bill',
  vehicles:  'Vehicle Number,Model,Owner Name,Owner Phone,Driver Name,Driver Phone\nMH12AB1234,Tata Ace,Rajesh Kumar,9876543210,Raju,9876543210\nMH14CD5678,Mahindra Bolero,Suresh Sharma,9123456789,Sunil,9123456789',
};

const COLLECTION: Record<ImportType, string> = {
  inventory: 'inventory', parties: 'parties',
  sale: 'ledger_entries', purchase: 'ledger_entries',
  transactions: 'transactions', expenses: 'expenses', vehicles: 'vehicles',
};

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI AI COLUMN MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uses Gemini to intelligently map CSV headers to schema keys.
 * Returns a mapping object { schemaKey -> csvHeader } or throws on failure.
 */
async function geminiMapColumns(
  csvHeaders: string[],
  schema: ColDef[],
  importType: ImportType,
): Promise<Record<string, string>> {
  const apiKey = getGeminiApiKey();
  if (!apiKey || apiKey.includes('YOUR_API') || apiKey.length < 10) {
    throw new Error('Gemini API key not configured');
  }

  const MODEL_NAME = 'gemini-2.5-flash';
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

  const schemaDescription = schema
    .map(c => `  "${c.key}" (label: "${c.label}"${c.required ? ', REQUIRED' : ''}${c.hint ? `, hint: ${c.hint}` : ''})`)
    .join('\n');

  const prompt = `You are a data mapping assistant. Your job is to match CSV column headers to database schema field keys.

IMPORT TYPE: ${importType}

CSV HEADERS (from the user's file):
${csvHeaders.map((h, i) => `  ${i}: "${h}"`).join('\n')}

SCHEMA FIELDS (map CSV headers to these keys):
${schemaDescription}

RULES:
1. Output ONLY a valid JSON object. No markdown, no explanation, no code fences.
2. Keys must be exact schema field keys from the list above.
3. Values must be exact CSV header strings from the list above.
4. Only include mappings where you are confident. Skip fields with no good match.
5. One CSV header can only map to one schema key.
6. For item slots like "item1_name", "item1_qty", "item1_rate" — match based on the number AND type (Name/Qty/Rate).
   For example: "Item 1 Name" -> "item1_name", "Item 1 Qty" -> "item1_qty", "Item 2 Rate" -> "item2_rate".
7. Be smart about synonyms: "Customer" = party_name, "Quantity" = qty, "Price" = rate, "Invoice Number" = invoice_no, etc.

OUTPUT FORMAT:
{"schemaKey": "CSV Header", ...}`;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error ${response.status}`);
  }

  const data = await response.json();
  let raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Strip markdown fences if present
  raw = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  // Extract JSON object
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in Gemini response');

  const parsed: Record<string, string> = JSON.parse(raw.substring(start, end + 1));

  // Validate: only keep entries where key is in schema and value is in headers
  const schemaKeys   = new Set(schema.map(c => c.key));
  const headerSet    = new Set(csvHeaders);
  const usedHeaders  = new Set<string>();
  const validated: Record<string, string> = {};

  for (const [key, header] of Object.entries(parsed)) {
    if (schemaKeys.has(key) && headerSet.has(header) && !usedHeaders.has(header)) {
      validated[key] = header;
      usedHeaders.add(header);
    }
  }

  return validated;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXED FALLBACK: Local heuristic column mapping (bug-fixed version)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed local auto-mapping that correctly handles item slots.
 * The original code had a bug where ALL item columns matched "Item 1 Name"
 * because it compared only the first word ("Item" == "Item").
 * This version does a full normalized label match before falling back to key match.
 */
function localMapColumns(csvHeaders: string[], schema: ColDef[]): Record<string, string> {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_\-*()/]/g, '');
  const auto: Record<string, string> = {};
  const usedHeaders = new Set<string>();

  for (const col of schema) {
    const keyNorm   = normalize(col.key);
    const labelNorm = normalize(col.label);

    // Priority 1: exact normalized label match  e.g. "Item 1 Qty" -> "item1qty"
    let match = csvHeaders.find(h => !usedHeaders.has(h) && normalize(h) === labelNorm);

    // Priority 2: exact normalized key match  e.g. "item1_qty" -> "item1qty"
    if (!match) {
      match = csvHeaders.find(h => !usedHeaders.has(h) && normalize(h) === keyNorm);
    }

    // Priority 3: key is a substring of normalized header (safe subset match)
    if (!match && keyNorm.length > 4) {
      match = csvHeaders.find(h => !usedHeaders.has(h) && normalize(h).includes(keyNorm));
    }

    if (match) {
      auto[col.key] = match;
      usedHeaders.add(match);
    }
  }

  return auto;
}

// ─────────────────────────────────────────────────────────────────────────────
// parseCSV (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const results: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let cell = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cell += '"'; i++; }
          else { inQ = false; }
        } else {
          cell += c;
        }
      } else {
        if (c === '"') { inQ = true; }
        else if (c === ',' || c === '\t') { row.push(cell.trim()); cell = ''; }
        else { cell += c; }
      }
    }
    row.push(cell.trim());
    results.push(row);
  }
  return results;
}

function validateRow(row: Record<string, string>, type: ImportType): string[] {
  const errs: string[] = [];
  for (const col of SCHEMA[type]) {
    if (col.required && !row[col.key]?.trim()) errs.push(`"${col.label}" is required`);
  }
  if (type === 'inventory') {
    if (row.sale_rate && isNaN(+row.sale_rate)) errs.push('Sale Rate must be a number');
    if (row.purchase_rate && isNaN(+row.purchase_rate)) errs.push('Purchase Rate must be a number');
    if (row.price_type && !['inclusive','exclusive'].includes(row.price_type.toLowerCase().trim())) errs.push('GST Type must be inclusive or exclusive');
  }
  if (type === 'parties') {
    const r = row.role?.toLowerCase().trim();
    if (r && r !== 'customer' && r !== 'supplier') errs.push('Role must be customer or supplier');
    if (row.gstin && row.gstin.trim() && row.gstin.trim().length !== 15) errs.push('GSTIN must be 15 characters');
  }
  if (type === 'sale' || type === 'purchase') {
    if (row.date && !/^\d{4}-\d{2}-\d{2}$/.test(row.date.trim())) errs.push('Date must be YYYY-MM-DD');
    if (row.total_amount && isNaN(+row.total_amount)) errs.push('Total Amount must be a number');
  }
  if (type === 'transactions') {
    const t = row.type?.toLowerCase().trim();
    if (t && t !== 'received' && t !== 'paid') errs.push('Type must be received or paid');
    if (row.date && !/^\d{4}-\d{2}-\d{2}$/.test(row.date.trim())) errs.push('Date must be YYYY-MM-DD');
    if (row.amount && isNaN(+row.amount)) errs.push('Amount must be a number');
  }
  if (type === 'expenses') {
    if (row.date && !/^\d{4}-\d{2}-\d{2}$/.test(row.date.trim())) errs.push('Date must be YYYY-MM-DD');
    if (row.amount && isNaN(+row.amount)) errs.push('Amount must be a number');
  }
  return errs;
}

function transformRow(row: Record<string, string>, type: ImportType): any {
  const ts = new Date().toISOString();
  if (type === 'inventory') return {
    name: row.name?.trim(), sale_rate: +row.sale_rate || 0, purchase_rate: +row.purchase_rate || 0,
    current_stock: +row.quantity || 0, unit: row.unit?.trim() || 'Pcs', hsn_code: row.hsn_code?.trim() || '',
    gst_percent: +row.gst_percent || 0, price_type: row.price_type?.toLowerCase().trim() || 'exclusive',
    min_stock: +row.min_stock || 5, primary_supplier: row.primary_supplier?.trim() || '',
    created_at: ts, source: 'bulk_import',
  };
  if (type === 'parties') return {
    name: row.name?.trim(), role: row.role?.toLowerCase().trim() || 'customer',
    contact: row.contact?.trim() || '', gstin: row.gstin?.trim().toUpperCase() || '',
    legal_name: row.legal_name?.trim() || '', address: row.address?.trim() || '',
    site: row.site?.trim() || '', state: row.state?.trim() || '',
    credit_limit: +row.credit_limit || 0, created_at: ts, source: 'bulk_import',
  };
  if (type === 'sale' || type === 'purchase') {
    const items: any[] = [];
    // Dynamically detect how many item slots exist in the mapped row
    let maxSlot = 0;
    for (const key of Object.keys(row)) {
      const m = key.match(/^item(\d+)_name$/);
      if (m) maxSlot = Math.max(maxSlot, parseInt(m[1], 10));
    }
    for (let i = 1; i <= Math.max(maxSlot, ITEM_SLOTS); i++) {
      const name = row[`item${i}_name`]?.trim();
      if (name) {
        const qty  = +row[`item${i}_qty`]  || 0;
        const rate = +row[`item${i}_rate`] || 0;
        items.push({ item_name: name, quantity: qty, rate, total: qty * rate, unit: 'Pcs' });
      }
    }
    const autoTotal = items.reduce((s, it) => s + it.total, 0);
    return {
      date: row.date?.trim(),
      type: type === 'sale' ? 'sell' : 'purchase',
      party_name: row.party_name?.trim(),
      total_amount: +row.total_amount || autoTotal || 0,
      invoice_no: row.invoice_no?.trim() || '',
      bill_no: row.bill_no?.trim() || '',
      seller_invoice_no: row.seller_invoice_no?.trim() || '',
      vehicle: row.vehicle?.trim() || '',
      vehicle_rent: +row.vehicle_rent || 0,
      discount_amount: +row.discount_amount || 0,
      address: row.address?.trim() || '',
      notes: row.notes?.trim() || '',
      items,
      created_at: ts, source: 'bulk_import',
    };
  }
  if (type === 'transactions') return {
    date: row.date?.trim(), type: row.type?.toLowerCase().trim() || 'received',
    party_name: row.party_name?.trim(), amount: +row.amount || 0,
    payment_mode: row.payment_mode?.trim() || '', payment_purpose: row.payment_purpose?.trim() || '',
    transaction_reference: row.transaction_reference?.trim().toUpperCase() || '',
    bill_no: row.bill_no?.trim() || '', notes: row.notes?.trim() || '',
    created_at: ts, source: 'bulk_import',
  };
  if (type === 'expenses') return {
    date: row.date?.trim(), category: row.category?.trim() || '',
    amount: +row.amount || 0, notes: row.notes?.trim() || '',
    created_at: ts, source: 'bulk_import',
  };
  return {
    vehicle_number: row.vehicle_number?.trim().toUpperCase() || '',
    model: row.model?.trim() || '',
    owner_name: row.owner_name?.trim() || '',
    owner_phone: row.owner_phone?.trim() || '',
    driver_name: row.driver_name?.trim() || '',
    driver_phone: row.driver_phone?.trim() || '',
    created_at: ts, source: 'bulk_import',
  };
}

async function downloadBlob(blob: Blob, filename: string) {
  await exportService.sharePdfBlob(blob, filename);
}

async function downloadImportGuide() {
  const wb = XLSX.utils.book_new();

  const readmeData = [
    ['SHOPKEEPER — BULK IMPORT GUIDE'],
    [''],
    ['HOW TO USE'],
    ['1. Download the template sheet for the type you want to import (Inventory, Parties, Sales, etc.)'],
    ['2. Fill in your data following the column descriptions below.'],
    ['3. Go to Bulk Import > select the type > upload the file.'],
    ['4. Map columns and preview before importing.'],
    [''],
    ['GENERAL RULES'],
    ['• Date format: YYYY-MM-DD  (e.g. 2024-04-01)'],
    ['• Do not change column headers.'],
    ['• Required columns marked with * must not be empty.'],
    ['• Leave optional columns blank if not applicable.'],
    ['• Numbers: do not include currency symbols (₹) or commas.'],
    ['• Maximum 1000 rows per import.'],
    [''],
    ['COLUMN DESCRIPTIONS'],
    [''],
    ['── INVENTORY ──'],
    ['Item Name *', 'Unique name of the product/item'],
    ['Sale Rate *', 'Selling price per unit'],
    ['Purchase Rate', 'Purchase cost per unit'],
    ['Opening Stock', 'Current quantity in stock (default: 0)'],
    ['Unit', 'Unit of measurement: Pcs / Kg / Bag / Ltr / Mtr / Box'],
    ['HSN Code', '4–8 digit HSN/SAC code for GST'],
    ['GST %', 'GST rate: 0 / 5 / 12 / 18 / 28'],
    ['GST Type', 'inclusive  or  exclusive'],
    ['Min Stock Alert', 'Low stock warning threshold (default: 5)'],
    ['Primary Supplier', 'Name of main supplier'],
    [''],
    ['── PARTIES ──'],
    ['Party Name *', 'Customer or supplier name'],
    ['Role *', 'customer  or  supplier'],
    ['Phone', '10-digit mobile number'],
    ['GSTIN', '15-character GST registration number'],
    ['Legal Name', 'Registered legal entity name'],
    ['Address', 'Full address'],
    ['Site', 'Branch / site / location name'],
    ['State', 'State name (e.g. Maharashtra)'],
    ['Credit Limit', 'Maximum credit amount allowed'],
    [''],
    ['── SALES ──'],
    ['Date *', 'Date of sale (YYYY-MM-DD)'],
    ['Party Name *', 'Customer name (must exist in Parties)'],
    ['Total Amount', 'Invoice total. Leave blank to auto-calculate from items.'],
    ['Invoice No', 'Your invoice number (e.g. INV/001)'],
    ['Bill No', 'Reference bill number'],
    ['Seller Invoice No', "Seller's invoice reference"],
    ['Vehicle', 'Vehicle number used for delivery'],
    ['Vehicle Rent', 'Transport/freight cost'],
    ['Discount', 'Discount amount'],
    ['Address', 'Delivery address'],
    ['Notes', 'Any remarks'],
    ['Item 1–5 Name', 'Product name for line item 1 to 5'],
    ['Item 1–5 Qty', 'Quantity for that line item'],
    ['Item 1–5 Rate', 'Unit rate for that line item'],
    [''],
    ['── PURCHASES ──'],
    ['Same as Sales columns except Party Name = Supplier Name and there is a Purchase Bill No instead of Invoice No.'],
    [''],
    ['── PAYMENTS (Transactions) ──'],
    ['Date *', 'Date of payment (YYYY-MM-DD)'],
    ['Type *', 'received  (money coming in)  or  paid  (money going out)'],
    ['Party Name *', 'Customer or supplier name'],
    ['Amount *', 'Payment amount'],
    ['Payment Mode', 'Cash / UPI / Bank Transfer / Cheque / NEFT / RTGS'],
    ['Payment Purpose', 'Reason: Bill Payment / Advance / Refund…'],
    ['Bank Ref / UTR No', 'Bank reference or UPI transaction ID'],
    ['Bill No', 'Invoice this payment is against'],
    ['Notes', 'Any remarks'],
    [''],
    ['── EXPENSES ──'],
    ['Date *', 'Date (YYYY-MM-DD)'],
    ['Category *', 'Fuel / Electricity / Rent / Salary / Maintenance…'],
    ['Amount *', 'Expense amount'],
    ['Notes', 'Any remarks'],
    [''],
    ['── VEHICLES ──'],
    ['Vehicle Number *', 'Registration number (e.g. MH12AB1234)'],
    ['Model', 'Vehicle model (e.g. Tata Ace)'],
    ['Owner Name', 'Vehicle owner / operator name'],
    ['Owner Phone', 'Owner contact number'],
    ['Driver Name', 'Assigned driver name'],
    ['Driver Phone', 'Driver contact number'],
  ];
  const readmeWs = XLSX.utils.aoa_to_sheet(readmeData);
  readmeWs['!cols'] = [{ wch: 35 }, { wch: 65 }];
  XLSX.utils.book_append_sheet(wb, readmeWs, 'READ ME FIRST');

  const addTemplate = (name: string, schema: ColDef[], rows: any[][]) => {
    const headers = schema.map(c => c.label + (c.required ? ' *' : ''));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = schema.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  addTemplate('Inventory', SCHEMA.inventory, [
    ['Cement Bag 50kg', '380', '340', '100', 'Bag', '2523', '18', 'exclusive', '10', 'Ambuja Cements'],
    ['Steel Rod 12mm', '72', '68', '500', 'Kg', '7213', '18', 'inclusive', '50', 'Tata Steel'],
  ]);
  addTemplate('Parties', SCHEMA.parties, [
    ['Ramesh Enterprises', 'customer', '9876543210', '27ABCDE1234F1Z5', 'Ramesh Pvt Ltd', 'Mumbai', 'Main Branch', 'Maharashtra', '50000'],
    ['Suresh Traders', 'supplier', '9123456789', '', '', '', 'Warehouse', 'Delhi', ''],
  ]);
  const saleItemEx1 = ['Cement Bag 50kg', '10', '380', 'Steel Rod 12mm', '5', '72', '', '', '', '', '', '', '', '', ''];
  const saleItemEx2 = Array(ITEM_SLOTS * 3).fill('');
  addTemplate('Sales', SCHEMA.sale, [
    ['2024-04-01', 'Ramesh Enterprises', '', 'INV/001', '', '', '', '', '0', '', 'Cash Sale', ...saleItemEx1],
    ['2024-04-02', 'Suresh Retail', '4500', 'INV/002', '', '', 'MH12AB1234', '2000', '0', 'Mumbai', 'Monthly delivery', ...saleItemEx2],
  ]);
  const purItemEx   = ['Cement Bag 50kg', '200', '340', '', '', '', '', '', '', '', '', '', '', '', ''];
  addTemplate('Purchases', SCHEMA.purchase, [
    ['2024-04-01', 'Suresh Traders', '', 'PO/001', '', 'SEL-001', 'MH12AB1234', '2000', '500', 'Mumbai', 'Monthly stock', ...purItemEx],
    ['2024-04-02', 'Ambuja Cements', '48000', '', 'INV/2024-01', '', '', '', '0', 'Gujarat', 'Bulk purchase', ...Array(ITEM_SLOTS * 3).fill('')],
  ]);
  addTemplate('Payments', SCHEMA.transactions, [
    ['2024-04-01', 'received', 'Ramesh Enterprises', '5000', 'UPI', 'Bill Payment', 'UTR123456789', '', 'Against INV/001'],
    ['2024-04-02', 'paid', 'Suresh Traders', '12000', 'Bank Transfer', 'Advance', 'NEFT987654321', 'PO/001', ''],
  ]);
  addTemplate('Expenses', SCHEMA.expenses, [
    ['2024-04-01', 'Fuel', '500', 'Delivery truck'],
    ['2024-04-02', 'Electricity', '3200', 'Monthly bill'],
  ]);
  addTemplate('Vehicles', SCHEMA.vehicles, [
    ['MH12AB1234', 'Tata Ace', 'Rajesh Kumar', '9876543210', 'Raju', '9876543210'],
    ['MH14CD5678', 'Mahindra Bolero', 'Suresh Sharma', '9123456789', 'Sunil', '9123456789'],
  ]);

  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  await downloadBlob(new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Shopkeeper_Bulk_Import_Guide.xlsx');
}

// ─────────────────────────────────────────────────────────────────────────────
// GCard helper (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const GCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>{children}</div>
);

// ─────────────────────────────────────────────────────────────────────────────
// BulkImportView
// ─────────────────────────────────────────────────────────────────────────────

interface Props { user: any; settings: any; onBack: () => void; }

const BulkImportView: React.FC<Props> = ({ user, settings, onBack }) => {
  const { showToast } = useUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep]                 = useState<Step>('type');
  const [type, setType]                 = useState<ImportType>('inventory');
  const [headers, setHeaders]           = useState<string[]>([]);
  const [rawRows, setRawRows]           = useState<string[][]>([]);
  const [mapping, setMapping]           = useState<Record<string, string>>({});
  const [rows, setRows]                 = useState<RowResult[]>([]);
  const [expanded, setExpanded]         = useState<number | null>(null);
  const [importing, setImporting]       = useState(false);
  const [result, setResult]             = useState<ImportResult | null>(null);
  const [showAll, setShowAll]           = useState(false);

  // ── NEW: AI mapping state ──
  const [aiMapping, setAiMapping]       = useState(false);   // loading spinner
  const [aiMapped, setAiMapped]         = useState(false);   // success badge
  const [aiError, setAiError]           = useState<string | null>(null);
  // Tracks the schema actually derived from the uploaded file (may have fewer/more item slots than ITEM_SLOTS)
  const [activeSchema, setActiveSchema] = useState<ColDef[]>(() => SCHEMA['inventory']);

  const isGeminiReady = isGeminiConfigured();

  const TYPE_INFO: Record<ImportType, { Icon: any; label: string; desc: string; color: string; bg: string; border: string }> = {
    inventory:    { Icon: Package,      label: 'Inventory Items',              desc: 'Name, rate, stock, HSN, GST type',        color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.25)'  },
    parties:      { Icon: Users,        label: 'Parties (Customers/Suppliers)', desc: 'Customers & suppliers with GSTIN, state', color: '#60a5fa', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.25)'  },
    sale:         { Icon: TrendingUp,   label: 'Sale Invoices',                desc: 'Date, party, items, amount, vehicle',     color: '#a78bfa', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.25)' },
    purchase:     { Icon: TrendingDown, label: 'Purchase Bills',               desc: 'Date, supplier, items, amount, vehicle',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
    transactions: { Icon: Wallet,       label: 'Payments (Transactions)',      desc: 'Payments received & paid with UTR',       color: '#fbbf24', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
    expenses:     { Icon: Receipt,      label: 'Expenses',                     desc: 'Date, category, amount',                  color: '#f87171', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.25)'  },
    vehicles:     { Icon: Truck,        label: 'Vehicles',                     desc: 'Vehicle number, driver details',           color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.25)' },
  };
  const ti = TYPE_INFO[type];

  const validRows   = useMemo(() => rows.filter(r => r.errors.length === 0), [rows]);
  const invalidRows = useMemo(() => rows.filter(r => r.errors.length > 0),  [rows]);
  const displayRows = showAll ? rows : (invalidRows.length ? invalidRows : rows);

  const dlTemplate = async () => {
    await downloadBlob(new Blob([TEMPLATES[type]], { type: 'text/csv;charset=utf-8;' }), `${type}_template.csv`);
  };

  // ── UPDATED parseFile: try Gemini first, fall back to fixed local logic ──
  const parseFile = useCallback(async (file: File) => {
    try {
      const all = parseCSV(await file.text());
      if (all.length < 2) { showToast('File needs header row + data rows', 'error'); return; }
      const hdrs = all[0];
      const data = all.slice(1).slice(0, 1000);
      setHeaders(hdrs);
      setRawRows(data);
      setAiMapped(false);
      setAiError(null);

      // For sale/purchase, derive schema from actual item slots detected in the CSV.
      // Always show exactly as many item slot rows as exist in the file (min 1, no fixed cap).
      let fileSchema = SCHEMA[type];
      if (type === 'sale' || type === 'purchase') {
        const detected = detectMaxItemSlot(hdrs);
        // Use detected count; fall back to 1 so at least one item row is shown
        fileSchema = buildDynamicSchema(type, Math.max(detected, 1));
      }
      setActiveSchema(fileSchema);

      // ── Step 1: try Gemini AI mapping ──
      if (isGeminiReady) {
        setAiMapping(true);
        try {
          const aiResult = await geminiMapColumns(hdrs, fileSchema, type);
          setMapping(aiResult);
          setAiMapped(true);
          showToast('AI mapped your columns ✨', 'success');
        } catch (err: any) {
          // ── Step 2: fallback to fixed local heuristic ──
          console.warn('[BulkImport] Gemini mapping failed, using local fallback:', err.message);
          setAiError(err.message || 'AI mapping failed');
          const fallback = localMapColumns(hdrs, fileSchema);
          setMapping(fallback);
          showToast('AI unavailable — used smart auto-map instead', 'info');
        } finally {
          setAiMapping(false);
        }
      } else {
        // Gemini not configured — use local fallback directly
        const fallback = localMapColumns(hdrs, fileSchema);
        setMapping(fallback);
      }

      setStep('map');
    } catch { showToast('Could not read file — use CSV format', 'error'); }
  }, [type, isGeminiReady]);

  // ── NEW: Re-run AI mapping on demand from the map step ──
  const retryAiMapping = async () => {
    if (!isGeminiReady || aiMapping) return;
    setAiMapping(true);
    setAiError(null);
    try {
      const aiResult = await geminiMapColumns(headers, activeSchema, type);
      setMapping(aiResult);
      setAiMapped(true);
      showToast('AI re-mapped your columns ✨', 'success');
    } catch (err: any) {
      setAiError(err.message || 'AI mapping failed');
      showToast('AI mapping failed — try manually adjusting', 'error');
    } finally {
      setAiMapping(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = ''; };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) parseFile(f); };

  const buildPreview = () => {
    setRows(rawRows.map(row => {
      const mapped: Record<string, string> = {};
      for (const col of activeSchema) { const h = mapping[col.key]; mapped[col.key] = h ? (row[headers.indexOf(h)] ?? '') : ''; }
      return { mapped, errors: validateRow(mapped, type) };
    }));
    setStep('preview');
  };

  const runImport = async () => {
    setImporting(true); let success = 0, skipped = invalidRows.length; const rowErrors: string[] = [];
    try {
      for (let i = 0; i < validRows.length; i++) {
        try { await ApiService.add(user.uid, COLLECTION[type], transformRow(validRows[i].mapped, type)); success++; }
        catch (e: any) { rowErrors.push(`Row ${i+1}: ${e.message}`); skipped++; }
      }
      setResult({ success, skipped, rowErrors }); setStep('done');
      if (success > 0) invalidateAll(user.uid);
      showToast(`Imported ${success} records!`, 'success');
    } catch (e: any) { showToast('Import failed: ' + e.message, 'error'); }
    finally { setImporting(false); }
  };

  const reset = () => {
    setStep('type'); setHeaders([]); setRawRows([]); setMapping({}); setRows([]);
    setResult(null); setAiMapped(false); setAiError(null);
    setActiveSchema(SCHEMA[type]);
  };
  const STEPS: Step[] = ['type','upload','map','preview','done'];
  const si = STEPS.indexOf(step);

  // ── Android hardware back button: step back through the wizard ────────────
  // Register on the BackStack so the Capacitor back-button handler in App.tsx
  // intercepts presses while the user is inside the flow (steps 1-3) instead of
  // popping the whole tab.  On 'done' the wizard is finished, so we unregister
  // and let the normal tab-history back handle it (returns to whichever tab
  // launched bulk-import).
  useEffect(() => {
    if (si > 0 && step !== 'done') {
      BackStack.register('bulk-import-step', () => setStep(STEPS[si - 1] as Step));
    } else {
      BackStack.unregister('bulk-import-step');
    }
    return () => BackStack.unregister('bulk-import-step');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [si, step]);

  const scrollRef = useScrollMemory('bulk-import');

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto pb-28" style={{ background: 'var(--app-bg)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 px-4 pb-3" style={{paddingTop: '16px',  background: 'rgba(var(--app-bg-rgb),0.96)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={si > 0 && step !== 'done' ? () => setStep(STEPS[si - 1] as Step) : onBack}
            className="p-2 rounded-xl active:scale-95"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(148,163,184,0.7)' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-black text-white">Bulk Import</h1>
            <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(148,163,184,0.4)' }}>CSV · Excel · Google Sheets</p>
          </div>
        </div>
        {/* Step bar */}
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black transition-all"
                style={i === si ? { background: ti.bg, color: ti.color, border: `1px solid ${ti.border}` }
                     : i < si  ? { background: 'rgba(52,211,153,0.1)', color: '#34d399' }
                                : { color: 'rgba(148,163,184,0.3)' }}>
                {i < si && '✓ '}{s}
              </div>
              {i < 4 && <div className="flex-1 h-px" style={{ background: i < si ? '#34d399' : 'rgba(255,255,255,0.07)' }} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">

        {/* STEP 1 — TYPE */}
        {step === 'type' && (
          <>
            {/* Import Guide Download */}
            <div className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(79,70,229,0.15), rgba(139,92,246,0.15))', border: '1px solid rgba(139,92,246,0.3)' }}>
              <div className="p-2.5 rounded-xl flex-shrink-0" style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)' }}>
                <BookOpen size={20} style={{ color: '#a78bfa' }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-black text-white">Import Guide & Templates</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(148,163,184,0.6)' }}>Download the complete guide with all columns explained + sample data for every import type</p>
              </div>
              <button onClick={downloadImportGuide} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-black flex-shrink-0 active:scale-95"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: 'white', boxShadow: '0 4px 12px rgba(79,70,229,0.4)' }}>
                <FileDown size={14} /> Download
              </button>
            </div>

            {/* AI mapping info banner */}
            <div className="flex items-center gap-3 p-3 rounded-2xl" style={{ background: isGeminiReady ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isGeminiReady ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.08)'}` }}>
              <Sparkles size={16} style={{ color: isGeminiReady ? '#a78bfa' : 'rgba(148,163,184,0.4)', flexShrink: 0 }} />
              <p className="text-[10px] font-semibold" style={{ color: isGeminiReady ? 'rgba(167,139,250,0.8)' : 'rgba(148,163,184,0.45)' }}>
                {isGeminiReady
                  ? 'AI column mapping enabled — Gemini will automatically match your CSV headers'
                  : 'AI column mapping unavailable — configure Gemini API key in settings to enable'}
              </p>
            </div>

            <p className="text-sm font-bold" style={{ color: 'rgba(148,163,184,0.6)' }}>What would you like to import?</p>
            {(Object.entries(TYPE_INFO) as [ImportType, typeof ti][]).map(([t, m]) => {
              const sel = type === t;
              return (
                <button key={t} onClick={() => setType(t)} className="w-full flex items-center gap-4 p-4 rounded-2xl active:scale-[0.98] transition-all"
                  style={sel ? { background: m.bg, border: `1.5px solid ${m.border}` } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: sel ? `${m.color}22` : 'rgba(255,255,255,0.06)', border: `1px solid ${sel ? m.border : 'rgba(255,255,255,0.08)'}` }}>
                    <m.Icon size={22} style={{ color: sel ? m.color : 'rgba(148,163,184,0.5)' }} />
                  </div>
                  <div className="text-left flex-1">
                    <p className="font-black text-sm" style={{ color: sel ? m.color : 'rgba(226,232,240,0.85)' }}>{m.label}</p>
                    <p className="text-[10px] font-semibold mt-0.5" style={{ color: 'rgba(148,163,184,0.45)' }}>{m.desc}</p>
                  </div>
                  {sel && <CheckCircle2 size={18} style={{ color: m.color }} />}
                </button>
              );
            })}
            <button onClick={() => setStep('upload')} className="w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-[0.97]"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: 'white', boxShadow: '0 8px 24px rgba(79,70,229,0.4)' }}>
              Continue <ChevronRight size={16} />
            </button>
          </>
        )}

        {/* STEP 2 — UPLOAD */}
        {step === 'upload' && (
          <>
            <GCard>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-white">Download Template</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'rgba(148,163,184,0.5)' }}>Fill this CSV and upload below</p>
                </div>
                <button onClick={dlTemplate} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black flex-shrink-0 active:scale-95"
                  style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}>
                  <Download size={13} /> Template
                </button>
              </div>
              <div className="mt-3 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="px-3 py-1 text-[8px] font-bold uppercase tracking-widest" style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.4)' }}>
                  Sample format
                </div>
                <pre className="px-3 py-2 text-[9px] font-mono overflow-x-auto" style={{ color: 'rgba(148,163,184,0.6)' }}>
                  {TEMPLATES[type].split('\n').slice(0, 3).join('\n')}
                </pre>
              </div>
            </GCard>

            <div onDrop={onDrop} onDragOver={e => e.preventDefault()} onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center gap-4 p-10 rounded-3xl border-2 border-dashed cursor-pointer active:scale-[0.98] transition-all"
              style={{ borderColor: `${ti.color}55`, background: `${ti.color}07` }}>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={onFile} />
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: `${ti.color}18`, border: `1px solid ${ti.color}33` }}>
                {aiMapping
                  ? <Loader2 size={28} className="animate-spin" style={{ color: '#a78bfa' }} />
                  : <Upload size={28} style={{ color: ti.color }} />
                }
              </div>
              <div className="text-center">
                <p className="font-black text-white text-sm">
                  {aiMapping ? 'AI is mapping your columns…' : 'Drop your file here'}
                </p>
                <p className="text-[11px] mt-1" style={{ color: 'rgba(148,163,184,0.5)' }}>
                  {aiMapping ? 'This takes just a moment' : 'or tap to browse · CSV or TSV'}
                </p>
              </div>
            </div>

            {/* AI badge on upload page */}
            {isGeminiReady && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}>
                <Sparkles size={13} style={{ color: '#a78bfa', flexShrink: 0 }} />
                <p className="text-[10px] font-semibold" style={{ color: 'rgba(167,139,250,0.75)' }}>
                  Gemini AI will auto-map your columns after upload
                </p>
              </div>
            )}

            <GCard>
              <p className="text-[9px] font-black uppercase tracking-widest mb-2.5" style={{ color: 'rgba(148,163,184,0.4)' }}>How to export from your app</p>
              {[['Google Sheets','File → Download → CSV'],['Excel','File → Save As → CSV (Comma Delimited)'],['Numbers','File → Export To → CSV'],['OpenOffice','File → Save As → Text CSV']].map(([app, s]) => (
                <div key={app} className="flex gap-2 py-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: ti.color }} />
                  <p className="text-[10px] font-semibold" style={{ color: 'rgba(148,163,184,0.5)' }}><span className="font-black" style={{ color: 'rgba(226,232,240,0.7)' }}>{app}: </span>{s}</p>
                </div>
              ))}
            </GCard>

            <button onClick={() => setStep('type')} className="w-full py-3 rounded-2xl font-black text-sm active:scale-95"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.6)' }}>← Back</button>
          </>
        )}

        {/* STEP 3 — MAP */}
        {step === 'map' && (
          <>
            <GCard>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-black text-white">Match Columns</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'rgba(148,163,184,0.4)' }}>{rawRows.length} rows in your file</p>
                </div>
                <span className="text-[10px] font-black px-2.5 py-1.5 rounded-xl" style={{ background: ti.bg, color: ti.color, border: `1px solid ${ti.border}` }}>
                  {activeSchema.filter(c => mapping[c.key]).length}/{activeSchema.length} mapped
                </span>
              </div>

              {/* ── AI mapping status banner ── */}
              {(aiMapped || aiError || aiMapping) && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2.5 rounded-xl"
                  style={{
                    background: aiMapped
                      ? 'rgba(139,92,246,0.1)'
                      : aiError
                        ? 'rgba(239,68,68,0.08)'
                        : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${aiMapped ? 'rgba(139,92,246,0.3)' : aiError ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)'}`,
                  }}>
                  {aiMapping
                    ? <Loader2 size={13} className="animate-spin flex-shrink-0" style={{ color: '#a78bfa' }} />
                    : aiMapped
                      ? <Sparkles size={13} style={{ color: '#a78bfa', flexShrink: 0 }} />
                      : <AlertTriangle size={13} style={{ color: '#f87171', flexShrink: 0 }} />
                  }
                  <p className="text-[10px] font-semibold flex-1"
                    style={{ color: aiMapped ? 'rgba(167,139,250,0.85)' : aiError ? 'rgba(248,113,113,0.8)' : 'rgba(148,163,184,0.6)' }}>
                    {aiMapping
                      ? 'AI is mapping columns…'
                      : aiMapped
                        ? 'Mapped by Gemini AI — review and adjust if needed'
                        : `AI fallback used: ${aiError}`
                    }
                  </p>
                  {/* Re-try AI button shown when fallback was used or errored */}
                  {!aiMapping && !aiMapped && isGeminiReady && (
                    <button onClick={retryAiMapping}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black flex-shrink-0 active:scale-95"
                      style={{ background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}>
                      <Zap size={10} /> Retry AI
                    </button>
                  )}
                  {/* Re-map button when AI succeeded, lets user trigger a fresh AI map */}
                  {!aiMapping && aiMapped && (
                    <button onClick={retryAiMapping}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black flex-shrink-0 active:scale-95"
                      style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}>
                      <RefreshCw size={10} /> Re-map
                    </button>
                  )}
                </div>
              )}

              {activeSchema.map(col => {
                const hasMissing = col.required && !mapping[col.key];
                const isAiMappedCol = aiMapped && mapping[col.key];
                return (
                  <div key={col.key} className="flex items-center gap-2 mb-2.5">
                    <div className="w-36 flex-shrink-0">
                      <p className="text-[10px] font-black" style={{ color: hasMissing ? '#f87171' : 'rgba(203,213,225,0.7)' }}>
                        {col.label}{col.required ? ' *' : ''}
                      </p>
                      {col.hint && <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.35)' }}>{col.hint}</p>}
                    </div>
                    <div className="flex-1 relative">
                      <select value={mapping[col.key] || ''} onChange={e => setMapping(m => ({ ...m, [col.key]: e.target.value }))}
                        className="w-full px-2 py-1.5 rounded-lg text-[10px] font-bold outline-none"
                        style={{
                          background: isAiMappedCol ? 'rgba(139,92,246,0.1)' : 'rgba(255,255,255,0.07)',
                          border: `1px solid ${hasMissing ? 'rgba(239,68,68,0.4)' : isAiMappedCol ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.12)'}`,
                          color: 'rgba(203,213,225,0.8)',
                          colorScheme: 'dark',
                          paddingRight: isAiMappedCol ? '24px' : undefined,
                        }}>
                        <option value="">— not mapped —</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      {/* Sparkle icon for AI-mapped columns */}
                      {isAiMappedCol && (
                        <Sparkles size={10} style={{ color: '#a78bfa', position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </GCard>
            <button onClick={buildPreview} className="w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-[0.97]"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: 'white', boxShadow: '0 8px 24px rgba(79,70,229,0.4)' }}>
              Preview Import <ChevronRight size={16} />
            </button>
            <button onClick={() => setStep('upload')} className="w-full py-3 rounded-2xl font-black text-sm active:scale-95"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.6)' }}>← Back</button>
          </>
        )}

        {/* STEP 4 — PREVIEW */}
        {step === 'preview' && (
          <>
            {/* Summary bar */}
            <GCard>
              <div className="flex gap-3">
                <div className="flex-1 text-center p-2 rounded-xl" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)' }}>
                  <p className="text-lg font-black" style={{ color: '#34d399' }}>{validRows.length}</p>
                  <p className="text-[9px] font-black uppercase" style={{ color: 'rgba(52,211,153,0.6)' }}>Ready</p>
                </div>
                <div className="flex-1 text-center p-2 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <p className="text-lg font-black" style={{ color: '#f87171' }}>{invalidRows.length}</p>
                  <p className="text-[9px] font-black uppercase" style={{ color: 'rgba(248,113,113,0.6)' }}>Errors</p>
                </div>
                <div className="flex-1 text-center p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <p className="text-lg font-black" style={{ color: 'rgba(226,232,240,0.9)' }}>{rows.length}</p>
                  <p className="text-[9px] font-black uppercase" style={{ color: 'rgba(148,163,184,0.5)' }}>Total</p>
                </div>
              </div>
              {invalidRows.length > 0 && (
                <button onClick={() => setShowAll(v => !v)} className="w-full mt-3 py-2 rounded-xl text-[10px] font-black flex items-center justify-center gap-1.5 active:scale-95"
                  style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.6)' }}>
                  {showAll ? <><EyeOff size={12} /> Show errors only</> : <><Eye size={12} /> Show all rows</>}
                </button>
              )}
            </GCard>

            {/* Row list */}
            {displayRows.map((row, i) => {
              const real = rows.indexOf(row);
              const ok = row.errors.length === 0;
              const isExp = expanded === real;
              return (
                <div key={real} className="rounded-2xl overflow-hidden" style={{ background: ok ? 'rgba(52,211,153,0.06)' : 'rgba(239,68,68,0.07)', border: `1px solid ${ok ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.25)'}` }}>
                  <button className="w-full flex items-center gap-3 p-3" onClick={() => setExpanded(isExp ? null : real)}>
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: ok ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)' }}>
                      {ok ? <CheckCircle2 size={16} style={{ color: '#34d399' }} /> : <AlertTriangle size={16} style={{ color: '#f87171' }} />}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-xs font-black" style={{ color: ok ? '#34d399' : '#f87171' }}>Row {real + 1}</p>
                      <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.5)' }}>
                        {ok ? Object.values(row.mapped).filter(Boolean).slice(0,3).join(' · ') : row.errors[0]}
                      </p>
                    </div>
                  </button>
                  {isExp && (
                    <div className="px-3 pb-3 space-y-1.5 border-t" style={{ borderColor: ok ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.2)' }}>
                      {row.errors.length > 0 && (
                        <div className="pt-2 space-y-1">
                          {row.errors.map((e, j) => <p key={j} className="text-[10px] font-bold" style={{ color: '#f87171' }}>• {e}</p>)}
                        </div>
                      )}
                      <div className="pt-1 grid grid-cols-2 gap-1">
                        {Object.entries(row.mapped).filter(([,v]) => v).map(([k, v]) => (
                          <div key={k} className="text-[9px]">
                            <span style={{ color: 'rgba(148,163,184,0.5)' }}>{k}: </span>
                            <span style={{ color: 'rgba(203,213,225,0.8)' }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {validRows.length > 0 && (
              <button onClick={runImport} disabled={importing} className="w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-[0.97]"
                style={{ background: 'linear-gradient(135deg,#059669,#10b981)', color: 'white', boxShadow: '0 8px 24px rgba(16,185,129,0.4)', opacity: importing ? 0.7 : 1 }}>
                {importing ? <><Loader2 size={16} className="animate-spin" /> Importing…</> : <>Import {validRows.length} Records</>}
              </button>
            )}
            <button onClick={() => setStep('map')} className="w-full py-3 rounded-2xl font-black text-sm active:scale-95"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.6)' }}>← Back</button>
          </>
        )}

        {/* STEP 5 — DONE */}
        {step === 'done' && result && (
          <div className="space-y-4">
            <div className="text-center py-8">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(52,211,153,0.15)', border: '2px solid rgba(52,211,153,0.35)' }}>
                <CheckCircle2 size={36} style={{ color: '#34d399' }} />
              </div>
              <p className="text-2xl font-black text-white">{result.success} Imported!</p>
              {result.skipped > 0 && <p className="text-sm mt-1" style={{ color: 'rgba(248,113,113,0.7)' }}>{result.skipped} skipped due to errors</p>}
            </div>
            {result.rowErrors.length > 0 && (
              <GCard>
                <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: '#f87171' }}>Row Errors</p>
                {result.rowErrors.map((e, i) => <p key={i} className="text-[10px] mb-1" style={{ color: 'rgba(248,113,113,0.7)' }}>{e}</p>)}
              </GCard>
            )}
            <button onClick={reset} className="w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-[0.97]"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: 'white', boxShadow: '0 8px 24px rgba(79,70,229,0.4)' }}>
              <RefreshCw size={16} /> Import More
            </button>
            <button onClick={onBack} className="w-full py-3 rounded-2xl font-black text-sm active:scale-95"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.6)' }}>← Back to Dashboard</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BulkImportView;