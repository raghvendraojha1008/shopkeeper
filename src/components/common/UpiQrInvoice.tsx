/**
 * UpiQrInvoice — Embeds a UPI payment QR code on invoices/receipts.
 * Uses the UPI deep-link URI standard (works with PhonePe, GPay, Paytm, etc.)
 * QR is rendered via a free open API — no server needed.
 */
import React, { useState } from 'react';
import { QrCode, ExternalLink, Copy, CheckCircle2 } from 'lucide-react';

interface UpiQrInvoiceProps {
  upiId: string;        // e.g. "9876543210@ybl"
  payeeName: string;    // Firm name shown in UPI app
  amount?: number;      // Pre-fill amount (optional)
  invoiceRef?: string;  // Invoice # shown in remarks
  compact?: boolean;    // Show small version for PDF embed
}

/** Build UPI deep-link URI per NPCI spec */
export function buildUpiUri(upiId: string, payeeName: string, amount?: number, ref?: string): string {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    cu: 'INR',
  });
  if (amount && amount > 0) params.set('am', amount.toFixed(2));
  if (ref) params.set('tn', `Invoice ${ref}`);
  return `upi://pay?${params.toString()}`;
}

/** Returns the QR code image URL (Google Chart API — no key needed) */
export function upiQrImageUrl(upiUri: string, size: number = 200): string {
  const encoded = encodeURIComponent(upiUri);
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encoded}&size=${size}x${size}&margin=8&color=000000&bgcolor=ffffff&format=png`;
}

const UpiQrInvoice: React.FC<UpiQrInvoiceProps> = ({
  upiId, payeeName, amount, invoiceRef, compact = false
}) => {
  const [copied, setCopied] = useState(false);
  const upiUri = buildUpiUri(upiId, payeeName, amount, invoiceRef);
  const qrUrl  = upiQrImageUrl(upiUri, compact ? 120 : 200);

  const handleCopy = () => {
    navigator.clipboard?.writeText(upiId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleOpenUpi = () => {
    window.open(upiUri, '_blank');
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-2 rounded-xl"
        style={{background:'var(--rgba-white-05)', border:'1px solid var(--glass-border)'}}>
        <img src={qrUrl} alt="UPI QR" className="w-14 h-14 rounded-lg bg-white p-0.5" loading="lazy"/>
        <div className="flex-1 min-w-0">
          <div className="text-app-xs font-bold uppercase tracking-wide mb-0.5" style={{color: 'var(--text-muted)'}}>
            Scan to Pay (UPI)
          </div>
          <div className="text-xs font-black truncate" style={{color: 'var(--text-primary)'}}>{upiId}</div>
          {amount && <div className="text-app-sm font-bold" style={{color:"var(--col-success)"}}>₹{amount.toLocaleString('en-IN')}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{background:'var(--rgba-white-04)', border:'1px solid var(--glass-border)'}}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3" style={{borderBottom:'1px solid var(--glass-border)'}}>
        <div className="p-1.5 rounded-lg" style={{background:'var(--col-emerald-15)'}}>
          <QrCode size={13} style={{color:"var(--col-success)"}}/>
        </div>
        <span className="text-xs font-black uppercase tracking-wide" style={{color:'var(--col-success-95)'}}>
          Pay via UPI
        </span>
        {amount && (
          <span className="ml-auto text-sm font-black" style={{color:"var(--col-success)"}}>
            ₹{amount.toLocaleString('en-IN')}
          </span>
        )}
      </div>

      {/* QR + Details */}
      <div className="p-4 flex gap-4 items-center">
        <div className="flex-shrink-0">
          <img
            src={qrUrl}
            alt="UPI Payment QR Code"
            className="w-36 h-36 rounded-xl bg-white p-1.5 shadow-lg"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="text-app-2xs text-center mt-1 font-bold" style={{color: 'var(--text-muted)'}}>
            Scan with any UPI app
          </div>
        </div>

        <div className="flex-1 space-y-2">
          <div>
            <div className="text-app-xs font-bold uppercase mb-0.5" style={{color: 'var(--text-muted)'}}>UPI ID</div>
            <div className="text-sm font-black" style={{color: 'var(--text-primary)'}}>{upiId}</div>
          </div>
          <div>
            <div className="text-app-xs font-bold uppercase mb-0.5" style={{color: 'var(--text-muted)'}}>Payee</div>
            <div className="text-xs font-bold" style={{color: 'var(--text-secondary)'}}>{payeeName}</div>
          </div>
          {invoiceRef && (
            <div>
              <div className="text-app-xs font-bold uppercase mb-0.5" style={{color: 'var(--text-muted)'}}>Reference</div>
              <div className="text-xs font-bold font-mono" style={{color: 'var(--text-muted)'}}>#{invoiceRef}</div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={handleCopy}
              className="flex-1 py-2 rounded-xl text-app-sm font-black flex items-center justify-center gap-1.5 transition-all active:scale-95"
              style={{background:'var(--col-success-12)', color:"var(--col-success)", border:'1px solid var(--col-success-25)'}}>
              {copied ? <CheckCircle2 size={12}/> : <Copy size={12}/>}
              {copied ? 'Copied!' : 'Copy ID'}
            </button>
            <button onClick={handleOpenUpi}
              className="flex-1 py-2 rounded-xl text-app-sm font-black flex items-center justify-center gap-1.5 transition-all active:scale-95"
              style={{background:'var(--col-info-12)', color:"var(--col-info)", border:'1px solid var(--col-info-25)'}}>
              <ExternalLink size={12}/> Open App
            </button>
          </div>

          <div className="flex items-center gap-1 pt-1">
            {['GPay','PhonePe','Paytm','BHIM'].map(app => (
              <span key={app} className="text-app-3xs font-bold px-1.5 py-0.5 rounded-full"
                style={{background:'var(--rgba-white-06)', color: 'var(--text-muted)'}}>
                {app}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpiQrInvoice;






