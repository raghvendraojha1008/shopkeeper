/**
 * GEMINI ENHANCED SERVICE  — Full-Fledge
 * ─────────────────────────────────────────────────────────────
 * 1. generateReorderSuggestions() — rule-based, zero API needed
 *    • Calculates real sales velocity from ledger entries (last 30 days)
 *    • Urgency tiers: critical / soon / plan
 *    • Suggests order quantity based on 14-day supply
 *
 * 2. getBusinessInsights() — calls Gemini 1.5 Flash
 *    • Returns 3 actionable insights with type/title/body/action/actionTab
 *    • Falls back to rule-based insights if no API key / network error
 */

import { getGeminiApiKey } from './geminiKey';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReorderSuggestion {
  itemId        : string;
  itemName      : string;
  unit          : string;
  currentStock  : number;
  minStock      : number;
  salesVelocity : number;   // avg units sold per day
  daysRemaining : number;   // at current velocity
  suggestedQty  : number;
  urgency       : 'critical' | 'soon' | 'plan';
  reason        : string;
  estimatedCost?: number;   // suggestedQty × purchaseRate
}

export interface GeminiInsight {
  type     : 'warning' | 'opportunity' | 'tip' | 'alert';
  title    : string;
  body     : string;
  action?  : string;
  actionTab?: string;
}

// ─── Sales velocity calculator ────────────────────────────────────────────────

export function calcSalesVelocity(
  itemName     : string,
  ledgerEntries: any[],
  days         = 30,
): number {
  const cutoff  = Date.now() - days * 86400000;
  let total     = 0;

  for (const l of ledgerEntries) {
    if (l.type !== 'sell') continue;
    const dt = l.date?.toDate ? l.date.toDate() : new Date(l.date || 0);
    if (dt.getTime() < cutoff) continue;
    for (const i of (l.items || [])) {
      if (
        String(i.item_name || '').toLowerCase().trim() ===
        String(itemName    || '').toLowerCase().trim()
      ) {
        total += Number(i.quantity) || 0;
      }
    }
  }

  return Math.max(0, +(total / days).toFixed(3));
}

// ─── Reorder suggestions (rule-based, no API needed) ─────────────────────────

export function generateReorderSuggestions(
  inventory    : any[],
  ledgerEntries: any[],
  leadTimeDays = 3,
): ReorderSuggestion[] {
  const results: ReorderSuggestion[] = [];

  for (const item of inventory) {
    const stock    = Number(item.current_stock || 0);
    const minStock = Number(item.min_stock || 0);
    const velocity = calcSalesVelocity(item.name, ledgerEntries, 30);

    const daysRemaining = velocity > 0 ? Math.floor(stock / velocity) : 999;

    // Skip well-stocked with no urgency
    if (daysRemaining > 30 && stock > minStock * 3) continue;

    // Determine urgency
    let urgency: ReorderSuggestion['urgency'];
    let reason: string;

    if (stock <= 0 || (velocity > 0 && daysRemaining <= leadTimeDays)) {
      urgency = 'critical';
      reason  = stock <= 0
        ? 'Out of stock'
        : `Only ${daysRemaining}d left — less than lead time (${leadTimeDays}d)`;
    } else if (stock <= minStock || (velocity > 0 && daysRemaining <= 7)) {
      urgency = 'soon';
      reason  = stock <= minStock
        ? `Below minimum stock (${minStock})`
        : `~${daysRemaining} days left at current pace`;
    } else {
      urgency = 'plan';
      reason  = `~${daysRemaining} days of stock remaining`;
    }

    // Suggested qty: bring up to 14-day supply or 2× minStock, whichever larger
    const target14d    = velocity > 0 ? Math.ceil(velocity * 14) : minStock * 2;
    const suggestedQty = Math.max(target14d - stock, minStock, 1);

    results.push({
      itemId        : item.id,
      itemName      : item.name,
      unit          : item.unit || 'Pcs',
      currentStock  : stock,
      minStock,
      salesVelocity : velocity,
      daysRemaining : daysRemaining === 999 ? 999 : daysRemaining,
      suggestedQty,
      urgency,
      reason,
      estimatedCost : suggestedQty * (Number(item.purchase_rate) || 0),
    });
  }

  // Sort: critical first, then by daysRemaining ascending
  return results.sort((a, b) => {
    const rank = { critical: 0, soon: 1, plan: 2 };
    if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
    return a.daysRemaining - b.daysRemaining;
  });
}

