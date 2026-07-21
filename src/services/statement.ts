import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportService } from './export';
import { parseDateSafe } from '../utils/dateUtils';
import { ApiService } from './api';
import { where, getDocs, query, collection } from 'firebase/firestore';
import { db } from '../config/firebase';

export const StatementService = {
  generatePartyStatement: async (uid: string, party: any, startDate: string, endDate: string, firmProfile: any) => {
    // 1. Fetch Data
    const ledgerRef = collection(db, `users/${uid}/ledger_entries`);
    const txRef     = collection(db, `users/${uid}/transactions`);
    const miscRef   = collection(db, `users/${uid}/misc_charges`);

    const qLedger = query(ledgerRef, where('party_name', '==', party.name));
    const qTx     = query(txRef,     where('party_name', '==', party.name));
    // misc_charges doesn't have party_name index — filter in JS
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
    allEntries.sort((a, b) => {
      const dA = toLocalDate(a.date), dB = toLocalDate(b.date);
      if (dA !== dB) return dA < dB ? -1 : 1;
      // Same day — stable by created_at (insertion order)
      const cA = a.created_at ? parseDateSafe(a.created_at).getTime() : 0;
      const cB = b.created_at ? parseDateSafe(b.created_at).getTime() : 0;
      return cA - cB;
    });

    // 3. Calculate Opening Balance
    // Start with the party's stored opening balance (pre-existing balance before any transactions)
    const ob = Number(party.opening_balance) || 0;
    // they_owe: party owes us → positive running balance (debt)
    // we_owe:   we owe party → negative running balance (credit)
    let runningBalance = ob > 0
      ? (party.opening_balance_type === 'we_owe' ? -ob : ob)
      : 0;

    // Apply all entries BEFORE the startDate to get the opening balance for the period
    allEntries
      .filter(e => toLocalDate(e.date) < startDate)
      .forEach(e => {
        if (e._type === 'BILL')    runningBalance += Number(e.total_amount) || 0;
        else if (e._type === 'PAYMENT') runningBalance -= Number(e.amount) || 0;
        else if (e._type === 'MISC') {
          if (e.direction === 'charge_to_party') runningBalance += Number(e.amount) || 0;
          else runningBalance -= Number(e.amount) || 0;
        }
      });

    const filteredEntries = allEntries.filter(e => {
      const d = toLocalDate(e.date);
      return d >= startDate && d <= endDate;
    });

    // 4. Generate PDF
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFontSize(18);
    doc.setTextColor(41, 128, 185);
    doc.text(firmProfile.firm_name || 'Statement', margin, 15);
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Statement of Account: ${party.name}`, margin, 22);
    doc.text(`Period: ${startDate} to ${endDate}`, margin, 27);

    // Opening balance for the period
    const obDateStr = (party as any).opening_balance_date
      ? new Date((party as any).opening_balance_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : null;
    const openingBalanceLabel = obDateStr
      ? `Opening Balance as of ${obDateStr} (Brought Forward)`
      : 'Opening Balance (Brought Forward)';
    const openingBalanceRow = runningBalance !== 0
      ? [[obDateStr || '-', openingBalanceLabel, '-', '-', runningBalance.toFixed(2)]]
      : [];

    // Table Rows
    const rows: any[][] = [];
    filteredEntries.forEach(e => {
      let debit  = 0;
      let credit = 0;
      let desc   = '';

      if (e._type === 'BILL') {
        debit = Number(e.total_amount) || 0;
        runningBalance += debit;
        desc = e.type === 'sell'
          ? `Sale Inv #${e.invoice_no || '-'}`
          : `Purchase Bill #${e.bill_no || '-'}`;
        if ((e.items?.length || 0) > 0) desc += ` — ${e.items.length} items`;
      } else if (e._type === 'PAYMENT') {
        credit = Number(e.amount) || 0;
        runningBalance -= credit;
        desc = `Payment: ${e.payment_mode || ''}`;
      } else if (e._type === 'MISC') {
        if (e.direction === 'charge_to_party') {
          debit = Number(e.amount) || 0;
          runningBalance += debit;
        } else {
          credit = Number(e.amount) || 0;
          runningBalance -= credit;
        }
        desc = `Misc: ${e.category || 'Charge'}${e.notes ? ' — ' + e.notes : ''}`;
      }

      rows.push([
        e.date || '-',
        desc,
        debit  > 0 ? debit.toFixed(2)  : '-',
        credit > 0 ? credit.toFixed(2) : '-',
        runningBalance.toFixed(2),
      ]);
    });

    autoTable(doc, {
      head: [['Date', 'Description', 'Debit (Dr)', 'Credit (Cr)', 'Balance']],
      body: [...openingBalanceRow, ...rows],
      startY: 35,
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185], textColor: 255, halign: 'left' },
      bodyStyles: { halign: 'left' },
      columnStyles: {
        0: { halign: 'left',  cellWidth: 24 },
        1: { halign: 'left' },
        2: { halign: 'right', cellWidth: 26 },
        3: { halign: 'right', cellWidth: 26 },
        4: { halign: 'right', cellWidth: 26, fontStyle: 'bold' },
      },
    });

    // Closing balance footer
    const finalY = (doc as any).lastAutoTable.finalY + 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(runningBalance > 0 ? 200 : 30, runningBalance > 0 ? 40 : 140, runningBalance > 0 ? 40 : 80);
    const closingLabel = runningBalance > 0 ? `Closing Balance: ${Math.abs(runningBalance).toFixed(2)} Dr (Party owes you)` : runningBalance < 0 ? `Closing Balance: ${Math.abs(runningBalance).toFixed(2)} Cr (You owe party)` : 'Account Settled — Balance: 0.00';
    doc.text(closingLabel, pageW - margin, finalY, { align: 'right' });

    const pdfBlob = doc.output('blob');
    await exportService.sharePdfBlob(pdfBlob, `Statement_${party.name}.pdf`);
  }
};
