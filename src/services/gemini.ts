import { getGeminiApiKey, isGeminiConfigured } from './geminiKey';

const getToday = () => new Date().toISOString().split('T')[0];

// ─── Robust JSON repair (shared) ─────────────────────────────────────────────
function repairAndParseJSON(raw: string): any[] {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }
  const start = text.indexOf('[');
  const end   = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  text = text.substring(start, end + 1);

  try { return JSON.parse(text); } catch (_) { /* fall through */ }

  const repaired = text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  try { return JSON.parse(repaired); } catch (_) { /* fall through */ }

  // Object-by-object extraction
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
  return objects;
}

export const GeminiService = {
  processInput: async (text: string, file: File | null, context?: any): Promise<any[]> => {
    try {
      const apiKey = getGeminiApiKey();
      if (!apiKey || apiKey.includes('YOUR_API')) {
        throw new Error('Gemini API Key is missing. Please configure it in Settings → AI Key.');
      }

      const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const today = getToday();

      // ── Rich context ─────────────────────────────────────────────────────
      const customers  = (context?.customers  || []).slice(0, 80).join(', ');
      const suppliers  = (context?.suppliers  || []).slice(0, 80).join(', ');
      const itemList   = (context?.itemsRich  || context?.items || []).slice(0, 80);
      const services   = (context?.services   || []).slice(0, 40).join(', ');
      const vehicles   = (context?.vehicles   || []).slice(0, 30).join(', ');
      const expTypes   = (context?.expenseTypes || []).join(', ');
      const siteList   = (context?.sites      || []).slice(0, 20).join(', ');

      const itemsStr = Array.isArray(itemList) && itemList.length > 0
        ? itemList.map((i: any) => {
            if (typeof i === 'string') return i;
            const parts = [i.name];
            if (i.unit)         parts.push(i.unit);
            if (i.sale_rate)    parts.push(`₹${i.sale_rate}/sale`);
            if (i.gst_percent)  parts.push(`GST ${i.gst_percent}%`);
            if (i.price_type)   parts.push(i.price_type);
            return parts.join(' | ');
          }).join('\n  ')
        : '';

      const contextBlock = `DATABASE CONTEXT (Match exact names when similar found):
Customers: ${customers || '(none)'}
Suppliers: ${suppliers || '(none)'}
Items:
  ${itemsStr || '(none)'}
Services: ${services || '(none)'}
Vehicles: ${vehicles || '(none)'}
Expense Categories: ${expTypes || '(none)'}
Sites: ${siteList || '(none)'}`;

      // ── System prompt ────────────────────────────────────────────────────
      const systemPrompt = `You are a POWERFUL accounting assistant for an Indian business ledger app. You convert ANY user input into a precise JSON array of database operations. You handle 1 to 500+ records in a single request.

Today: ${today}

${contextBlock}

═══ CRITICAL RULES ═══
1. Output ONLY a raw JSON array — no markdown, no explanation, start with [ end with ].
2. Extract EVERY single record from the input. Never skip or summarize. If user gives 7 entries, output 7 records.
3. Numbers: Strip Indian commas (2,24,000 → 224000). No commas inside numbers in output.
4. Dates: Always YYYY-MM-DD. Input DD/MM → use current year (${today.slice(0,4)}) unless month already passed. DD/MM/YY → expand year. If no year and month < current month, assume current year; if month > current month, assume previous year.
5. Sort records chronologically by date when saving multiple entries for same party.
6. "Create/update customer X and add entries" → output party record FIRST, then all entries in date order.
7. Payment "received from Abhisek" → party_name is the business party (customer), received_by = "Abhisek" (the person who actually transferred).
8. "₹4000 from Abhisek AND ₹3000 from Ashish" → TWO separate transaction records, same date and party_name.
9. Match party names from DATABASE CONTEXT (fuzzy OK: "Mulchandra" → "Mr Mulchandra Patel"). Use exact name from context if found.
10. Match item names from DATABASE CONTEXT items list. Use stored rates/GST if user doesn't specify.
11. "account" / "from X account" in payment → payment_mode = "Bank Transfer", received_by / paid_by = person name.
12. "cash" → payment_mode = "Cash". "UPI" / "GPay" / "PhonePe" → "UPI". "cheque" / "RTGS" / "NEFT" → "Bank Transfer".

═══ COLLECTION SCHEMAS ═══
parties:       { collection, name, role:"customer"|"supplier", contact?, address?, gstin?, site?, notes? }
inventory:     { collection, name, unit:"Bags"|"Kg"|"Pcs"|"L"|"MT"|"Nos"|"M", purchase_rate?, sale_rate?, stock?, hsn_code?, gst_percent?, price_type:"inclusive"|"exclusive" }
ledger_entries:{ collection, type:"sell"|"purchase", party_name, date, items:[{item_name,quantity,unit,rate,gst_percent?,price_type?,total}], total_amount, invoice_no?, bill_no?, notes?, vehicle?, vehicle_rent?, discount_amount?, site? }
transactions:  { collection, type:"received"|"paid", party_name, amount, date, payment_mode:"Cash"|"UPI"|"Bank Transfer"|"Cheque", received_by?, paid_by?, notes?, bill_no? }
misc_charges:  { collection, category, direction:"charge_to_party"|"charge_from_party", amount, date, party_name, service_name?, quantity?, rate_per_unit?, unit?, notes? }
expenses:      { collection, category, amount, date, description?, paid_by?, notes? }
vehicles:      { collection, number, driver_name?, model?, notes? }

═══ EXAMPLES ═══

Input: "Create customer Mr Mulchandra Patel. Add: 23/04/2026 received ₹5000 cash. 01/05/2026 received ₹5000 cash. 05/05/2026 sold 30 bags UltraTech LPP at ₹325. 07/05/2026 received ₹4000 from Abhisek and ₹3000 from Ashish Dwivedi account."
Output:
[
  {"collection":"parties","name":"Mr Mulchandra Patel","role":"customer","date":"${today}"},
  {"collection":"transactions","type":"received","party_name":"Mr Mulchandra Patel","amount":5000,"date":"2026-04-23","payment_mode":"Cash"},
  {"collection":"transactions","type":"received","party_name":"Mr Mulchandra Patel","amount":5000,"date":"2026-05-01","payment_mode":"Cash"},
  {"collection":"ledger_entries","type":"sell","party_name":"Mr Mulchandra Patel","date":"2026-05-05","items":[{"item_name":"UltraTech LPP","quantity":30,"unit":"Bags","rate":325,"total":9750}],"total_amount":9750},
  {"collection":"transactions","type":"received","party_name":"Mr Mulchandra Patel","amount":4000,"date":"2026-05-07","payment_mode":"Bank Transfer","received_by":"Abhisek"},
  {"collection":"transactions","type":"received","party_name":"Mr Mulchandra Patel","amount":3000,"date":"2026-05-07","payment_mode":"Bank Transfer","received_by":"Ashish Dwivedi"}
]

Input: "sold 50 cement bags to Rahul for ₹18000 received 15000 cash now"
Output:
[
  {"collection":"ledger_entries","type":"sell","party_name":"Rahul","date":"${today}","items":[{"item_name":"Cement","quantity":50,"unit":"Bags","rate":360,"total":18000}],"total_amount":18000},
  {"collection":"transactions","type":"received","party_name":"Rahul","amount":15000,"date":"${today}","payment_mode":"Cash"}
]

Input: "add loading charge ₹500 to Ramesh"
Output:
[{"collection":"misc_charges","category":"Loading","direction":"charge_to_party","amount":500,"date":"${today}","party_name":"Ramesh"}]

Input: "spent ₹200 on diesel"
Output:
[{"collection":"expenses","category":"Fuel","amount":200,"date":"${today}","description":"Diesel"}]`;

      const parts: any[] = [
        { text: systemPrompt },
        { text: `INPUT: ${text}` }
      ];

      // Handle image/audio file
      if (file) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        parts.push({ inline_data: { mime_type: file.type, data: base64 } });
      }

      const response = await fetch(API_URL, {
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

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Gemini API error ${response.status}`);
      }

      const data = await response.json();
      const rawText = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      if (!rawText) return [];

      const parsed = repairAndParseJSON(rawText);
      return Array.isArray(parsed)
        ? parsed.map(item => ({ ...item, date: item.date || today }))
        : [];

    } catch (error: any) {
      console.error('Gemini Processing Error:', error);
      throw error;
    }
  },

  isConfigured: () => isGeminiConfigured(),
};
