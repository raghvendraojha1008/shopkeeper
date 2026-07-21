import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportService } from './export';

interface UnpaidBill {
  date: string;
  invoice_no: string;
  items: { item_name: string; quantity: number; rate: number; total: number }[];
  total_amount: number;
  paid: number;
  balance: number;
  daysOld: number;
}

interface PartyInfo {
  name: string;
  contact?: string;
  address?: string;
}

export const ReminderPdfService = {
  /**
   * Generate a professional mini-statement PDF for a customer
   * showing all unpaid bills in one document
   */
  generateMiniStatement: async (
    party: PartyInfo,
    unpaidBills: UnpaidBill[],
    firmProfile: { firm_name: string; contact?: string; address?: string }
  ): Promise<string | null> => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      
      // Header - Firm Details
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, pageWidth, 45, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.text(firmProfile.firm_name || 'Business Name', 14, 20);
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      if (firmProfile.contact) doc.text(`Contact: ${firmProfile.contact}`, 14, 28);
      if (firmProfile.address) doc.text(firmProfile.address.slice(0, 60), 14, 36);
      
      // Statement Label
      doc.setTextColor(148, 163, 184); // slate-400
      doc.setFontSize(12);
      doc.text('ACCOUNT STATEMENT', pageWidth - 14, 20, { align: 'right' });
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, pageWidth - 14, 29, { align: 'right' });
      
      // Party Details Section
      doc.setTextColor(30, 41, 59); // slate-800
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('Statement For:', 14, 55);
      
      doc.setFontSize(16);
      doc.text(party.name, 14, 64);
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139); // slate-500
      if (party.contact) doc.text(`Phone: ${party.contact}`, 14, 72);
      if (party.address) doc.text(party.address.slice(0, 50), 14, 79);
      
      // Summary Box
      const totalDue = unpaidBills.reduce((sum, b) => sum + b.balance, 0);
      const criticalDue = unpaidBills.filter(b => b.daysOld > 30).reduce((sum, b) => sum + b.balance, 0);
      
      doc.setFillColor(254, 242, 242); // rose-50
      doc.roundedRect(pageWidth - 80, 52, 66, 28, 3, 3, 'F');
      
      doc.setTextColor(190, 18, 60); // rose-700
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('TOTAL OUTSTANDING', pageWidth - 47, 60, { align: 'center' });
      
      doc.setFontSize(18);
      doc.text(`Rs.${totalDue.toLocaleString('en-IN')}`, pageWidth - 47, 72, { align: 'center' });
      
      // Aging Summary Bar
      const aging = {
        current: unpaidBills.filter(b => b.daysOld <= 15).reduce((sum, b) => sum + b.balance, 0),
        moderate: unpaidBills.filter(b => b.daysOld > 15 && b.daysOld <= 30).reduce((sum, b) => sum + b.balance, 0),
        critical: criticalDue
      };
      
      let yPos = 90;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('AGING BREAKDOWN', 14, yPos);
      
      yPos += 8;
      const barWidth = pageWidth - 28;
      const total = aging.current + aging.moderate + aging.critical || 1;
      
      // Draw aging bar
      const currentWidth = (aging.current / total) * barWidth;
      const moderateWidth = (aging.moderate / total) * barWidth;
      const criticalWidth = (aging.critical / total) * barWidth;
      
      if (aging.current > 0) {
        doc.setFillColor(34, 197, 94); // green-500
        doc.roundedRect(14, yPos, currentWidth, 8, 2, 2, 'F');
      }
      if (aging.moderate > 0) {
        doc.setFillColor(251, 191, 36); // amber-400
        doc.rect(14 + currentWidth, yPos, moderateWidth, 8, 'F');
      }
      if (aging.critical > 0) {
        doc.setFillColor(239, 68, 68); // red-500
        doc.roundedRect(14 + currentWidth + moderateWidth, yPos, criticalWidth, 8, 2, 2, 'F');
      }
      
      // Legend
      yPos += 15;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      
      doc.setFillColor(34, 197, 94);
      doc.circle(16, yPos, 2, 'F');
      doc.text(`0-15 days: Rs.${aging.current.toLocaleString('en-IN')}`, 21, yPos + 1);
      
      doc.setFillColor(251, 191, 36);
      doc.circle(76, yPos, 2, 'F');
      doc.text(`16-30 days: Rs.${aging.moderate.toLocaleString('en-IN')}`, 81, yPos + 1);
      
      doc.setFillColor(239, 68, 68);
      doc.circle(140, yPos, 2, 'F');
      doc.text(`30+ days: Rs.${aging.critical.toLocaleString('en-IN')}`, 145, yPos + 1);
      
      // Bills Table
      yPos += 12;
      
      const tableRows = unpaidBills.map(bill => [
        bill.date,
        `#${bill.invoice_no}`,
        `Rs.${bill.total_amount.toFixed(2)}`,
        `Rs.${bill.paid.toFixed(2)}`,
        `Rs.${bill.balance.toFixed(2)}`,
        bill.daysOld > 30 ? 'OVERDUE' : `${bill.daysOld}d`
      ]);
      
      autoTable(doc, {
        head: [['Date', 'Invoice', 'Bill Amount', 'Paid', 'Balance', 'Age']],
        body: tableRows,
        startY: yPos,
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: 255,
          fontSize: 10,
          fontStyle: 'bold',
          halign: 'left'
        },
        bodyStyles: {
          fontSize: 10,
          cellPadding: 4,
          halign: 'left'
        },
        columnStyles: {
          0: { cellWidth: 24, halign: 'left' },
          1: { cellWidth: 25, halign: 'left' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold', textColor: [190, 18, 60] },
          5: { halign: 'left', fontSize: 9 }
        },
        alternateRowStyles: { fillColor: [248, 250, 252] }
      });
      
      // Footer
      const finalY = (doc as any).lastAutoTable?.finalY || yPos + 50;
      
      doc.setDrawColor(226, 232, 240);
      doc.line(14, finalY + 10, pageWidth - 14, finalY + 10);
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Please settle your dues at the earliest.', 14, finalY + 20);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('For queries, contact us at the details provided above.', 14, finalY + 28);
      doc.text('Thank you for your business!', 14, finalY + 35);
      
      // Output
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      const filename = `Statement_${party.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      await exportService.saveBase64File(pdfBase64, filename);
      return pdfBase64;
    } catch (error) {
      console.error('PDF Generation Error:', error);
      return null;
    }
  },

  /**
   * Calculate days since a date
   */
  getDaysOld: (dateStr: string): number => {
    const billDate = new Date(dateStr);
    const today = new Date();
    const diffTime = today.getTime() - billDate.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  },

  /**
   * Get aging category for a bill
   */
  getAgingCategory: (daysOld: number): 'current' | 'moderate' | 'critical' => {
    if (daysOld <= 15) return 'current';
    if (daysOld <= 30) return 'moderate';
    return 'critical';
  }
};







