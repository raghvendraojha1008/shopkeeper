import { parseDateSafe, toDateStrSafe } from './dateUtils';

export interface AutoPaymentInfo {
  txId: string;
  date: string;
  amount: number;
}

export interface OrderPaymentStatus {
  orderId: string;
  orderTotal: number;
  directPaid: number;
  autoPaid: number;
  totalPaid: number;
  balance: number;
  status: 'paid' | 'partial' | 'pending';
  autoPayments: AutoPaymentInfo[];
}

function parseDate(raw: any): Date {
  return parseDateSafe(raw);
}

function toDateStr(raw: any): string {
  return toDateStrSafe(raw);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * openingBalance / openingBalanceType:
 *   "we_owe"   → we have a pre-existing credit to this party (like an advance).
 *                Inject a virtual payment that gets distributed FIFO against
 *                the earliest bills so those bills show as (partially) settled.
 *   "they_owe" → party has a pre-existing debt.  This is unlinked to any specific
 *                bill, so the FIFO order is unchanged; the final balance formula
 *                (in calculateAccounting) already accounts for it.
 */
export function computePaymentDistribution(
  orders: any[],
  transactions: any[],
  autoDistribute: boolean = true,
  openingBalance: number = 0,
  openingBalanceType: 'they_owe' | 'we_owe' = 'they_owe',
): Map<string, OrderPaymentStatus> {
  const result = new Map<string, OrderPaymentStatus>();

  for (const order of orders) {
    if (!order.id) continue;
    result.set(order.id, {
      orderId: order.id,
      orderTotal: Number(order.total_amount) || 0,
      directPaid: 0,
      autoPaid: 0,
      totalPaid: 0,
      balance: 0,
      status: 'pending',
      autoPayments: [],
    });
  }

  // Step 1: Apply directly linked transactions (by bill_no match on the order)
  const usedTransactionIds = new Set<string>();

  for (const tx of transactions) {
    if (!tx.bill_no || !tx.id) continue;
    const billNo = String(tx.bill_no).trim();

    const linkedOrder = orders.find(o => {
      const refNo = String(o.invoice_no || o.bill_no || '').trim();
      if (!refNo || refNo !== billNo) return false;
      if (tx.type === 'received' && o.type !== 'sell') return false;
      if (tx.type === 'paid' && o.type !== 'purchase') return false;
      return true;
    });

    if (!linkedOrder || !result.has(linkedOrder.id)) continue;
    result.get(linkedOrder.id)!.directPaid = round2(result.get(linkedOrder.id)!.directPaid + (Number(tx.amount) || 0));
    usedTransactionIds.add(tx.id);
  }

  // Step 2: Auto-distribute unlinked payments FIFO by party+type
  if (autoDistribute) {
    // Inject virtual "advance" payment for we_owe opening balance.
    // A we_owe balance means the party has a pre-existing credit with us —
    // it behaves exactly like an advance payment against their earliest bills.
    let effectiveTransactions = [...transactions];
    if (openingBalance > 0 && openingBalanceType === 'we_owe' && orders.length > 0) {
      const firstParty = orders[0]?.party_name || '';
      const firstType  = orders[0]?.type === 'sell' ? 'received' : 'paid';
      effectiveTransactions = [
        {
          id: '__opening_balance_virtual__',
          party_name: firstParty,
          type: firstType,
          amount: openingBalance,
          date: '1970-01-01', // earliest possible — always applied first in FIFO
          _isVirtual: true,
        },
        ...effectiveTransactions,
      ];
    }

    // Group orders by (party_name :: order_type), sorted FIFO
    const groupedOrders = new Map<string, any[]>();
    for (const order of orders) {
      const key = `${order.party_name || ''}::${order.type || ''}`;
      if (!groupedOrders.has(key)) groupedOrders.set(key, []);
      groupedOrders.get(key)!.push(order);
    }
    for (const [, arr] of groupedOrders) {
      arr.sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
    }

    // Group unlinked transactions by (party_name :: matching_order_type), sorted by date
    const groupedTxs = new Map<string, any[]>();
    for (const tx of effectiveTransactions) {
      if (usedTransactionIds.has(tx.id)) continue;
      const orderType = tx.type === 'received' ? 'sell' : 'purchase';
      const key = `${tx.party_name || ''}::${orderType}`;
      if (!groupedTxs.has(key)) groupedTxs.set(key, []);
      groupedTxs.get(key)!.push(tx);
    }
    for (const [, arr] of groupedTxs) {
      arr.sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
    }

    for (const [key, pOrders] of groupedOrders) {
      const txs = groupedTxs.get(key);
      if (!txs || txs.length === 0) continue;

      // Track remaining per-transaction
      const txRemaining = txs.map(tx => ({
        tx,
        remaining: Number(tx.amount) || 0,
      }));

      for (const order of pOrders) {
        const status = result.get(order.id)!;
        let orderPending = status.orderTotal - status.directPaid - status.autoPaid;
        if (orderPending <= 0) continue;

        for (const txInfo of txRemaining) {
          if (txInfo.remaining <= 0) continue;
          if (orderPending <= 0) break;

          const applied = round2(Math.min(txInfo.remaining, orderPending));
          txInfo.remaining = round2(txInfo.remaining - applied);
          orderPending = round2(orderPending - applied);
          status.autoPaid = round2(status.autoPaid + applied);
          status.autoPayments.push({
            txId: txInfo.tx.id || '',
            date: toDateStr(txInfo.tx.date),
            amount: applied,
          });
        }
      }
    }
  }

  // Step 3: Compute final status
  for (const [, status] of result) {
    status.totalPaid = round2(status.directPaid + status.autoPaid);
    status.balance = round2(status.orderTotal - status.totalPaid);
    if (status.totalPaid >= status.orderTotal) {
      status.status = 'paid';
    } else if (status.totalPaid > 0) {
      status.status = 'partial';
    } else {
      status.status = 'pending';
    }
  }

  return result;
}
