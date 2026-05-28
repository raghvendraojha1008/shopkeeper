/**
 * GST UTILITIES  — Full-Fledge Indian GST Suite
 * ─────────────────────────────────────────────────────────────
 * Exports:
 *   calculateGst()        — per-line CGST/SGST/IGST breakdown
 *   buildInvoiceSummary() — complete multi-item invoice summary
 *   validateGstin()       — format + checksum validation
 *   amountInWords()       — Indian numbering (Lakh/Crore)
 *   generateInvoiceNo()   — INV/24-25/0001
 *   suggestGstRate()      — HSN code → likely GST %
 *   fmtINR()              — ₹1,23,456.00
 *   fmtCompact()          — ₹1.23L / ₹4.5Cr
 *   COMMON_GST_RATES      — [0, 0.1, 0.25, 1, 1.5, 3, 5, 7.5, 12, 18, 28]
 *   GST_STATE_CODES       — { 27: 'Maharashtra', … }
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GstBreakdown {
  baseAmount  : number;
  cgst        : number;
  sgst        : number;
  igst        : number;
  totalGst    : number;
  grandTotal  : number;
  gstRate     : number;
  isInterstate: boolean;
}

export interface GstLineItem {
  itemName   : string;
  quantity   : number;
  rate       : number;
  unit       : string;
  hsnCode?   : string;
  gstPercent : number;
  priceType  : 'inclusive' | 'exclusive';
  discount?  : number;  // percent
}

export type GstEnrichedItem = GstLineItem & GstBreakdown & { lineTotal: number };

export interface GstInvoiceSummary {
  items       : GstEnrichedItem[];
  subtotal    : number;  // sum of baseAmount (taxable)
  totalCgst   : number;
  totalSgst   : number;
  totalIgst   : number;
  totalGst    : number;
  grandTotal  : number;
  isInterstate: boolean;
}

export interface GstinValidation {
  valid      : boolean;
  stateCode? : number;
  state?     : string;
  pan?       : string;
  entityType?: string;
  error?     : string;
}

// ─── Core calculation ─────────────────────────────────────────────────────────

export function calculateGst(
  amount      : number,
  gstRate     : number,
  priceType   : 'inclusive' | 'exclusive',
  isInterstate = false,
): GstBreakdown {
  let base: number, totalGst: number;

  if (priceType === 'inclusive') {
    base     = (amount * 100) / (100 + gstRate);
    totalGst = amount - base;
  } else {
    base     = amount;
    totalGst = (amount * gstRate) / 100;
  }

  const half = totalGst / 2;
  return {
    baseAmount  : r2(base),
    cgst        : isInterstate ? 0 : r2(half),
    sgst        : isInterstate ? 0 : r2(half),
    igst        : isInterstate ? r2(totalGst) : 0,
    totalGst    : r2(totalGst),
    grandTotal  : r2(base + totalGst),
    gstRate,
    isInterstate,
  };
}

// ─── Invoice summary ──────────────────────────────────────────────────────────

export function buildInvoiceSummary(
  items       : GstLineItem[],
  isInterstate = false,
): GstInvoiceSummary {
  let subtotal = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;

  const enriched: GstEnrichedItem[] = items.map(item => {
    const disc      = item.discount || 0;
    const lineTotal = r2(item.quantity * item.rate * (1 - disc / 100));
    const gst       = calculateGst(lineTotal, item.gstPercent, item.priceType, isInterstate);
    subtotal  += gst.baseAmount;
    totalCgst += gst.cgst;
    totalSgst += gst.sgst;
    totalIgst += gst.igst;
    return { ...item, ...gst, lineTotal };
  });

  const totalGst   = r2(totalCgst + totalSgst + totalIgst);
  const grandTotal = r2(subtotal  + totalGst);

  return {
    items       : enriched,
    subtotal    : r2(subtotal),
    totalCgst   : r2(totalCgst),
    totalSgst   : r2(totalSgst),
    totalIgst   : r2(totalIgst),
    totalGst,
    grandTotal,
    isInterstate,
  };
}

// ─── GSTIN Validator ──────────────────────────────────────────────────────────

export function validateGstin(gstin: string): GstinValidation {
  const g = String(gstin || '').toUpperCase().replace(/\s/g, '');
  if (g.length !== 15)
    return { valid: false, error: 'GSTIN must be exactly 15 characters' };

  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g))
    return { valid: false, error: 'GSTIN format invalid (expected: 22AAAAA0000A1Z5)' };

  const code = parseInt(g.substring(0, 2), 10);
  if (!GST_STATE_CODES[code])
    return { valid: false, error: `Unknown state code: ${code}` };

  if (!_checksumOk(g))
    return { valid: false, error: 'GSTIN checksum failed — please double-check' };

  return {
    valid      : true,
    stateCode  : code,
    state      : GST_STATE_CODES[code],
    pan        : g.substring(2, 12),
    entityType : _entityType(g[12]),
  };
}

function _checksumOk(g: string): boolean {
  const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = cs.indexOf(g[i]);
    const w = i % 2 === 0 ? v : v * 2;
    sum += Math.floor(w / 36) + (w % 36);
  }
  return cs[(36 - (sum % 36)) % 36] === g[14];
}

function _entityType(c: string): string {
  return ({
    '1': 'Proprietorship', '2': 'Partnership',  '3': 'HUF',
    '4': 'Company',        '5': 'Trust',         '6': 'LLP',
    '7': 'AOP/BOI',        '9': 'Foreign Entity','A': 'Embassy',
    'B': 'UN Body',        'C': 'Consulate',     'D': 'Central Govt',
    'E': 'Statutory Body', 'F': 'Local Authority','G': 'State Body',
  } as Record<string, string>)[c] || 'Other';
}

// ─── Amount in words (Indian numbering) ───────────────────────────────────────

const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
              'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
              'Seventeen','Eighteen','Nineteen'];
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

function _n2w(n: number): string {
  if (n === 0)   return '';
  if (n < 20)    return ONES[n];
  if (n < 100)   return TENS[Math.floor(n/10)] + (n%10 ? ' ' + ONES[n%10] : '');
  if (n < 1000)  return ONES[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' '+ _n2w(n%100) : '');
  if (n < 1e5)   return _n2w(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' '+_n2w(n%1000) : '');
  if (n < 1e7)   return _n2w(Math.floor(n/1e5))  + ' Lakh'     + (n%1e5  ? ' '+_n2w(n%1e5)  : '');
  return           _n2w(Math.floor(n/1e7))  + ' Crore'    + (n%1e7  ? ' '+_n2w(n%1e7)  : '');
}

export function amountInWords(amount: number): string {
  const abs    = Math.abs(amount);
  const rupees = Math.floor(abs);
  const paise  = Math.round((abs - rupees) * 100);
  let out = `Rupees ${_n2w(rupees) || 'Zero'}`;
  if (paise > 0) out += ` and ${_n2w(paise)} Paise`;
  return out.trim() + ' Only';
}

// ─── Invoice number generator ─────────────────────────────────────────────────

export function generateInvoiceNo(
  prefix        = 'INV',
  lastNumber    = 0,
  financialYear?: string,
): string {
  const fy = financialYear ?? (() => {
    const d = new Date();
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${String(y).slice(-2)}-${String(y+1).slice(-2)}`;
  })();
  return `${prefix}/${fy}/${String(lastNumber + 1).padStart(4, '0')}`;
}

// ─── HSN → GST rate suggestion ────────────────────────────────────────────────

export function suggestGstRate(hsnCode: string): number {
  const c = String(hsnCode || '').trim();
  if (!c) return 18;
  const prefixMap: [string, number][] = [
    ['0401',0],['0402',0],['07',0],['08',0],['10',0],['11',5],
    ['15',5],['17',5],['21',18],['22',28],['24',28],
    ['30',12],['31',0],['39',18],['40',18],['48',12],
    ['61',12],['62',12],['63',12],['64',18],
    ['71',3],['72',18],['73',18],
    ['84',18],['85',18],['87',28],
    ['90',12],['94',18],
  ];
  for (const [pfx, rate] of prefixMap) {
    if (c.startsWith(pfx)) return rate;
  }
  return 18;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function fmtINR(n: number, sym = '₹'): string {
  // Manual Indian number formatting (avoids Unicode narrow-space tokens that break jsPDF)
  const abs = Math.abs(n);
  const [intPart, decPart] = abs.toFixed(2).split('.');
  // Indian grouping: last 3 digits, then groups of 2
  let formatted = '';
  if (intPart.length <= 3) {
    formatted = intPart;
  } else {
    formatted = intPart.slice(-3);
    let rest = intPart.slice(0, -3);
    while (rest.length > 2) {
      formatted = rest.slice(-2) + ',' + formatted;
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) formatted = rest + ',' + formatted;
  }
  return `${sym}${formatted}.${decPart}`;
}

export function fmtCompact(n: number, sym = '₹'): string {
  const abs = Math.abs(n), sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${sym}${(abs/1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}${sym}${(abs/1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}${sym}${(abs/1e3).toFixed(1)}K`;
  return `${sign}${sym}${Math.round(abs).toLocaleString('en-IN')}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const COMMON_GST_RATES: number[] = [0, 0.1, 0.25, 1, 1.5, 3, 5, 7.5, 12, 18, 28];

export const GST_STATE_CODES: Record<number, string> = {
  1:'Jammu & Kashmir', 2:'Himachal Pradesh', 3:'Punjab', 4:'Chandigarh',
  5:'Uttarakhand', 6:'Haryana', 7:'Delhi', 8:'Rajasthan', 9:'Uttar Pradesh',
  10:'Bihar', 11:'Sikkim', 12:'Arunachal Pradesh', 13:'Nagaland',
  14:'Manipur', 15:'Mizoram', 16:'Tripura', 17:'Meghalaya', 18:'Assam',
  19:'West Bengal', 20:'Jharkhand', 21:'Odisha', 22:'Chhattisgarh',
  23:'Madhya Pradesh', 24:'Gujarat', 26:'Dadra & Nagar Haveli & Daman & Diu',
  27:'Maharashtra', 28:'Andhra Pradesh (old)', 29:'Karnataka', 30:'Goa',
  31:'Lakshadweep', 32:'Kerala', 33:'Tamil Nadu', 34:'Puducherry',
  35:'Andaman & Nicobar', 36:'Telangana', 37:'Andhra Pradesh',
  38:'Ladakh', 97:'Other Territory', 99:'Centre Jurisdiction',
};

// ─── Private helpers ──────────────────────────────────────────────────────────
const r2 = (n: number) => Math.round(n * 100) / 100;







