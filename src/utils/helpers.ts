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

export const calculateAccounting = (ledger: any[], transactions: any[], role: string) => {
    let totalBilled = 0;
    let totalPaid = 0;

    ledger.forEach(l => {
        if((role === 'customer' && l.type === 'sell') || (role === 'supplier' && l.type === 'purchase')) {
            totalBilled += (Number(l.total_amount) || 0);
        }
    });

    transactions.forEach(t => {
        if((role === 'customer' && t.type === 'received') || (role === 'supplier' && t.type === 'paid')) {
            totalPaid += (Number(t.amount) || 0);
        }
    });

    return { totalBilled, totalPaid, balance: totalBilled - totalPaid };
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
