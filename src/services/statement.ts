import { nativePdfService } from './nativePdfService';
import { where, getDocs, query, collection } from 'firebase/firestore';
import { db } from '../config/firebase';

export const StatementService = {
  generatePartyStatement: async (uid: string, party: any, startDate: string, endDate: string, _firmProfile: any) => {
    // 1. Fetch Data
    const ledgerRef = collection(db, `users/${uid}/ledger_entries`);
    const txRef     = collection(db, `users/${uid}/transactions`);
    const miscRef   = collection(db, `users/${uid}/misc_charges`);

    const qLedger = query(ledgerRef, where('party_name', '==', party.name));
    const qTx     = query(txRef,     where('party_name', '==', party.name));
    const [lSnap, tSnap, mSnap] = await Promise.all([
      getDocs(qLedger),
      getDocs(qTx),
      getDocs(miscRef),
    ]);

    const toLocalDate = (raw: any): string => {
      if (!raw) return '';
      if (raw?.toDate) {
        const dt = raw.toDate();
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      }
      return String(raw).substring(0, 10);
    };

    const miscDocs = mSnap.docs
      .map(d => ({ id: d.id, ...d.data() as any }))
      .filter((c: any) => c.party_id === party.id || c.party_name === party.name);

    // 2. Combine & Sort (all time, ascending)
    let allEntries: any[] = [
      ...lSnap.docs.map(d => ({ ...d.data(), _type: 'BILL' })),
      ...tSnap.docs.map(d => ({ ...d.data(), _type: 'PAYMENT' })),
      ...miscDocs.map(d => ({ ...d, _type: 'MISC' })),
    ];
    allEntries.sort((a, b) => toLocalDate(a.date).localeCompare(toLocalDate(b.date)));

    // 3. Running balance starting from stored opening balance
    const ob = Number(party.opening_balance) || 0;
    let runningBalance = ob > 0
      ? (party.opening_balance_type === 'we_owe' ? -ob : ob)
      : 0;

    // Apply all entries BEFORE startDate to compute brought-forward balance
    allEntries
      .filter(e => toLocalDate(e.date) < startDate)
      .forEach(e => {
        if (e._type === 'BILL')         runningBalance += Number(e.total_amount) || 0;
        else if (e._type === 'PAYMENT') runningBalance -= Number(e.amount) || 0;
        else if (e._type === 'MISC') {
          if (e.direction === 'charge_to_party') runningBalance += Number(e.amount) || 0;
          else                                    runningBalance -= Number(e.amount) || 0;
        }
      });

    const filteredEntries = allEntries.filter(e => {
      const d = toLocalDate(e.date);
      return d >= startDate && d <= endDate;
    });

    // 4. Build sections for native PDF
    const sections: { type: 'text' | 'table'; content?: string; rows?: string[][] }[] = [];

    // Header
    sections.push({ type: 'text', content: 'STATEMENT OF ACCOUNT' });
    sections.push({ type: 'text', content: party.name });
    sections.push({ type: 'text', content: `Period: ${startDate} to ${endDate}` });
    if (party.contact) sections.push({ type: 'text', content: `Contact: ${party.contact}` });
    if (party.address) sections.push({ type: 'text', content: `Address: ${party.address}` });
    sections.push({ type: 'text', content: '' });

    // Opening balance row
    const openingLabel = runningBalance !== 0
      ? `Opening Balance (Brought Forward): ${Math.abs(runningBalance).toFixed(2)} ${runningBalance > 0 ? 'Dr' : 'Cr'}`
      : 'Opening Balance: 0.00 (Settled)';
    sections.push({ type: 'text', content: openingLabel });
    sections.push({ type: 'text', content: '' });

    // Ledger table
    const rows: string[][] = [['Date', 'Description', 'Debit (Dr)', 'Credit (Cr)', 'Balance']];
    const runStart = runningBalance; // snapshot before entries
    let bal = runStart;

    filteredEntries.forEach(e => {
      let debit  = 0;
      let credit = 0;
      let desc   = '';

      if (e._type === 'BILL') {
        debit = Number(e.total_amount) || 0;
        bal += debit;
        desc = e.type === 'sell'
          ? `Sale Inv #${e.invoice_no || '-'}`
          : `Purchase Bill #${e.bill_no || '-'}`;
        if ((e.items?.length || 0) > 0) desc += ` (${e.items.length} items)`;
      } else if (e._type === 'PAYMENT') {
        credit = Number(e.amount) || 0;
        bal -= credit;
        desc = `Payment: ${e.payment_mode || ''}`;
        if (e.payment_purpose) desc += ` — ${e.payment_purpose}`;
      } else if (e._type === 'MISC') {
        if (e.direction === 'charge_to_party') {
          debit = Number(e.amount) || 0;
          bal += debit;
        } else {
          credit = Number(e.amount) || 0;
          bal -= credit;
        }
        desc = `Misc: ${e.category || 'Charge'}${e.notes ? ' — ' + e.notes : ''}`;
      }

      rows.push([
        e.date || '-',
        desc,
        debit  > 0 ? debit.toFixed(2)  : '-',
        credit > 0 ? credit.toFixed(2) : '-',
        `${Math.abs(bal).toFixed(2)} ${bal > 0 ? 'Dr' : bal < 0 ? 'Cr' : ''}`,
      ]);
    });

    if (rows.length > 1) {
      sections.push({ type: 'table', rows });
    } else {
      sections.push({ type: 'text', content: 'No transactions in selected period.' });
    }

    sections.push({ type: 'text', content: '' });

    // Closing balance
    const closingLabel = bal > 0
      ? `Closing Balance: ${Math.abs(bal).toFixed(2)} Dr (Party owes you)`
      : bal < 0
      ? `Closing Balance: ${Math.abs(bal).toFixed(2)} Cr (You owe party)`
      : 'Account Settled — Balance: 0.00';
    sections.push({ type: 'text', content: closingLabel });
    sections.push({ type: 'text', content: `Generated: ${new Date().toLocaleDateString('en-IN')}` });

    // 5. Generate via native PDF service (no jsPDF stub dependency)
    const filename = `Statement_${party.name.replace(/\s+/g, '_')}.pdf`;
    await nativePdfService.generateAndShare(
      { title: 'Party Statement', fileName: filename, sections },
      undefined,
    );
  }
};
