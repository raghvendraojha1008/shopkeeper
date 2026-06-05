import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportService } from './export';
import { ApiService } from './api';
import { where, orderBy, getDocs, query, collection } from 'firebase/firestore';
import { db } from '../config/firebase';

export const StatementService = {
  generatePartyStatement: async (uid: string, party: any, startDate: string, endDate: string, firmProfile: any) => {
    // 1. Fetch Data
    const ledgerRef = collection(db, `users/${uid}/ledger_entries`);
    const txRef = collection(db, `users/${uid}/transactions`);
    
    // We fetch broadly and filter in JS for simpler date handling
    const qLedger = query(ledgerRef, where('party_name', '==', party.name));
    const qTx = query(txRef, where('party_name', '==', party.name));
    
    const [lSnap, tSnap] = await Promise.all([getDocs(qLedger), getDocs(qTx)]);
    
    // 2. Combine & Sort
    let allEntries = [
        ...lSnap.docs.map(d => ({ ...d.data(), _type: 'BILL' })),
        ...tSnap.docs.map(d => ({ ...d.data(), _type: 'PAYMENT' }))
    ];

    // Normalize date to local YYYY-MM-DD string regardless of Firestore Timestamp or string
    const toLocalDate = (raw: any): string => {
      if (!raw) return '';
      if (raw?.toDate) {
        const dt = raw.toDate();
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      }
      return String(raw).substring(0, 10);
    };
    
    // Sort by date ascending
    allEntries.sort((a: any, b: any) => toLocalDate(a.date).localeCompare(toLocalDate(b.date)));

    // 3. Calculate Opening Balance before Start Date
    let runningBalance = 0;
    
    const filteredEntries = allEntries.filter((e: any) => {
      const d = toLocalDate(e.date);
      return d >= startDate && d <= endDate;
    });

    // 4. Generate PDF
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(18);
    doc.setTextColor(41, 128, 185);
    doc.text(firmProfile.firm_name, 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Statement of Account: ${party.name}`, 14, 22);
    doc.text(`Period: ${startDate} to ${endDate}`, 14, 27);
    
    // Table Rows
    const rows = filteredEntries.map((e: any) => {
        const isBill = e._type === 'BILL';
        const debit = isBill ? (e.total_amount || 0) : 0;
        const credit = !isBill ? (e.amount || 0) : 0;
        
        // Simple running balance logic for the view
        if(isBill) runningBalance += debit;
        else runningBalance -= credit;

        return [
            e.date,
            isBill ? `Inv #${e.invoice_no || '-'} - ${e.items?.length || 0} Items` : `Pmt: ${e.payment_mode}`,
            debit > 0 ? debit.toFixed(2) : '-',
            credit > 0 ? credit.toFixed(2) : '-',
            runningBalance.toFixed(2)
        ];
    });

    autoTable(doc, {
        head: [['Date', 'Description', 'Debit (Bill)', 'Credit (Paid)', 'Balance']],
        body: rows,
        startY: 35,
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185], textColor: 255, halign: 'left' },
        bodyStyles: { halign: 'left' },
        columnStyles: {
            0: { halign: 'left' },
            1: { halign: 'left' },
            2: { halign: 'right' },
            3: { halign: 'right' },
            4: { halign: 'right', fontStyle: 'bold' }
        }
    });

    // Save — Android 35: blob → sharePdfBlob (no storage permission needed)
    const pdfBlob = doc.output('blob');
    await exportService.sharePdfBlob(pdfBlob, `Statement_${party.name}.pdf`);
  }
};