// ─── Gemini AI business insights ─────────────────────────────────────────────

export async function getBusinessInsights(
  metrics    : { sales: number; purchase: number; expense: number; received: number; paid: number },
  topItems   : string[],
  reorderCount: number,
): Promise<GeminiInsight[]> {
  // Try Gemini first.  Resolution order is user-supplied key (BYOK,
  // localStorage) → bundled key from VITE_GEMINI_API_KEY.  See geminiKey.ts.
  const apiKey = getGeminiApiKey();
  if (apiKey && !apiKey.includes('YOUR_API')) {
    try {
      const prompt = `
You are a business analytics assistant. Analyze this business data and return EXACTLY 3 actionable insights as a JSON array.

BUSINESS DATA (this month):
- Sales: ₹${metrics.sales}
- Purchases: ₹${metrics.purchase}
- Expenses: ₹${metrics.expense}
- Received: ₹${metrics.received}
- Paid: ₹${metrics.paid}
- Net Profit: ₹${metrics.sales - metrics.purchase - metrics.expense}
- Profit Margin: ${metrics.sales > 0 ? ((metrics.sales - metrics.purchase - metrics.expense) / metrics.sales * 100).toFixed(1) : 0}%
- Low/Critical reorder items: ${reorderCount}
- Top selling items: ${topItems.slice(0, 5).join(', ') || 'None'}

Return ONLY a valid JSON array with this exact structure (no markdown, no explanation):
[
  {
    "type": "warning|opportunity|tip|alert",
    "title": "Short title (5 words max)",
    "body": "2-sentence insight with specific numbers",
    "action": "Action button label",
    "actionTab": "tab name (reports|inventory|ledger|transactions|pending-dashboard)"
  }
]`;

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({
            contents           : [{ parts: [{ text: prompt }] }],
            generationConfig   : { temperature: 0.3, maxOutputTokens: 512 },
          }),
        },
      );

      if (resp.ok) {
        const d    = await resp.json();
        const raw  = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const json = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 3);
      }
    } catch { /* fall through to rule-based */ }
  }

  return _ruleBasedInsights(metrics, reorderCount);
}

// ─── Rule-based fallback insights ────────────────────────────────────────────

function _ruleBasedInsights(
  metrics    : { sales: number; purchase: number; expense: number; received: number; paid: number },
  reorderCount: number,
): GeminiInsight[] {
  const insights: GeminiInsight[] = [];
  const profit = metrics.sales - metrics.purchase - metrics.expense;
  const margin = metrics.sales > 0 ? (profit / metrics.sales) * 100 : 0;

  if (reorderCount > 0) {
    insights.push({
      type     : 'alert',
      title    : `${reorderCount} Items Need Reorder`,
      body     : `You have ${reorderCount} item${reorderCount > 1 ? 's' : ''} running low or out of stock. Delay may cause lost sales.`,
      action   : 'View Stock',
      actionTab: 'inventory',
    });
  }

  if (margin < 10 && metrics.sales > 0) {
    insights.push({
      type     : 'warning',
      title    : 'Low Profit Margin',
      body     : `Your margin is ${margin.toFixed(1)}%, below the healthy 15% threshold. Review purchase costs or pricing.`,
      action   : 'View Reports',
      actionTab: 'reports',
    });
  } else if (margin > 25) {
    insights.push({
      type     : 'opportunity',
      title    : 'Strong Margin This Month',
      body     : `Profit margin of ${margin.toFixed(1)}% is above target. Consider expanding top-selling product range.`,
      action   : 'See Trends',
      actionTab: 'reports',
    });
  }

  const outstanding = (metrics.sales - metrics.received);
  if (outstanding > metrics.sales * 0.3 && outstanding > 5000) {
    insights.push({
      type     : 'warning',
      title    : 'High Receivables Pending',
      body     : `₹${outstanding.toLocaleString('en-IN')} is outstanding from sales. Follow up to improve cash flow.`,
      action   : 'View Pending',
      actionTab: 'pending-dashboard',
    });
  }

  if (insights.length < 3) {
    insights.push({
      type     : 'tip',
      title    : 'Track Expenses Daily',
      body     : 'Recording expenses daily helps catch cost overruns early and improves profit visibility.',
      action   : 'Add Expense',
      actionTab: 'expenses',
    });
  }

  return insights.slice(0, 3);
}







