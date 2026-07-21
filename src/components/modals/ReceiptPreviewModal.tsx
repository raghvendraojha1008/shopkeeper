import React, { useState } from 'react';
import { X, Share2, MessageCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import jsPDF from 'jspdf';

interface ReceiptPreviewModalProps {
  transaction: any;
  settings: any;
  onClose: () => void;
}

const ReceiptPreviewModal: React.FC<ReceiptPreviewModalProps> = ({ transaction, settings, onClose }) => {
  const { showToast } = useUI();
  const [sharing, setSharing] = useState(false);

  const isReceived = transaction.type === 'received';
  
  // Design Config
  const themeColor = isReceived ? [22, 163, 74] : [234, 88, 12]; // Green / Orange (RGB)
  const themeHex = isReceived ? "var(--col-green-dark)" : "var(--col-orange-dark)";
  const title = isReceived ? 'MONEY RECEIPT' : 'PAYMENT VOUCHER';

  // --- PDF GENERATOR (Dynamic Height) ---
  const generatePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    
    // Config
    const margin = 15;
    const boxWidth = pageWidth - (margin * 2);
    const centerX = pageWidth / 2;
    const startY = 20;

    // --- 1. PRE-CALCULATE HEIGHT ---
    // We run a 'virtual' layout pass to determine how tall the box needs to be.
    
    let contentY = startY + 24; // Start after header bar
    
    // Firm Name & Address Space
    contentY += 12; // Firm Name
    
    const address = settings.profile?.address || '';
    const addressLines = doc.splitTextToSize(address, boxWidth - 40);
    contentY += (addressLines.length * 5) + 5; // Address lines

    const contactParts = [];
    if(settings.profile?.contact) contactParts.push(`Ph: ${settings.profile.contact}`);
    if(settings.profile?.email) contactParts.push(`Email: ${settings.profile.email}`);
    if(contactParts.length > 0) contentY += 8; // Contact line
    
    contentY += 10; // Divider padding
    contentY += 15; // Receipt # & Date
    contentY += 25; // Amount Section
    contentY += 25; // Party Section
    contentY += 10; // Mode row
    
    // Optional Fields Height
    if(transaction.transaction_id) contentY += 8;
    if(transaction.bill_no) contentY += 8;

    // Notes (Can be long)
    let notesLines: string[] = [];
    if(transaction.notes) {
        notesLines = doc.splitTextToSize(transaction.notes, boxWidth - 30);
        contentY += (notesLines.length * 5) + 10; // Notes height
    }

    contentY += 15; // Footer padding

    const boxHeight = contentY - startY;

    // --- 2. DRAW BACKGROUND BOX (Using Calculated Height) ---
    doc.setDrawColor(200);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, startY, boxWidth, boxHeight, 3, 3, 'FD');

    // Header Bar (Colored)
    doc.setFillColor(themeColor[0], themeColor[1], themeColor[2]);
    // Draw top rounded corners by clipping or overdrawing (Simpler: just rect for top part)
    doc.rect(margin, startY, boxWidth, 24, 'F'); 

    // Title (White Text)
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(title, centerX, startY + 16, { align: 'center' });

    // --- 3. FILL CONTENT ---
    doc.setTextColor(30, 41, 59);
    let yPos = startY + 35;

    // Firm Name
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(settings.profile?.firm_name || 'My Business', centerX, yPos, { align: 'center' });
    yPos += 6;

    // Address
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    if(address) {
        doc.text(addressLines, centerX, yPos, { align: 'center' });
        yPos += (addressLines.length * 5);
    }

    // Contact
    if(contactParts.length > 0) {
        yPos += 2;
        doc.text(contactParts.join(' | '), centerX, yPos, { align: 'center' });
        yPos += 6;
    } else {
        yPos += 5;
    }

    // GSTIN
    if(settings.profile?.gstin && settings.automation?.auto_calculate_gst !== false) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 41, 59);
        doc.text(`GSTIN: ${settings.profile.gstin}`, centerX, yPos, { align: 'center' });
        yPos += 8;
        doc.setFont('helvetica', 'normal');
    }

    // Divider Line
    doc.setDrawColor(230);
    doc.line(margin + 10, yPos, pageWidth - margin - 10, yPos);
    yPos += 10;

    // Receipt Meta
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Receipt #: ${transaction.id.slice(0, 8).toUpperCase()}`, margin + 10, yPos);
    doc.text(`Date: ${transaction.date}`, pageWidth - margin - 10, yPos, { align: 'right' });
    yPos += 15;

    // Amount (Big)
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text('AMOUNT', centerX, yPos, { align: 'center' });
    yPos += 8;
    
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(themeColor[0], themeColor[1], themeColor[2]);
    const safeAmount = formatCurrency(transaction.amount).replace(/[^0-9.,]/g, '');
    doc.text(`Rs. ${safeAmount}`, centerX, yPos, { align: 'center' });
    
    yPos += 15;

    // Party Box
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin + 10, yPos, boxWidth - 20, 20, 2, 2, 'F');
    
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.setFont('helvetica', 'normal');
    doc.text(isReceived ? 'Received From:' : 'Paid To:', margin + 15, yPos + 13);
    
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text(transaction.party_name || 'Unknown', pageWidth - margin - 15, yPos + 13, { align: 'right' });
    
    yPos += 30;

    // Details Grid
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);

    // Mode
    doc.text('Payment Mode:', margin + 15, yPos);
    doc.setTextColor(0);
    doc.text(transaction.payment_mode || 'Cash', margin + 45, yPos);

    // Ref
    if(transaction.transaction_id) {
        doc.setTextColor(100);
        doc.text('Ref ID:', centerX + 10, yPos);
        doc.setTextColor(0);
        doc.text(transaction.transaction_id, centerX + 30, yPos);
    }
    yPos += 8;

    // Bill
    if(transaction.bill_no) {
        doc.setTextColor(100);
        doc.text('Bill/Order:', margin + 15, yPos);
        doc.setTextColor(0);
        doc.text(transaction.bill_no, margin + 45, yPos);
        yPos += 8;
    }

    // Notes
    if(notesLines.length > 0) {
        yPos += 5;
        doc.setTextColor(100);
        doc.text('Notes:', margin + 15, yPos);
        doc.setTextColor(50);
        // Indent notes slightly
        doc.text(notesLines, margin + 45, yPos);
        yPos += (notesLines.length * 5);
    }

    // Footer of Box
    doc.setFontSize(8);
    doc.setTextColor(150);
    // Position at the very bottom of the calculated box height
    const bottomY = startY + boxHeight - 5;
    doc.text('Generated via Shopkeeper Ledger', centerX, bottomY, { align: 'center' });

    return doc;
  };

  const handleSharePDF = async () => {
      setSharing(true);
      try {
          const doc = generatePDF();
          const base64 = doc.output('datauristring').split(',')[1];
          const fileName = `Receipt_${transaction.date}.pdf`;
          await exportService.saveBase64File(base64, fileName);
          showToast("Opening Receipt...", "success");
      } catch (e: any) {
          console.error(e);
          showToast("Error: " + e.message, "error");
      } finally {
          setSharing(false);
      }
  };

  const handleWhatsApp = async () => {
      const text = `${title} \nAmount: ${formatCurrency(transaction.amount)}\nParty: ${transaction.party_name}\nDate: ${transaction.date}`;
      await exportService.shareToWhatsApp(text);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex justify-center items-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh] border border-white/10" style={{background:"var(--app-bg)"}}>
        
        {/* Preview Card (Scrollable) */}
        <div className="relative bg-[var(--rgba-white-06)] p-0 flex-1 overflow-y-auto">
            {/* Header Bar */}
            <div className="h-16 flex items-center justify-center relative shrink-0" style={{ backgroundColor: themeHex }}>
                 <h2 className="text-white font-black text-lg tracking-wider">{title}</h2>
                 <button onClick={onClose} className="absolute right-3 top-3 p-1.5 bg-white/20 rounded-full text-white hover:bg-[var(--rgba-white-06)]/30"><X size={16}/></button>
            </div>
            
            <div className="p-6 text-center">
                {/* Firm */}
                <h3 className="font-bold text-[var(--text-secondary)] text-lg leading-tight mb-1">{settings.profile?.firm_name || 'My Business'}</h3>
                <p className="text-xs text-slate-500 mb-1 px-4">{settings.profile?.address}</p>
                {settings.profile?.contact && <p className="text-xs text-slate-500 mb-1">Ph: {settings.profile.contact}</p>}
                {settings.profile?.email && <p className="text-xs text-slate-500 mb-1">{settings.profile.email}</p>}
                {settings.profile?.gstin && settings.automation?.auto_calculate_gst !== false && (
                  <span className="inline-block mb-4 text-app-sm font-mono font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100">
                    GSTIN: {settings.profile.gstin}
                  </span>
                )}
                
                {/* Amount */}
                <div className="mb-6">
                    <div className="text-app-sm font-bold text-slate-400 uppercase mb-1">Amount</div>
                    <div className="text-3xl font-black" style={{ color: themeHex }}>
                        {formatCurrency(transaction.amount)}
                    </div>
                </div>

                {/* Details Box */}
                <div className="rounded-xl p-4 text-sm border border-[var(--rgba-white-08)] text-left space-y-3 bg-[var(--rgba-white-04)]">
                    <div className="flex justify-between">
                        <span className="text-slate-500 text-xs">{isReceived ? 'Received From' : 'Paid To'}</span>
                        <span className="font-bold text-[var(--text-primary)]">{transaction.party_name}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-500 text-xs">Date</span>
                        <span className="font-bold text-[var(--text-primary)]">{transaction.date}</span>
                    </div>
                    {transaction.payment_mode && (
                        <div className="flex justify-between">
                            <span className="text-slate-500 text-xs">Mode</span>
                            <span className="font-bold text-[var(--text-primary)]">{transaction.payment_mode}</span>
                        </div>
                    )}
                    {transaction.bill_no && (
                        <div className="flex justify-between">
                            <span className="text-slate-500 text-xs">Ref Bill</span>
                            <span className="font-bold text-[var(--text-primary)]">{transaction.bill_no}</span>
                        </div>
                    )}
                    {transaction.notes && (
                        <div className="flex flex-col gap-1 pt-2 border-t border-slate-200">
                             <span className="text-slate-500 text-xs">Notes</span>
                             <span className="font-medium text-[var(--text-secondary)] text-xs">{transaction.notes}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
            
        {/* Footer Actions */}
        <div className="p-4 border-t border-[var(--rgba-white-07)] flex gap-3 shrink-0 bg-[var(--rgba-white-04)]">
            <button onClick={handleWhatsApp} className="p-3 bg-green-100 text-green-700 rounded-xl flex-1 flex justify-center"><MessageCircle size={20}/></button>
            <button onClick={handleSharePDF} disabled={sharing} className="flex-[3] text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2 shadow-lg active:scale-95 transition-all" style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)"}}>
                {sharing ? <Loader2 size={18} className="animate-spin"/> : <Share2 size={18}/>} Share PDF
            </button>
        </div>
      </div>
    </div>
  );
};

export default ReceiptPreviewModal;






