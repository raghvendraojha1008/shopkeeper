import React, { useState, useMemo } from 'react';
import { X, Share2, MessageCircle, Loader2, CheckSquare, Square } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { formatCurrency } from '../../utils/helpers';
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { amountInWords, fmtINR } from '../../utils/gstUtils';
import { nativePdfService } from '../../services/nativePdfService';
import { useBackHandler } from '../../services/useBackHandler';

interface InvoicePreviewModalProps {
  invoice: any;
  settings: any;
  parties?: any[];
  onClose: () => void;
}

type PrintMode = 'standard' | 'thermal58' | 'thermal80';

// Helper: hex to RGB
const hexToRgb = (hex: string): [number, number, number] | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  ] : null;
};

const InvoicePreviewModal: React.FC<InvoicePreviewModalProps> = ({ invoice, settings, parties = [], onClose }) => {
  const { showToast } = useUI();
  // Android back closes the modal (always mounted = always active)
  useBackHandler(onClose, true);
  const [sharing, setSharing] = useState(false);
  const [includeRent, setIncludeRent] = useState(false);
  const [printMode, setPrintMode] = useState<PrintMode>('standard');

  const isGstEnabled = settings.automation?.auto_calculate_gst !== false;
  const partyDetails = parties.find(p => p.name === invoice.party_name) || {};

  // Recalculation logic (same as before)
  const calculatedData = useMemo(() => {
    const items = (invoice.items || []).map((item: any) => {
      const qty = Number(item.quantity) || 0;
      const rate = Number(item.rate) || 0;
      const gstPercent = Number(item.gst_percent) || 0;
      const priceType = item.price_type || 'exclusive';

      let taxable = 0, tax = 0, total = 0;
      if (priceType === 'inclusive') {
        total = qty * rate;
        taxable = total / (1 + (gstPercent / 100));
        tax = total - taxable;
      } else {
        taxable = qty * rate;
        tax = taxable * (gstPercent / 100);
        total = taxable + tax;
      }
      return { ...item, qty, rate, gstPercent, taxable, tax, total };
    });

    const totalTaxable = items.reduce((sum: number, i: any) => sum + i.taxable, 0);
    const totalTax = items.reduce((sum: number, i: any) => sum + i.tax, 0);
    const vehicleRent = Number(invoice.vehicle_rent) || 0;
    const grandTotal = totalTaxable + totalTax + (includeRent ? vehicleRent : 0);

    return { items, totalTaxable, totalTax, vehicleRent, grandTotal };
  }, [invoice, includeRent]);

  // Direct PDF generation (no canvas)
  const generatePDF = (): jsPDF => {
    if (printMode !== 'standard') {
      return generateThermalPDF(printMode === 'thermal58' ? 58 : 80);
    }
    return generateStandardPDF();
  };

  const generateStandardPDF = (): jsPDF => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const margin = 15;

    const primaryColor = settings?.invoice_template?.theme_color || '#1e3a8a';
    const rgb = hexToRgb(primaryColor) || [30, 58, 138];

    // Header
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.rect(0, 0, pageWidth, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(settings.profile?.firm_name || 'My Business', margin, 15);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    if (settings.profile?.address) doc.text(settings.profile.address, margin, 21);

    // Title
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE', pageWidth - margin, 35, { align: 'right' });
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Invoice #: ${invoice.invoice_no || '-'}`, pageWidth - margin, 42, { align: 'right' });
    doc.text(`Date: ${invoice.date}`, pageWidth - margin, 48, { align: 'right' });

    // Firm details
    let yPos = 55;
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text(settings.profile?.firm_name || 'My Business', margin, yPos);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    yPos += 5;
    if (settings.profile?.address) {
      const addrLines = doc.splitTextToSize(settings.profile.address, 100);
      doc.text(addrLines, margin, yPos);
      yPos += addrLines.length * 4;
    }
    if (settings.profile?.contact) {
      doc.text(`Phone: ${settings.profile.contact}`, margin, yPos);
      yPos += 4;
    }
    if (settings.profile?.gstin) {
      doc.setFont('helvetica', 'bold');
      doc.text(`GSTIN: ${settings.profile.gstin}`, margin, yPos);
      yPos += 6;
    }

    // Bill To box
    const rightColX = pageWidth / 2 + 10;
    doc.setFillColor(248, 250, 252);
    doc.rect(rightColX, 55, 80, 35, 'F');
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('BILL TO:', rightColX + 3, 62);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(invoice.party_name, rightColX + 3, 69);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    let billY = 75;
    if (partyDetails.address) {
      doc.text(partyDetails.address, rightColX + 3, billY);
      billY += 4;
    }
    if (partyDetails.contact) {
      doc.text(`Ph: ${partyDetails.contact}`, rightColX + 3, billY);
      billY += 4;
    }
    if (partyDetails.gstin) {
      doc.setFont('helvetica', 'bold');
      doc.text(`GSTIN: ${partyDetails.gstin}`, rightColX + 3, billY);
      billY += 4;
      doc.setFont('helvetica', 'normal');
    }
    if (invoice.site || partyDetails.site) {
      doc.setFont('helvetica', 'bold');
      doc.text(`Site: ${invoice.site || partyDetails.site}`, rightColX + 3, billY);
      doc.setFont('helvetica', 'normal');
    }

    // Items table
    const head = isGstEnabled
      ? [['Item', 'Qty', 'Rate', 'GST', 'Total']]
      : [['Item', 'Qty', 'Rate', 'Total']];
    const body = calculatedData.items.map((item: any) => {
      const row: any[] = [
        item.item_name,
        `${item.qty} ${item.unit || ''}`,
        fmtINR(Number(item.rate), 'Rs.'),
        isGstEnabled ? `${item.gstPercent}%` : null,
        fmtINR(Number(item.total), 'Rs.')
      ];
      return row.filter(x => x !== null);
    });

    autoTable(doc, {
      startY: 100,
      head,
      body,
      theme: 'grid',
      headStyles: { fillColor: rgb, textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { halign: 'center', cellWidth: 25 },
        2: { halign: 'right', cellWidth: 30 },
        3: isGstEnabled ? { halign: 'center', cellWidth: 20 } : undefined,
        4: { halign: 'right', cellWidth: 35, fontStyle: 'bold' }
      },
      margin: { left: margin, right: margin }
    });

    // @ts-ignore
    let finalY = doc.lastAutoTable.finalY + 8;
    const totalsX = pageWidth - margin - 60;

    doc.setFontSize(9);
    doc.setTextColor(80);
    if (isGstEnabled) {
      doc.text('Taxable Amount:', totalsX, finalY);
      doc.text(fmtINR(calculatedData.totalTaxable, 'Rs.'), pageWidth - margin, finalY, { align: 'right' });
      finalY += 5;
      doc.text('Total Tax:', totalsX, finalY);
      doc.text(fmtINR(calculatedData.totalTax, 'Rs.'), pageWidth - margin, finalY, { align: 'right' });
      finalY += 5;
    }
    if (includeRent && calculatedData.vehicleRent > 0) {
      doc.text('Transport:', totalsX, finalY);
      doc.text(fmtINR(calculatedData.vehicleRent, 'Rs.'), pageWidth - margin, finalY, { align: 'right' });
      finalY += 5;
    }

    doc.setDrawColor(200);
    doc.line(totalsX - 10, finalY, pageWidth - margin, finalY);
    finalY += 6;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    doc.text('GRAND TOTAL:', totalsX, finalY);
    doc.text(fmtINR(calculatedData.grandTotal, 'Rs.'), pageWidth - margin, finalY, { align: 'right' });

    // Amount in words
    finalY += 8;
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, finalY, pageWidth - margin * 2, 10, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100);
    doc.text('Amount in Words:', margin + 3, finalY + 6);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(60);
    doc.text(amountInWords(calculatedData.grandTotal), margin + 45, finalY + 6, { maxWidth: pageWidth - margin * 2 - 50 });

    // Footer
    const pageHeight = doc.internal.pageSize.height;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150);
    doc.text('Thank you for your business!', pageWidth / 2, pageHeight - 20, { align: 'center' });
    doc.text('Authorized Signatory', pageWidth - margin, pageHeight - 15, { align: 'right' });

    return doc;
  };

  const generateThermalPDF = (width: 58 | 80): jsPDF => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [width, 200] });
    const pageWidth = width;
    const margin = 2;
    let yPos = 5;
    const lineHeight = width === 58 ? 3.5 : 4;
    const fontSize = width === 58 ? 7 : 8;

    doc.setFontSize(fontSize + 2);
    doc.setFont('helvetica', 'bold');
    doc.text(settings.profile?.firm_name || 'My Business', pageWidth / 2, yPos, { align: 'center' });
    yPos += lineHeight + 1;

    doc.setFontSize(fontSize - 1);
    doc.setFont('helvetica', 'normal');
    if (settings.profile?.contact) {
      doc.text(`Ph: ${settings.profile.contact}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += lineHeight;
    }

    doc.setDrawColor(150);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += lineHeight;

    doc.setFontSize(fontSize);
    doc.text(`Bill #: ${invoice.invoice_no || '-'}`, margin, yPos);
    doc.text(invoice.date, pageWidth - margin, yPos, { align: 'right' });
    yPos += lineHeight;
    doc.text(`To: ${invoice.party_name}`, margin, yPos);
    yPos += lineHeight;
    // FIX: Include address, GSTIN, site on thermal receipt for both GST & non-GST customers
    if (partyDetails.address) {
      const addrLines = doc.splitTextToSize(partyDetails.address, pageWidth - margin * 2);
      doc.text(addrLines, margin, yPos);
      yPos += lineHeight * addrLines.length;
    }
    if (partyDetails.contact) {
      doc.text(`Ph: ${partyDetails.contact}`, margin, yPos);
      yPos += lineHeight;
    }
    if (partyDetails.gstin) {
      doc.text(`GSTIN: ${partyDetails.gstin}`, margin, yPos);
      yPos += lineHeight;
    }
    if (invoice.site || partyDetails.site) {
      doc.setFont('helvetica', 'bold');
      doc.text(`Site: ${invoice.site || partyDetails.site}`, margin, yPos);
      doc.setFont('helvetica', 'normal');
      yPos += lineHeight;
    }
    yPos += 1;

    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += lineHeight;

    doc.setFont('helvetica', 'bold');
    const col1 = margin;
    const col2 = pageWidth * 0.45;
    const col3 = pageWidth * 0.65;
    const col4 = pageWidth - margin;
    doc.text('Item', col1, yPos);
    doc.text('Qty', col2, yPos);
    doc.text('Rate', col3, yPos);
    doc.text('Amt', col4, yPos, { align: 'right' });
    yPos += lineHeight;
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += lineHeight;

    doc.setFont('helvetica', 'normal');
    calculatedData.items.forEach((item: any) => {
      const name = item.item_name.length > 12 ? item.item_name.substring(0, 12) + '..' : item.item_name;
      doc.text(name, col1, yPos);
      doc.text(`${item.qty}`, col2, yPos);
      doc.text(`${item.rate}`, col3, yPos);
      doc.text(`${Math.round(item.total)}`, col4, yPos, { align: 'right' });
      yPos += lineHeight;
    });

    yPos += 1;
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += lineHeight + 1;

    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL:', margin, yPos);
    doc.text(`Rs.${Math.round(calculatedData.grandTotal)}`, col4, yPos, { align: 'right' });
    yPos += lineHeight + 2;

    doc.setLineDashPattern([1, 1], 0);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += lineHeight;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize - 1);
    doc.text('Thank You!', pageWidth / 2, yPos, { align: 'center' });

    return doc;
  };

  const handleWhatsApp = async () => {
    const text = `*Invoice*\nType: ${isGstEnabled ? 'Tax Invoice' : 'Invoice'}\nParty: ${invoice.party_name}\nDate: ${invoice.date}\nAmount: ${formatCurrency(calculatedData.grandTotal)}\nInvoice: ${invoice.invoice_no || 'NA'}`;
    if (Capacitor.isNativePlatform()) {
      try { await Share.share({ text }); } catch (_) {}
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  };

  const handleSharePDF = async () => {
    setSharing(true);
    try {
      // Build sections for native PDF
      const nativeData = nativePdfService.invoiceToSections(invoice, settings);

      // Generate jsPDF blob for fallback (or use existing generatePDF function)
      const doc = generatePDF(); // your existing jsPDF generation
      const fallbackBlob = doc.output('blob');

      // Attempt native generation + share
      const success = await nativePdfService.generateAndShare(nativeData, fallbackBlob);
      
      if (success) {
        showToast('PDF shared successfully!', 'success');
      } else {
        showToast('Failed to share PDF', 'error');
      }
    } catch (e: any) {
      console.error('PDF share error:', e);
      showToast('Export failed: ' + (e.message || 'Unknown error'), 'error');
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex justify-center items-end md:items-center animate-in fade-in duration-200">
      <div className="bg-[var(--app-bg)] w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col max-h-[95vh] md:h-[85vh]">
        {/* Header (unchanged) */}
        <div className="p-4 border-b border-white/08 rounded-t-2xl flex justify-between items-center shrink-0">
          <h2 className="font-bold text-lg text-[rgba(240,244,255,0.95)]">Preview</h2>
          <div className="flex gap-2 items-center flex-wrap">
            <div className="flex p-0.5 rounded-lg">
              {(['standard', 'thermal58', 'thermal80'] as PrintMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setPrintMode(mode)}
                  className={`px-2 py-1 text-[9px] font-bold rounded transition-all ${
                    printMode === mode ? 'bg-white shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {mode === 'standard' ? 'A4' : mode === 'thermal58' ? '58mm' : '80mm'}
                </button>
              ))}
            </div>
            {calculatedData.vehicleRent > 0 && (
              <button
                onClick={() => setIncludeRent(!includeRent)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  includeRent ? 'bg-[rgba(59,130,246,0.2)] text-blue-400' : 'bg-[rgba(255,255,255,0.07)] text-[rgba(148,163,184,0.45)]'
                }`}
              >
                {includeRent ? <CheckSquare size={14} /> : <Square size={14} />} Rent
              </button>
            )}
            <button onClick={handleWhatsApp} className="p-2 bg-green-100 text-green-700 rounded-lg active:scale-95">
              <MessageCircle size={16} />
            </button>
            <button
              onClick={handleSharePDF}
              disabled={sharing}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg font-bold flex items-center gap-2 active:scale-95 shadow-lg"
            >
              {sharing ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
            </button>
            <button onClick={onClose} className="p-2 bg-slate-200 text-slate-600 rounded-lg active:scale-95">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Preview Area (visual only, not used for PDF) */}
        <div className="flex-1 overflow-auto bg-[#080d1a] p-4">
          <div className={`shadow-lg mx-auto rounded-lg p-6 text-xs md:text-sm bg-[rgba(15,20,40,0.98)] text-[rgba(240,244,255,0.92)] ${
            printMode === 'thermal58' ? 'max-w-[200px]' : printMode === 'thermal80' ? 'max-w-[280px]' : 'min-w-[350px] max-w-[600px]'
          }`}>
            {/* Preview content same as before, unchanged */}
            {printMode !== 'standard' ? (
              <div className="text-center font-mono">
                <h1 className="text-sm font-bold">{settings.profile?.firm_name || 'My Business'}</h1>
                {settings.profile?.contact && <p className="text-[10px]">Ph: {settings.profile.contact}</p>}
                <div className="border-t border-dashed border-slate-300 my-2" />
                <div className="flex justify-between text-[10px]">
                  <span>Bill #: {invoice.invoice_no || '-'}</span>
                  <span>{invoice.date}</span>
                </div>
                <div className="text-left text-[10px] mt-1">To: {invoice.party_name}</div>
                <div className="border-t border-slate-300 my-2" />
                <div className="grid grid-cols-4 text-[9px] font-bold border-b border-slate-200 pb-1">
                  <span className="text-left">Item</span><span>Qty</span><span>Rate</span><span className="text-right">Amt</span>
                </div>
                {calculatedData.items.map((it: any, i: number) => (
                  <div key={i} className="grid grid-cols-4 text-[9px] py-0.5">
                    <span className="text-left truncate">{it.item_name}</span>
                    <span>{it.qty}</span>
                    <span>{it.rate}</span>
                    <span className="text-right">{Math.round(it.total)}</span>
                  </div>
                ))}
                <div className="border-t border-slate-300 my-2" />
                <div className="flex justify-between font-bold">
                  <span>TOTAL:</span><span>₹{Math.round(calculatedData.grandTotal)}</span>
                </div>
                <div className="border-t border-dashed border-slate-300 my-2" />
                <p className="text-[9px]">Thank You!</p>
              </div>
            ) : (
              <>
                {/* Standard invoice preview content unchanged */}
                <div className="border-b-2 border-[rgba(255,255,255,0.08)] pb-4 mb-4">
                  <h1 className="text-xl font-black uppercase">{settings.profile?.firm_name || 'My Business'}</h1>
                  <p className="text-slate-500 mt-1 whitespace-pre-line">{settings.profile?.address}</p>
                  {settings.profile?.contact && <p className="font-bold mt-1">Phone: {settings.profile.contact}</p>}
                  {isGstEnabled && settings.profile?.gstin && (
                    <span className="inline-block mt-1.5 text-[10px] font-mono font-bold bg-[rgba(59,130,246,0.12)] text-[#93c5fd] px-2 py-1 rounded">
                      GSTIN: {settings.profile.gstin}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="p-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)]">
                    <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Bill To</div>
                    <div className="font-bold text-sm">{invoice.party_name}</div>
                    {/* FIX: Always show address & site (not gated on GSTIN). For non-GST
                        customers we still want delivery address visible on invoice. */}
                    {partyDetails.address && <div className="text-xs text-slate-500 mt-1 whitespace-pre-line">{partyDetails.address}</div>}
                    {partyDetails.contact && <div className="text-xs text-slate-500">Ph: {partyDetails.contact}</div>}
                    {partyDetails.gstin && (
                      <div className="text-[10px] font-mono font-bold text-blue-400 mt-1">GSTIN: {partyDetails.gstin}</div>
                    )}
                    {(invoice.site || partyDetails.site) && (
                      <div className="text-xs text-violet-300 font-bold mt-1">Site: {invoice.site || partyDetails.site}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-[rgba(148,163,184,0.45)]">INVOICE</div>
                    <div className="font-bold">#{invoice.invoice_no || '-'}</div>
                    <div className="text-slate-500">{invoice.date}</div>
                  </div>
                </div>
                <table className="w-full text-left mb-6">
                  <thead className="text-[10px] uppercase bg-[rgba(139,92,246,0.25)]">
                    <tr>
                      <th className="p-3">Item</th><th className="p-3 text-center">Qty</th><th className="p-3 text-right">Rate</th>
                      {isGstEnabled && <th className="p-3 text-right">GST</th>}<th className="p-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px]">
                    {calculatedData.items.map((it: any, i: number) => (
                      <tr key={i}>
                        <td className="p-3 font-bold">{it.item_name}</td>
                        <td className="p-3 text-center">{it.qty} {it.unit}</td>
                        <td className="p-3 text-right">₹{it.rate}</td>
                        {isGstEnabled && <td className="p-3 text-right">{it.gstPercent}%</td>}
                        <td className="p-3 text-right font-bold">₹{it.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-end">
                  <div className="text-right w-1/2">
                    {isGstEnabled && (
                      <>
                        <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                          <span>Taxable:</span><span>₹{calculatedData.totalTaxable.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                          <span>Tax:</span><span>₹{calculatedData.totalTax.toLocaleString()}</span>
                        </div>
                      </>
                    )}
                    {calculatedData.vehicleRent > 0 && (
                      <div className={`flex justify-between text-[11px] mb-2 ${includeRent ? 'font-bold' : 'line-through'}`}>
                        <span>Transport:</span><span>₹{calculatedData.vehicleRent}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs font-bold uppercase border-t pt-2">
                      <span>Total</span><span className="text-lg">{formatCurrency(calculatedData.grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoicePreviewModal;