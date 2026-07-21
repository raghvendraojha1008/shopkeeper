import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  X, Sparkles, Upload, FileText, Loader2, AlertCircle,
  CheckSquare, Square, ChevronRight, Check, ShoppingCart,
  Truck, CreditCard, Tag, RefreshCw, ArrowDownLeft, ArrowUpRight,
  Image as ImageIcon, Camera, Wrench,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getDocs, collection } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { ApiService } from '../../services/api';
import { getGeminiApiKey } from '../../services/geminiKey';
import { useUI } from '../../context/UIContext';
import { useData, invalidateAll } from '../../context/DataContext';
import { generatePrefixedID, seedCountersFromFirestore } from '../../utils/idGenerator';

// ─── Types ────────────────────────────────────────────────────────────────────

type RecordType = 'Sale Invoice' | 'Purchase Bill' | 'Payment Received' | 'Payment Paid' | 'Misc Charge' | 'Service Charge';

interface ParsedRecord {
  id: string;
  collection: 'ledger_entries' | 'transactions' | 'misc_charges';
  displayType: RecordType;
  date: string;
  amount: number;
  description: string;
  items?: { item_name: string; quantity: number; unit: string; rate: number; total: number }[];
  data: Record<string, any>;
}

type Step = 'input' | 'parsing' | 'preview' | 'importing' | 'done';

interface UploadedFile {
  file: File;
  name: string;
  isImage: boolean;
  previewUrl?: string;
}

interface Props {
  party: any;
  user: any;
  onClose: () => void;
  onImportComplete: () => void;
}

// ─── Robust JSON repair ───────────────────────────────────────────────────────

function repairAndParseJSON(raw: string): any[] {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }
  const start = text.indexOf('[');
  const end   = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI returned an unreadable response. Try simplifying or shortening the data.');
  }
  text = text.substring(start, end + 1);

  try { return JSON.parse(text); } catch (_) { /* fall through */ }

  const repaired = text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  try { return JSON.parse(repaired); } catch (_) { /* fall through */ }

  const objects: any[] = [];
  let depth = 0, objStart = -1, inStr = false, escape = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escape)          { escape = false; continue; }
    if (ch === '\\' && inStr) { escape = true; continue; }
    if (ch === '"')      { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') { if (depth === 0) objStart = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const fragment = repaired.substring(objStart, i + 1);
        try { objects.push(JSON.parse(fragment)); }
        catch (_) {
          try { objects.push(JSON.parse(fragment.replace(/,\s*([}\]])/g, '$1'))); } catch (_2) { /* skip */ }
        }
        objStart = -1;
      }
    }
  }
  if (objects.length > 0) return objects;
  throw new Error('Could not parse AI response. Please try again.');
}

// ─── Gemini caller ────────────────────────────────────────────────────────────

async function callGemini(
  rawText: string,
  party: any,
  uploadedFile: UploadedFile | null,
  context?: { inventory?: any[]; services?: any[]; vehicles?: string[]; sites?: string[] }
): Promise<ParsedRecord[]> {
  const apiKey = getGeminiApiKey();
  if (!apiKey || apiKey.includes('YOUR_API')) {
    throw new Error('Gemini API key not configured. Please set it in Settings → AI Key.');
  }

  const today      = new Date();
  const currentYear  = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const isCustomer   = party.role === 'customer';

  // Build item context string
  const itemLines = (context?.inventory || []).slice(0, 100).map(i => {
    const parts: string[] = [i.name];
    if (i.unit)          parts.push(i.unit);
    if (i.sale_rate)     parts.push(`sale ₹${i.sale_rate}`);
    if (i.purchase_rate) parts.push(`purchase ₹${i.purchase_rate}`);
    if (i.gst_percent)   parts.push(`GST ${i.gst_percent}%`);
    if (i.price_type)    parts.push(i.price_type);
    if (i.hsn_code)      parts.push(`HSN ${i.hsn_code}`);
    return parts.join(' | ');
  }).join('\n  ');

  const serviceLines = (context?.services || []).slice(0, 40).map(s => {
    const parts: string[] = [s.name];
    if (s.unit)          parts.push(s.unit);
    if (s.rate_per_unit) parts.push(`₹${s.rate_per_unit}/unit`);
    if (s.category)      parts.push(s.category);
    return parts.join(' | ');
  }).join(', ');

  const vehicleLines  = (context?.vehicles || []).join(', ');
  const siteLines     = (context?.sites    || []).join(', ');

  const contextBlock = `
BUSINESS CONTEXT:
Party: "${party.name}" (${party.role})
${isCustomer
  ? 'Customer → invoices = SALES (type:"sell"), payments FROM them = type:"received"'
  : 'Supplier → invoices = PURCHASES (type:"purchase"), payments TO them = type:"paid"'}

INVENTORY ITEMS (use exact name, auto-fill GST/rate/price_type if user matches):
  ${itemLines || '(none)'}

SERVICES (misc_charges with service details):
  ${serviceLines || '(none)'}

VEHICLES: ${vehicleLines || '(none)'}
SITES: ${siteLines || '(none)'}`;

  const isImageMode = uploadedFile?.isImage;

  const prompt = `You are a POWERFUL accounting data extractor for an Indian business. ${isImageMode ? 'Analyze the attached image (handwritten or printed ledger/invoice/bill) and extract ALL records.' : 'Parse the raw ledger data below and extract ALL records.'} Output ONLY a raw JSON array — start with [ end with ], no markdown, no explanation.

═══ CRITICAL JSON RULES ═══
- All numbers must be plain integers/decimals — NO commas (224000 not 2,24,000)
- No trailing commas. No JS comments. No markdown fences.
- Extract EVERY row. Never skip or summarize. 100+ rows → 100+ records.

═══ DATE RULES ═══
- Output format: YYYY-MM-DD
- Base year: ${currentYear}
- DD/MM with month > ${currentMonth} (already passed) → ${currentYear - 1}
- DD/MM with month ≤ ${currentMonth} → ${currentYear}
- DD/MM/YY → expand to full year
- No date on row → use nearest prior date

${contextBlock}

═══ CLASSIFICATION ═══
1. ITEMS/GOODS rows (bags, cement, steel, OPC, LPP, TMT, etc.) → "ledger_entries"
   type: "${isCustomer ? 'sell' : 'purchase'}"
   items array: [{item_name, quantity, unit, rate, gst_percent?, price_type?"inclusive"|"exclusive", total}]
   If item matches INVENTORY ITEMS above → copy its gst_percent, price_type, hsn_code.
   total = quantity × rate (exclusive) or quantity × rate incl. GST if inclusive

2. PAYMENT rows (Cash, Bank, UPI, Cheque, Deposit, Received, Paid, A/c) → "transactions"
   type: "${isCustomer ? '"received"' : '"paid"'}" (unless clearly reversed)
   payment_mode: "Cash" | "UPI" | "Bank Transfer" | "Cheque"
   paid_by / received_by: person name if "from Abhisek" / "by Ravi" style note
   "from X account" or "X a/c" → payment_mode:"Bank Transfer", received_by:"X"
   Two amounts in one row (₹4000 from A and ₹3000 from B) → TWO separate records

3. SERVICE / ADJUSTMENT rows (Loading, Unloading, Transport, Labour, Commission, Discount, any service name from SERVICES list) → "misc_charges"
   category: pick nearest from: Loading|Unloading|Transport|Labour|Commission|Discount|Adjustment|Freight|Handling
   direction: "${isCustomer ? '"charge_to_party"' : '"charge_from_party"'}" (unless clearly reversed)
   If service name matches SERVICES list → add service_name, rate_per_unit, unit, quantity
   
4. Header/TOTAL/BALANCE/separator rows → {"collection":"skip"}

═══ VEHICLE / SITE / GST FIELDS ═══
For ledger_entries: add vehicle? (if mentioned), site? (if mentioned), vehicle_rent? (if mentioned), discount_amount? (if mentioned)
For transactions: add received_by? / paid_by? (person who actually transferred)

═══ OUTPUT FORMAT (start response with [ immediately) ═══
[
  {"collection":"ledger_entries","date":"YYYY-MM-DD","type":"sell","items":[{"item_name":"UltraTech OPC","quantity":100,"unit":"Bags","rate":320,"gst_percent":28,"price_type":"exclusive","total":32000}],"total_amount":32000,"invoice_no":"","notes":"","vehicle":"","site":""},
  {"collection":"transactions","date":"YYYY-MM-DD","type":"received","amount":50000,"payment_mode":"Bank Transfer","received_by":"Ravi","notes":"SBI NEFT"},
  {"collection":"misc_charges","date":"YYYY-MM-DD","amount":500,"category":"Loading","direction":"charge_to_party","service_name":"","quantity":1,"rate_per_unit":500,"unit":"Job","notes":""},
  {"collection":"skip"}
]

${isImageMode ? 'IMAGE DATA: See attached image.' : `LEDGER DATA:\n${rawText}`}`;

  const parts: any[] = [{ text: prompt }];

  if (uploadedFile) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(uploadedFile.file);
    });
    parts.push({ inline_data: { mime_type: uploadedFile.file.type, data: base64 } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.05,
        topP: 0.9,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error ${resp.status}`);
  }

  const json = await resp.json();
  const raw  = (json.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  if (!raw) throw new Error('AI returned an empty response. Please try again.');

  let items: any[];
  try { items = repairAndParseJSON(raw); }
  catch (e: any) {
    throw new Error(`AI response could not be parsed: ${e?.message || 'unknown error'}. Please try again.`);
  }

  const records: ParsedRecord[] = [];
  let seq = 0;

  for (const item of items) {
    if (!item || item.collection === 'skip' || !item.collection) continue;
    const id   = `r_${seq++}`;
    const date = item.date || today.toISOString().split('T')[0];

    if (item.collection === 'ledger_entries') {
      const its = Array.isArray(item.items) ? item.items : [];
      const total = Number(item.total_amount) || its.reduce((s: number, i: any) => s + (Number(i.total) || 0), 0);
      if (total <= 0 && its.length === 0) continue;
      const desc = its.length
        ? its.map((i: any) => `${i.quantity} ${i.unit || ''} ${i.item_name}`.trim()).join(', ')
        : 'Invoice';
      records.push({
        id, collection: 'ledger_entries',
        displayType: item.type === 'sell' ? 'Sale Invoice' : 'Purchase Bill',
        date, amount: total, description: desc, items: its,
        data: {
          type: item.type || (isCustomer ? 'sell' : 'purchase'),
          party_name: party.name, party_id: party.id || '',
          date, items: its, total_amount: total,
          notes: item.notes || '', invoice_no: item.invoice_no || '',
          bill_no: item.bill_no || '',
          vehicle: item.vehicle || '', site: item.site || '',
          vehicle_rent: Number(item.vehicle_rent) || 0,
          discount_amount: Number(item.discount_amount) || 0,
        },
      });
    } else if (item.collection === 'transactions') {
      const amt = Number(item.amount) || 0;
      if (amt <= 0) continue;
      records.push({
        id, collection: 'transactions',
        displayType: item.type === 'received' ? 'Payment Received' : 'Payment Paid',
        date, amount: amt,
        description: [item.received_by || item.paid_by, item.payment_mode, item.notes].filter(Boolean).join(' · ') || 'Payment',
        data: {
          type: item.type || (isCustomer ? 'received' : 'paid'),
          party_name: party.name, party_id: party.id || '',
          amount: amt, date,
          payment_mode: item.payment_mode || 'Cash',
          received_by: item.received_by || '',
          paid_by: item.paid_by || '',
          payment_purpose: item.payment_purpose || '',
          notes: item.notes || '',
        },
      });
    } else if (item.collection === 'misc_charges') {
      const amt = Number(item.amount) || 0;
      if (amt <= 0) continue;
      const isService = !!item.service_name;
      records.push({
        id, collection: 'misc_charges',
        displayType: isService ? 'Service Charge' : 'Misc Charge',
        date, amount: amt,
        description: item.service_name || item.category || 'Adjustment',
        data: {
          party_id: party.id || '', party_name: party.name,
          date, amount: amt,
          category: item.category || 'Adjustment',
          direction: item.direction || (isCustomer ? 'charge_to_party' : 'charge_from_party'),
          service_name: item.service_name || '',
          quantity: Number(item.quantity) || '',
          rate_per_unit: Number(item.rate_per_unit) || '',
          unit: item.unit || '',
          notes: item.notes || '',
        },
      });
    }
  }
  return records;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<RecordType, { icon: React.ReactNode; color: string; bg: string; border: string }> = {
  'Sale Invoice':    { icon: <ShoppingCart size={14}/>, color: "var(--col-success)", bg: 'var(--col-success-15)',   border: 'var(--col-success-25)'   },
  'Purchase Bill':   { icon: <Truck size={14}/>,        color: "var(--col-warning)", bg: 'rgba(251,191,36,0.1)',   border: 'rgba(251,191,36,0.2)'   },
  'Payment Received':{ icon: <ArrowDownLeft size={14}/>,color: "var(--col-info)", bg: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.2)'   },
  'Payment Paid':    { icon: <ArrowUpRight size={14}/>, color: "var(--col-danger)", bg: 'rgba(248,113,113,0.1)',  border: 'rgba(248,113,113,0.2)'  },
  'Misc Charge':     { icon: <Tag size={14}/>,          color: "var(--col-slate)", bg: 'var(--text-muted)',  border: 'var(--text-muted)'  },
  'Service Charge':  { icon: <Wrench size={14}/>,       color: "var(--col-violet)", bg: 'rgba(167,139,250,0.1)',  border: 'rgba(167,139,250,0.2)'  },
};

function fmtAmt(n: number) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

const IMAGE_EXTS  = ['jpg','jpeg','png','webp','gif','heic','heif','bmp','tiff'];
const isImageFile = (f: File) => IMAGE_EXTS.includes(f.name.split('.').pop()?.toLowerCase() || '') || f.type.startsWith('image/');

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv' || ext === 'txt') {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_csv(ws));
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    }
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

const AILedgerImportModal: React.FC<Props> = ({ party, user, onClose, onImportComplete }) => {
  const { showToast } = useUI();
  const { useInventory, useServices } = useData();
  const { data: inventoryRaw } = useInventory(user.uid);
  const { data: servicesRaw  } = useServices(user.uid);
  const inventory = useMemo(() => (inventoryRaw || []) as any[], [inventoryRaw]);
  const services  = useMemo(() => (servicesRaw  || []) as any[], [servicesRaw]);

  const fileRef  = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const [step, setStep]       = useState<Step>('input');
  const [rawText, setRawText] = useState('');
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null);
  const [records, setRecords]   = useState<ParsedRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState('');
  const [importStats, setImportStats] = useState({ success: 0, failed: 0 });
  const [importProgress, setImportProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  // ── File handling ──────────────────────────────────────────────────────────
  const loadFile = useCallback(async (file: File) => {
    if (isImageFile(file)) {
      const previewUrl = URL.createObjectURL(file);
      setUploaded({ file, name: file.name, isImage: true, previewUrl });
      setRawText('');
      showToast(`Image loaded: "${file.name}"`, 'success');
    } else {
      try {
        const text = await readFileAsText(file);
        setRawText(text);
        setUploaded({ file, name: file.name, isImage: false });
        showToast(`Loaded "${file.name}"`, 'success');
      } catch {
        showToast('Could not read file', 'error');
      }
    }
  }, [showToast]);

  const clearUploaded = useCallback(() => {
    if (uploaded?.previewUrl) URL.revokeObjectURL(uploaded.previewUrl);
    setUploaded(null);
    setRawText('');
  }, [uploaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, [loadFile]);

  // ── Parse ──────────────────────────────────────────────────────────────────
  const handleParse = async () => {
    const hasText  = rawText.trim().length > 10;
    const hasImage = uploaded?.isImage;
    if (!hasText && !hasImage) {
      showToast('Paste ledger data or upload an image/file first', 'error');
      return;
    }
    setParseError('');
    setStep('parsing');
    try {
      const ctx = { inventory, services };
      const parsed = await callGemini(rawText, party, uploaded || null, ctx);
      if (parsed.length === 0) {
        setParseError('No records could be extracted. Make sure the data contains dates, items, or payment rows.');
        setStep('input');
        return;
      }
      setRecords(parsed);
      setSelected(new Set(parsed.map(r => r.id)));
      setStep('preview');
    } catch (err: any) {
      setParseError(err?.message || 'AI parsing failed. Try again.');
      setStep('input');
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    const toImport = records.filter(r => selected.has(r.id));
    if (toImport.length === 0) { showToast('Select at least one record', 'error'); return; }
    setStep('importing');
    setImportProgress(0);

    // Pre-seed ID counters from existing Firestore records
    try {
      const [ledgerSnap, txnSnap] = await Promise.all([
        getDocs(collection(db, 'users', user.uid, 'ledger_entries')),
        getDocs(collection(db, 'users', user.uid, 'transactions')),
      ]);
      seedCountersFromFirestore(ledgerSnap.docs.filter(d => d.data().type === 'sell').map(d => d.data().invoice_no), 'sales');
      seedCountersFromFirestore(ledgerSnap.docs.filter(d => d.data().type === 'purchase').map(d => d.data().bill_no), 'purchases');
      seedCountersFromFirestore(txnSnap.docs.filter(d => d.data().type === 'received').map(d => d.data().transaction_id), 'receipts');
      seedCountersFromFirestore(txnSnap.docs.filter(d => d.data().type === 'paid').map(d => d.data().transaction_id), 'payments');
    } catch { /* non-fatal */ }

    let success = 0; let failed = 0;
    for (let i = 0; i < toImport.length; i++) {
      const rec = toImport[i];
      try {
        const data: Record<string, any> = { ...rec.data };
        if (rec.collection === 'ledger_entries') {
          if (data.type === 'sell' && !data.invoice_no)    data.invoice_no = generatePrefixedID('sales');
          else if (data.type === 'purchase' && !data.bill_no) data.bill_no = generatePrefixedID('purchases');
        } else if (rec.collection === 'transactions') {
          if (!data.transaction_id) {
            data.transaction_id = generatePrefixedID(data.type === 'paid' ? 'payments' : 'receipts');
          }
        }
        await ApiService.add(user.uid, rec.collection, data);
        success++;
      } catch { failed++; }
      setImportProgress(Math.round(((i + 1) / toImport.length) * 100));
    }
    invalidateAll(user.uid);
    setImportStats({ success, failed });
    setStep('done');
    onImportComplete();
  };

  // ── Toggle helpers ─────────────────────────────────────────────────────────
  const toggleOne = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleAll = () => setSelected(selected.size === records.length ? new Set() : new Set(records.map(r => r.id)));

  const counts = records.reduce((acc, r) => {
    acc[r.displayType] = (acc[r.displayType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end md:items-center justify-center"
      style={{ background: 'var(--rgba-black-85)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget && step !== 'importing') onClose(); }}
    >
      <div
        className="w-full md:max-w-lg md:mx-4 flex flex-col rounded-t-[28px] md:rounded-[24px] overflow-hidden"
        style={{ background: 'var(--app-bg)', border: '1px solid var(--col-violet-25)', maxHeight: '92dvh' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[12px] flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,var(--col-violet-25),var(--col-accent-15))', border: '1px solid var(--col-violet-35)' }}>
              <Sparkles size={16} style={{ color: "var(--col-violet)" }} />
            </div>
            <div>
              <p className="text-sm font-black text-[var(--text-primary)]">AI Ledger Import</p>
              <p className="text-app-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
                {party.name} · {party.role}
              </p>
            </div>
          </div>
          {step !== 'importing' && (
            <button onClick={onClose} className="p-2 rounded-full active:scale-90 transition-all"
              style={{ background: 'var(--rgba-white-07)' }}>
              <X size={16} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* STEP: INPUT */}
          {(step === 'input' || step === 'parsing') && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Upload an <strong className="text-[rgba(167,139,250,0.8)]">image</strong> (photo of ledger, invoice, bill) or a <strong className="text-[rgba(167,139,250,0.8)]">CSV / Excel</strong> file, or paste text below. AI extracts invoices, payments, services &amp; adjustments automatically.
              </p>

              {/* Upload buttons row */}
              <div className="flex gap-2">
                {/* Image upload */}
                <button
                  onClick={() => imageRef.current?.click()}
                  className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-[12px] active:scale-[0.98] transition-all"
                  style={{
                    border: '1.5px dashed rgba(167,139,250,0.4)',
                    background: uploaded?.isImage ? 'rgba(167,139,250,0.1)' : 'rgba(167,139,250,0.04)',
                  }}
                >
                  <Camera size={15} style={{ color: "var(--col-violet)", flexShrink: 0 }} />
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Photo / Image</span>
                </button>

                {/* File upload */}
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-[12px] active:scale-[0.98] transition-all"
                  style={{
                    border: '1.5px dashed var(--col-violet-25)',
                    background: (uploaded && !uploaded.isImage) ? 'var(--col-violet-08)' : 'var(--col-violet-40)',
                  }}
                >
                  <Upload size={15} style={{ color: "var(--col-indigo)", flexShrink: 0 }} />
                  <span className="text-xs font-semibold text-[var(--text-muted)]">CSV / Excel</span>
                </button>
              </div>

              {/* Drag-drop zone (full width) */}
              {!uploaded && (
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-[10px] text-app-sm font-semibold"
                  style={{
                    border: `1px dashed ${dragOver ? 'var(--col-violet-50)' :   'var(--rgba-white-10)'}`,
                    background: dragOver ? 'var(--col-violet-08)' : 'transparent',
                    color: 'var(--text-muted)',
                  }}
                >
                  <Upload size={11} />
                  Drag &amp; drop any file here
                </div>
              )}

              {/* Hidden inputs */}
              <input ref={imageRef} type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />
              <input ref={fileRef}  type="file"
                accept=".csv,.xlsx,.xls,.txt"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; }} />

              {/* Uploaded file / image preview */}
              {uploaded && (
                <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid rgba(167,139,250,0.3)', background: 'rgba(167,139,250,0.06)' }}>
                  {uploaded.isImage && uploaded.previewUrl ? (
                    <div className="relative">
                      <img src={uploaded.previewUrl} alt="uploaded" className="w-full max-h-48 object-contain bg-black/30" />
                      <div className="absolute inset-0 flex items-end">
                        <div className="w-full px-3 py-2 flex items-center justify-between" style={{ background: 'linear-gradient(to top, var(--rgba-black-70), transparent)' }}>
                          <div className="flex items-center gap-2">
                            <ImageIcon size={12} style={{ color: "var(--col-violet)" }} />
                            <span className="text-app-sm font-bold text-white/80 truncate max-w-[180px]">{uploaded.name}</span>
                          </div>
                          <button onClick={clearUploaded} className="p-1 rounded-md" style={{ background: 'var(--rgba-black-50)' }}>
                            <X size={12} style={{ color:   'var(--rgba-white-70)' }} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <FileText size={14} style={{ color: "var(--col-violet)" }} />
                      <span className="text-xs font-bold text-[var(--text-primary)] truncate flex-1">{uploaded.name}</span>
                      <button onClick={clearUploaded} className="p-1 rounded-md" style={{ background: 'var(--rgba-white-07)' }}>
                        <X size={12} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Text divider */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px" style={{ background: 'var(--rgba-white-06)' }} />
                <span className="text-app-sm font-bold text-[var(--text-muted)] uppercase tracking-widest">
                  {uploaded?.isImage ? 'or add extra notes below' : 'or paste text below'}
                </span>
                <div className="flex-1 h-px" style={{ background: 'var(--rgba-white-06)' }} />
              </div>

              <textarea
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder={`Paste your ledger data here...\n\nExamples:\n22/03  153 BAGS ACC NFR  290  44370\n25/03  25 BAGS KJS NFR  240  4800\n02/04  SBI SAVING  Bank Deposit  50000\n05/04  Cash Received  3000\n10/04  Loading charges  500`}
                className="w-full h-44 px-3 py-3 rounded-[12px] text-xs font-mono resize-none focus:outline-none"
                style={{
                  background: 'var(--rgba-white-04)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--text-primary)',
                  lineHeight: 1.6,
                }}
              />

              {/* Context hint chips */}
              <div className="flex flex-wrap gap-1.5">
                {inventory.length > 0 && (
                  <span className="text-app-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--col-success-15)', color: "var(--col-success)", border: '1px solid var(--col-success-25)' }}>
                    📦 {inventory.length} items in context
                  </span>
                )}
                {services.length > 0 && (
                  <span className="text-app-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(167,139,250,0.1)', color: "var(--col-violet)", border: '1px solid rgba(167,139,250,0.2)' }}>
                    🔧 {services.length} services in context
                  </span>
                )}
                <span className="text-app-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(96,165,250,0.1)', color: "var(--col-info)", border: '1px solid rgba(96,165,250,0.2)' }}>
                  📸 Image upload supported
                </span>
              </div>

              {parseError && (
                <div className="flex gap-2 px-3 py-2.5 rounded-[10px]"
                  style={{ background: 'var(--col-danger-08)', border: '1px solid var(--col-danger-25)' }}>
                  <AlertCircle size={13} style={{ color: "var(--col-danger)", flexShrink: 0, marginTop: 1 }} />
                  <p className="text-xs text-col-danger leading-relaxed">{parseError}</p>
                </div>
              )}
            </div>
          )}

          {/* STEP: PARSING */}
          {step === 'parsing' && (
            <div className="flex flex-col items-center justify-center py-16 px-6 gap-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: 'var(--col-violet-12)', border: '1px solid var(--col-violet-35)' }}>
                <Sparkles size={22} className="animate-pulse" style={{ color: "var(--col-violet)" }} />
              </div>
              <div className="text-center">
                <p className="text-sm font-black text-[var(--text-primary)]">Analysing your ledger…</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {uploaded?.isImage ? 'AI is reading the image and extracting records…' : 'AI is extracting invoices, payments & adjustments…'}
                </p>
              </div>
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--col-violet-60)' }} />
            </div>
          )}

          {/* STEP: PREVIEW */}
          {step === 'preview' && (
            <div className="flex flex-col">
              {/* Summary chips */}
              <div className="px-4 py-3 flex flex-wrap gap-2 flex-shrink-0"
                style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {Object.entries(counts).map(([type, count]) => {
                  const m = TYPE_META[type as RecordType];
                  if (!m) return null;
                  return (
                    <span key={type} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-app-sm font-bold"
                      style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
                      {m.icon} {count} {type.replace('Sale Invoice','Sale').replace('Purchase Bill','Purchase').replace('Payment Received','Rcvd').replace('Payment Paid','Paid').replace('Misc Charge','Misc').replace('Service Charge','Service')}
                    </span>
                  );
                })}
                <span className="ml-auto text-app-sm font-bold" style={{ color: 'var(--text-muted)' }}>
                  {selected.size}/{records.length} selected
                </span>
              </div>

              {/* Select all bar */}
              <button
                onClick={toggleAll}
                className="flex items-center gap-2 px-4 py-2.5 w-full text-left active:bg-white/5 transition-colors flex-shrink-0"
                style={{ borderBottom: '1px solid var(--glass-border)' }}
              >
                {selected.size === records.length
                  ? <CheckSquare size={14} style={{ color: "var(--col-violet)" }} />
                  : <Square size={14} style={{ color: 'var(--text-muted)' }} />}
                <span className="text-xs font-bold" style={{ color: selected.size === records.length ? "var(--col-violet)" : 'var(--text-muted)' }}>
                  {selected.size === records.length ? 'Deselect All' : 'Select All'}
                </span>
              </button>

              {/* Record list */}
              <div className="overflow-y-auto" style={{ maxHeight: '50dvh' }}>
                {records.map((rec, idx) => {
                  const m  = TYPE_META[rec.displayType] || TYPE_META['Misc Charge'];
                  const on = selected.has(rec.id);
                  return (
                    <button
                      key={rec.id}
                      onClick={() => toggleOne(rec.id)}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors active:bg-white/5"
                      style={{ borderBottom: idx < records.length - 1 ? '1px solid var(--glass-border)' : 'none' }}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {on ? <CheckSquare size={15} style={{ color: "var(--col-violet)" }} /> : <Square size={15} style={{ color: 'var(--text-muted)' }} />}
                      </div>
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
                        style={{ background: m.bg, border: `1px solid ${m.border}` }}>
                        <span style={{ color: m.color }}>{m.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-app-sm font-black uppercase tracking-wide" style={{ color: m.color }}>
                            {rec.displayType}
                          </span>
                          <span className="text-xs font-black flex-shrink-0" style={{
                            color: rec.displayType === 'Sale Invoice' || rec.displayType === 'Payment Received'
                              ? "var(--col-success)"
                              : rec.displayType === 'Purchase Bill' || rec.displayType === 'Payment Paid'
                              ? "var(--col-danger)"
                              : 'var(--text-muted)'
                          }}>
                            {fmtAmt(rec.amount)}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">{rec.description}</p>
                        <p className="text-app-sm font-semibold mt-0.5" style={{ color: 'var(--text-muted)' }}>{rec.date}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP: IMPORTING */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-16 px-6 gap-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: 'var(--col-success-15)', border: '1px solid var(--col-success-35)' }}>
                <Loader2 size={22} className="animate-spin" style={{ color: "var(--col-success)" }} />
              </div>
              <div className="text-center w-full">
                <p className="text-sm font-black text-[var(--text-primary)]">Saving records…</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Importing {selected.size} records into {party.name}</p>
                <div className="mt-4 w-full rounded-full overflow-hidden" style={{ height: 6, background: 'var(--rgba-white-08)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${importProgress}%`, background: 'linear-gradient(90deg,#059669,#10b981)' }}
                  />
                </div>
                <p className="text-app-sm font-bold mt-1" style={{ color: 'var(--col-success-70)' }}>{importProgress}%</p>
              </div>
            </div>
          )}

          {/* STEP: DONE */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-16 px-6 gap-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'var(--col-success-12)', border: '2px solid var(--col-success-35)' }}>
                <Check size={28} style={{ color: "var(--col-success)" }} />
              </div>
              <div className="text-center">
                <p className="text-lg font-black text-[var(--text-primary)]">Import Complete!</p>
                <p className="text-sm font-semibold mt-1" style={{ color: "var(--col-success)" }}>
                  {importStats.success} record{importStats.success !== 1 ? 's' : ''} added to {party.name}
                </p>
                {importStats.failed > 0 && (
                  <p className="text-xs mt-1" style={{ color: "var(--col-danger)" }}>{importStats.failed} failed to save</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="mt-2 px-8 py-3 rounded-[14px] text-sm font-black text-white active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)' }}>
                View Records
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-4 pb-5 pt-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
          {step === 'input' && (
            <button
              onClick={handleParse}
              disabled={!rawText.trim() && !uploaded?.isImage}
              className="w-full py-3.5 rounded-[14px] text-sm font-black text-white flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-40"
              style={{ background: (rawText.trim() || uploaded?.isImage) ? 'linear-gradient(135deg,#7c3aed,#6366f1)' : 'var(--col-violet-35)' }}
            >
              <Sparkles size={16} />
              {uploaded?.isImage ? 'Analyse Image with AI' : 'Parse with AI'}
            </button>
          )}

          {step === 'preview' && (
            <div className="flex gap-3">
              <button
                onClick={() => { setStep('input'); setParseError(''); }}
                className="flex-1 py-3 rounded-[14px] text-sm font-bold active:scale-95 transition-all"
                style={{ background: 'var(--rgba-white-07)', color: 'var(--text-muted)' }}
              >
                <RefreshCw size={14} className="inline mr-1.5" />
                Re-parse
              </button>
              <button
                onClick={handleImport}
                disabled={selected.size === 0}
                className="flex-[2] py-3 rounded-[14px] text-sm font-black text-white flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-40"
                style={{ background: selected.size > 0 ? 'linear-gradient(135deg,#059669,#10b981)' : 'var(--col-success-35)' }}
              >
                <Check size={15} />
                Import {selected.size} Record{selected.size !== 1 ? 's' : ''}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AILedgerImportModal;
