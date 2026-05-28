/**
 * GSTIN API Service
 * Connects to RapidAPI to fetch business details.
 */

// FIX: Never hardcode API keys in source. Use environment variable instead.
// Add VITE_RAPIDAPI_KEY=your_key to your .env file.
const RAPIDAPI_KEY = (import.meta as any).env.VITE_RAPIDAPI_KEY || '';
const RAPIDAPI_HOST = 'gst-return-status.p.rapidapi.com';

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

            return {
                legalName: legalName,
                tradeName: tradeName, 
                address: address,
                state: data.state || (data.pradr?.addr?.stcd) || '', 
                status: data.sts || data.status || 'Unknown',
                isValid: true,
                gstin: gstin // Return the input GSTIN as confirmed
            };

        } catch (error: any) {
            console.error("GST Fetch Error:", error);
            throw new Error(error.message || "Network error occurred.");
        }
    }
};






