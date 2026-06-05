import { getGeminiApiKey, isGeminiConfigured } from './geminiKey';

const getToday = () => new Date().toISOString().split('T')[0];

export const GeminiService = {
  processInput: async (text: string, file: File | null, context?: any): Promise<any[]> => {
    try {
      const apiKey = getGeminiApiKey();
      if (!apiKey || apiKey.includes('YOUR_API')) {
        throw new Error("Gemini API Key is missing. Please configure it in settings.");
      }

      const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
      const MODEL_NAME = "gemini-2.5-flash"; // Updated to current stable model
      const API_URL = `${BASE_URL}${MODEL_NAME}:generateContent?key=${apiKey}`;

      // --- CONTEXT PREPARATION ---
      const customerStr = context?.customers?.slice(0, 50).join(", ") || "";
      const supplierStr = context?.suppliers?.slice(0, 50).join(", ") || "";
      const itemStr = context?.items?.slice(0, 50).join(", ") || "";
      const expenseStr = context?.expenseTypes?.join(", ") || "";

      const contextPrompt = `
        DATABASE CONTEXT (Match these names exactly if similar):
        - Customers: [${customerStr}]
        - Suppliers: [${supplierStr}]
        - Items: [${itemStr}]
        - Expense Categories: [${expenseStr}]
      `;

      const parts: any[] = [];
      
      const systemPrompt = `
        You are an intelligent accounting assistant for a business management app. Convert the user input into a JSON Array of database operations.
        Current Date: ${getToday()}
        
        ${contextPrompt}

        RULES:
        1. Output ONLY valid JSON array. No markdown, no explanation.
        2. "collection" must be one of: 'ledger_entries', 'transactions', 'expenses', 'inventory', 'parties', 'vehicles'.
        3. For sales/purchases, use 'ledger_entries' with type 'sell' or 'purchase'.
        4. For payments, use 'transactions' with type 'received' or 'paid'.
        5. For new customers/suppliers, use 'parties' with role 'customer' or 'supplier'.
        6. For new items, use 'inventory'.
        7. For expenses, use 'expenses' with category.
        8. Use exact names from DATABASE CONTEXT if similar match found.
        9. Extract "items" array for sales/purchases with item_name, quantity, rate, total.
        10. Always include 'date' field in YYYY-MM-DD format.
        
        COLLECTION SCHEMAS:
        - parties: { name, role: 'customer'|'supplier', contact?, address?, gstin?, site?, state? }
        - inventory: { name, unit: 'Pcs'|'Kg'|'L'|'M', purchase_rate?, sale_rate?, stock?, hsn_code?, gst_percent? }
        - ledger_entries: { type: 'sell'|'purchase', party_name, date, items: [], total_amount, invoice_no?, bill_no?, notes?, discount_amount?, vehicle_rent? }
        - transactions: { type: 'received'|'paid', party_name, amount, date, payment_mode: 'Cash'|'UPI'|'Bank Transfer'|'Cheque', payment_purpose?, notes?, bill_no? }
        - expenses: { category, amount, date, description?, paid_by? }
        - vehicles: { number, driver_name?, model?, notes? }

        EXAMPLES:
        Input: "add customer Ram Kumar"
        Output: [{"collection":"parties","name":"Ram Kumar","role":"customer","date":"${getToday()}"}]

        Input: "sold 50 cement to Rahul for 18000"
        Output: [{"collection":"ledger_entries","type":"sell","party_name":"Rahul","date":"${getToday()}","items":[{"item_name":"Cement","quantity":50,"rate":360,"total":18000}],"total_amount":18000}]

        Input: "received 5000 from Suresh by UPI"
        Output: [{"collection":"transactions","type":"received","party_name":"Suresh","amount":5000,"date":"${getToday()}","payment_mode":"UPI"}]

        Input: "add item steel rod 45 per kg"
        Output: [{"collection":"inventory","name":"Steel Rod","unit":"Kg","sale_rate":45,"date":"${getToday()}"}]

        Input: "spent 500 on tea"
        Output: [{"collection":"expenses","category":"Tea/Snacks","amount":500,"date":"${getToday()}"}]
      `;

      parts.push({ text: systemPrompt });
      parts.push({ text: `INPUT: ${text}` });

      // Handle File (Image/Audio)
      if (file) {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const b64 = await base64Promise;
        parts.push({ 
          inline_data: { 
            mime_type: file.type, 
            data: b64 
          } 
        });
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: parts }],
          generationConfig: {
            temperature: 0.1,
            topP: 0.8,
            maxOutputTokens: 2048
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData?.error?.message || `API Error ${response.status}`;
        console.error("Gemini API Error:", errorMsg);
        throw new Error(errorMsg);
      }
      
      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      // Clean and parse JSON
      let cleanJson = rawText.trim();
      
      // Remove markdown code blocks if present
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      
      // Find JSON array
      const jsonStart = cleanJson.indexOf('[');
      const jsonEnd = cleanJson.lastIndexOf(']');
      
      if (jsonStart === -1 || jsonEnd === -1) {
        console.warn("No valid JSON array found in response:", rawText);
        return [];
      }

      cleanJson = cleanJson.substring(jsonStart, jsonEnd + 1);
      
      const parsed = JSON.parse(cleanJson);
      
      // Validate and normalize results
      return Array.isArray(parsed) ? parsed.map(item => ({
        ...item,
        date: item.date || getToday()
      })) : [];

    } catch (error: any) {
      console.error("Gemini Processing Error:", error);
      throw error;
    }
  },

  // Quick validation helper
  isConfigured: () => isGeminiConfigured(),
};






