import { where, orderBy } from 'firebase/firestore';

export const formatCurrency = (amount: number | string) => {
  const num = Number(amount);
  if (isNaN(num)) return '₹0.00';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(num);
  } catch {
    return `₹${num.toFixed(2)}`;
  }
};

/**
 * Safe Indian-locale number formatter for currency display.
 * Falls back gracefully on Android WebViews that lack full ICU data.
 * Use in JSX instead of raw `.toLocaleString('en-IN')`.
 */
export const formatINR = (n: number): string => {
  try {
    return Math.round(n).toLocaleString('en-IN');
  } catch {
    return Math.round(n).toLocaleString();
  }
};

export const formatDate = (date: any) => {
  if (!date) return '';
  let d: Date;
  if (typeof date?.toDate === 'function') {
    d = date.toDate();
  } else if (typeof date === 'object' && typeof date.seconds === 'number') {
    // Serialized Firestore Timestamp: { seconds, nanoseconds }
    d = new Date(date.seconds * 1000 + Math.floor((date.nanoseconds || 0) / 1e6));
  } else if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, day] = date.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(date);
  }
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }
};

// FIXED: Returns strict local YYYY-MM-DD without timezone shifts
export const getCurrentMonthRange = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); 
  
  // Create dates at noon to avoid DST/midnight shifts
  const start = new Date(year, month, 1, 12, 0, 0);
  const end = new Date(year, month + 1, 0, 12, 0, 0);

  const toLocalISO = (d: Date) => {
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().split('T')[0];
  };

  return { 
      start: toLocalISO(start), 
      end: toLocalISO(end) 
  };
};

export const getDateObj = (date: any) => {
    return date && date.toDate ? date.toDate() : new Date(date || 0);
};

export const calculateAccounting = (
    ledger: any[],
    transactions: any[],
    role: string,
    opts?: {
        openingBalance?: number;
        openingBalanceType?: 'they_owe' | 'we_owe';
        miscCharges?: any[];
    }
) => {
    let totalBilled = 0;
    let totalPaid = 0;
    /** Reverse payments: paid-to-customer OR received-from-supplier */
    let totalReversePayment = 0;

    ledger.forEach(l => {
        if((role === 'customer' && l.type === 'sell') || (role === 'supplier' && l.type === 'purchase')) {
            totalBilled += (Number(l.total_amount) || 0);
        }
        // Returns reduce the billed amount
        if((role === 'customer' && l.type === 'sell_return') || (role === 'supplier' && l.type === 'purchase_return')) {
            totalBilled -= (Number(l.total_amount) || 0);
        }
    });

    transactions.forEach(t => {
        const amt = Number(t.amount) || 0;
        // Normal direction: customer pays us (received) OR we pay supplier (paid)
        if((role === 'customer' && t.type === 'received') || (role === 'supplier' && t.type === 'paid')) {
            totalPaid += amt;
        }
        // Reverse direction: we pay customer (paid) OR supplier pays us back (received)
        if((role === 'customer' && t.type === 'paid') || (role === 'supplier' && t.type === 'received')) {
            totalReversePayment += amt;
        }
    });

    const ob = Number(opts?.openingBalance) || 0;
    const openingEffect = ob > 0
        ? (opts?.openingBalanceType === 'we_owe' ? -ob : ob)
        : 0;

    let miscNet = 0;
    (opts?.miscCharges || []).forEach((c: any) => {
        if (c.direction === 'charge_to_party') miscNet += (Number(c.amount) || 0);
        else miscNet -= (Number(c.amount) || 0);
    });

    // Reverse payment effect on balance:
    // Customer: paying back customer INCREASES their outstanding (+ reversePayment)
    // Supplier: receiving from supplier DECREASES our outstanding (- reversePayment)
    const reverseEffect = role === 'customer' ? totalReversePayment : -totalReversePayment;

    return {
        totalBilled,
        totalPaid,
        totalReversePayment,
        balance: totalBilled - totalPaid + reverseEffect + openingEffect + miscNet,
        openingEffect,
        miscNet,
    };
};

export const getQueryConstraints = (config: any) => {
    const constraints: any[] = [];
    if (config.dateFilter?.start && config.dateFilter?.end) {
        const start = new Date(config.dateFilter.start);
        const end = new Date(config.dateFilter.end);
        end.setHours(23, 59, 59, 999);
        constraints.push(where('date', '>=', start));
        constraints.push(where('date', '<=', end));
    }
    if (config.sortField) {
        constraints.push(orderBy(config.sortField, config.sortDirection || 'desc'));
    }
    return constraints;
};
