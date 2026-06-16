/**
 * GSTIN API Service
 * Connects to RapidAPI to fetch business details.
 */

// FIX: Never hardcode API keys in source. Use environment variable instead.
// Add VITE_RAPIDAPI_KEY=your_key to your .env file.
const RAPIDAPI_KEY = (import.meta as any).env.VITE_RAPIDAPI_KEY || '';
const RAPIDAPI_HOST = 'gst-return-status.p.rapidapi.com';

const GSTIN_STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir',       '02': 'Himachal Pradesh',
  '03': 'Punjab',                 '04': 'Chandigarh',
  '05': 'Uttarakhand',            '06': 'Haryana',
  '07': 'Delhi',                  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',          '10': 'Bihar',
  '11': 'Sikkim',                 '12': 'Arunachal Pradesh',
  '13': 'Nagaland',               '14': 'Manipur',
  '15': 'Mizoram',                '16': 'Tripura',
  '17': 'Meghalaya',              '18': 'Assam',
  '19': 'West Bengal',            '20': 'Jharkhand',
  '21': 'Odisha',                 '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',         '24': 'Gujarat',
  '25': 'Daman & Diu',            '26': 'Dadra & Nagar Haveli',
  '27': 'Maharashtra',            '28': 'Andhra Pradesh',
  '29': 'Karnataka',              '30': 'Goa',
  '31': 'Lakshadweep',            '32': 'Kerala',
  '33': 'Tamil Nadu',             '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh',         '38': 'Ladakh',
  '97': 'Other Territory',        '99': 'Centre Jurisdiction',
};

export const GSTService = {
    fetchDetails: async (gstin: string) => {
        if (!gstin || gstin.length !== 15) {
            throw new Error("Invalid GSTIN format. Must be 15 characters.");
        }

        // FIX (Bug 3): Surface a clear, actionable error before hitting the
        // network when the API key is not configured. Previously the call
        // returned 401/403 → caught as a generic toast that confused users
        // into thinking the form had crashed.
        if (!RAPIDAPI_KEY) {
            throw new Error("GST lookup is not configured. Add your RapidAPI key to enable Fetch.");
        }

        try {
            const response = await fetch(`https://${RAPIDAPI_HOST}/free/gstin/${gstin}`, {
                method: 'GET',
                headers: {
                    'x-rapidapi-key': RAPIDAPI_KEY,
                    'x-rapidapi-host': RAPIDAPI_HOST
                }
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) throw new Error("API Key invalid or expired. Check your RapidAPI key.");
                if (response.status === 404) throw new Error("GSTIN not found. Verify the number and try again.");
                if (response.status === 429) throw new Error("Too many requests. Please wait a moment and try again.");
                throw new Error(`GST server error (${response.status}). Try again shortly.`);
            }

            const json = await response.json();
            const data = json.data || json; 

            const legalName = data.lgnm || data.legal_name || data.legalName || '';
            const tradeName = data.tradeName || data.tradeNam || data.trade_name || '';
            
            // --- ADDRESS FIX START ---
            let address = '';
            
            // 1. Check 'adr' (The format you provided)
            if (data.adr) {
                address = data.adr;
            } 
            // 2. Check 'pradr' object (Other API formats)
            else if (data.pradr && data.pradr.addr) {
                const a = data.pradr.addr;
                address = [a.bno, a.st, a.loc, a.pncd].filter(Boolean).join(', ');
            } 
            // 3. Fallback
            else if (data.address) {
                address = data.address;
            }
            // --- ADDRESS FIX END ---

            // Derive state from multiple fallback sources:
            // 1. Direct field (some API variants)
            // 2. data.stj = "State - Maharashtra,Zone - ..." (this API's format)
            // 3. First 2 digits of GSTIN → state code table (always available)
            const stateFromStj = data.stj
                ? (data.stj.match(/^State\s*-\s*([^,]+)/i)?.[1]?.trim() || '')
                : '';
            const stateFromCode = GSTIN_STATE_CODES[gstin.substring(0, 2)] || '';
            const state = data.state || (data.pradr?.addr?.stcd) || stateFromStj || stateFromCode;

            // Extract city: prefer pradr.addr.dst (district) → loc (locality) → parse from adr
            let city = '';
            if (data.pradr?.addr?.dst) {
                city = data.pradr.addr.dst;
            } else if (data.pradr?.addr?.loc) {
                city = data.pradr.addr.loc;
            } else if (address) {
                // Parse from adr string: typically "door, street, locality, district, state, pin"
                const parts = address.split(',').map((s: string) => s.trim()).filter(Boolean);
                if (parts.length >= 3) {
                    // Walk back from end: skip pincode (all digits) and state, take first valid part
                    for (let i = parts.length - 1; i >= 0; i--) {
                        const p = parts[i];
                        if (/^\d+$/.test(p)) continue; // skip pincode
                        const stateLC = state.toLowerCase();
                        if (stateLC && p.toLowerCase().includes(stateLC.split(' ')[0])) continue; // skip state
                        city = p;
                        break;
                    }
                }
            }

            return {
                legalName: legalName,
                tradeName: tradeName,
                address: address,
                city: city,
                state,
                status: data.sts || data.status || 'Unknown',
                isValid: true,
                gstin: gstin
            };

        } catch (error: any) {
            console.error("GST Fetch Error:", error);
            throw new Error(error.message || "Network error occurred.");
        }
    }
};






