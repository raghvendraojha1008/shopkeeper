/**
 * ExportOptionsModal
 * Two-step export flow: user picks customization options before the download starts.
 * Opened from PartiesView (CSV party list, bulk PDF) and PartyDetailView (CSV, PDF).
 */
import React, { useState } from 'react';
import { X, Download, FileText, Table2, Info } from 'lucide-react';
import { ExportOptions, DEFAULT_EXPORT_OPTIONS } from '../../types/exportOptions';

export type { ExportOptions };
export { DEFAULT_EXPORT_OPTIONS };

// ─── Props ──────────────────────────────────────────────────────────────────
export type ExportFormat = 'csv' | 'pdf' | 'bulk-pdf' | 'bulk-csv';

interface ExportOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: ExportOptions) => void;
  exportFormat: ExportFormat;
  /** The role of the party being exported — controls which reference-price option to show */
  partyRole?: 'customer' | 'supplier' | 'mixed';
  isLoading?: boolean;
}

// ─── Checkbox row ────────────────────────────────────────────────────────────
function OptionRow({
  label,
  sublabel,
  checked,
  onChange,
  accent = 'violet',
  badge,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  accent?: 'violet' | 'green' | 'amber' | 'blue' | 'rose';
  badge?: string;
}) {
  const colors: Record<string, string> = {
    violet: 'var(--col-violet-85)',
    green:  'var(--col-success-85)',
    amber:  'rgba(251,191,36,0.8)',
    blue:   'rgba(96,165,250,0.8)',
    rose:   'rgba(251,113,133,0.8)',
  };
  const fills: Record<string, string> = {
    violet: 'var(--col-violet-15)',
    green:  'var(--col-success-12)',
    amber:  'rgba(251,191,36,0.10)',
    blue:   'rgba(96,165,250,0.12)',
    rose:   'rgba(251,113,133,0.10)',
  };
  const color = colors[accent];
  const fill  = fills[accent];

  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl active:scale-[0.98] transition-all text-left"
      style={{ background: checked ? fill : 'transparent', border: `1px solid ${checked ? color.replace('0.8','0.25') : 'var(--rgba-white-06)'}` }}
    >
      {/* Custom checkbox */}
      <div
        className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-all"
        style={{
          background: checked ? color : 'var(--rgba-white-06)',
          border: `1.5px solid ${checked ? color :  'var(--rgba-white-15)'}`,
        }}
      >
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: checked ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {label}
          </span>
          {badge && (
            <span className="text-app-xs font-black uppercase px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(251,113,133,0.15)', color: "var(--col-rose)", border: '1px solid rgba(251,113,133,0.25)' }}>
              {badge}
            </span>
          )}
        </div>
        {sublabel && (
          <span className="text-app-sm" style={{ color: 'var(--text-muted)' }}>{sublabel}</span>
        )}
      </div>
    </button>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────
function SectionHeader({ title, icon }: { title: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1 px-1">
      {icon && <span style={{ color: 'var(--text-muted)' }}>{icon}</span>}
      <span className="text-app-sm font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
        {title}
      </span>
    </div>
  );
}

// ─── Main modal ──────────────────────────────────────────────────────────────
export default function ExportOptionsModal({
  isOpen,
  onClose,
  onConfirm,
  exportFormat,
  partyRole = 'mixed',
  isLoading = false,
}: ExportOptionsModalProps) {
  const [opts, setOpts] = useState<ExportOptions>({ ...DEFAULT_EXPORT_OPTIONS });

  const set = (key: keyof ExportOptions) => (val: boolean) =>
    setOpts(prev => ({ ...prev, [key]: val }));

  const formatLabel: Record<ExportFormat, string> = {
    csv: 'CSV Spreadsheet',
    pdf: 'PDF Statement',
    'bulk-pdf': 'Bulk PDF (All Parties)',
    'bulk-csv': 'Party List CSV',
  };

  const formatIcon: Record<ExportFormat, React.ReactNode> = {
    csv: <Table2 size={14} />,
    pdf: <FileText size={14} />,
    'bulk-pdf': <FileText size={14} />,
    'bulk-csv': <Table2 size={14} />,
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9998]"
        style={{ background: 'var(--rgba-black-55)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[9999] rounded-t-3xl flex flex-col"
        style={{
          background: 'var(--modal-sheet-bg)',
          border: '1px solid var(--glass-border)',
          borderBottom: 'none',
          maxHeight: '88vh',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background:  'var(--rgba-white-15)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <div>
            <h2 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>Export Options</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span style={{ color: 'var(--col-violet-95)' }}>{formatIcon[exportFormat]}</span>
              <span className="text-app-md font-semibold" style={{ color: 'var(--col-violet-85)' }}>
                {formatLabel[exportFormat]}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full active:scale-90 transition-all"
            style={{ background: 'var(--rgba-white-06)', color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable options */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">

          {/* ── Reference price fields (sensitive — off by default) ── */}
          {(partyRole === 'customer' || partyRole === 'mixed') && (
            <>
              <SectionHeader title="Customer Ledger — Reference Prices" />
              <OptionRow
                label='Include "Purchase Rate (Our Cost)"'
                sublabel="Shows your internal cost / purchase rate alongside each sale invoice"
                checked={opts.includePurchaseRateRef}
                onChange={set('includePurchaseRateRef')}
                accent="rose"
                badge="Private"
              />
            </>
          )}

          {(partyRole === 'supplier' || partyRole === 'mixed') && (
            <>
              <SectionHeader title="Supplier Ledger — Reference Prices" />
              <OptionRow
                label='Include "Sale Price (Market Rate)"'
                sublabel="Shows the sale/market rate alongside each purchase invoice"
                checked={opts.includeSalePriceRef}
                onChange={set('includeSalePriceRef')}
                accent="rose"
                badge="Private"
              />
            </>
          )}

          {/* ── Invoice detail fields ── */}
          <SectionHeader title="Invoice Details" icon={<FileText size={12} />} />
          <div className="space-y-1.5">
            <OptionRow
              label="Transport / Vehicle"
              sublabel="Vehicle number and freight charges on each invoice"
              checked={opts.includeTransport}
              onChange={set('includeTransport')}
              accent="blue"
            />
            <OptionRow
              label="Discount Amounts"
              sublabel="Order-level discounts applied to each invoice"
              checked={opts.includeDiscount}
              onChange={set('includeDiscount')}
              accent="amber"
            />
            <OptionRow
              label="GST Breakdown"
              sublabel="GST percentage and type per line item"
              checked={opts.includeGst}
              onChange={set('includeGst')}
              accent="violet"
            />
            <OptionRow
              label="Seller Invoice No."
              sublabel="Seller's / vendor's invoice reference (purchase bills)"
              checked={opts.includeSellerInvoiceNo}
              onChange={set('includeSellerInvoiceNo')}
              accent="amber"
            />
          </div>

          {/* ── Payment detail fields ── */}
          <SectionHeader title="Payment Details" />
          <div className="space-y-1.5">
            <OptionRow
              label="Payment Mode"
              sublabel="Cash, UPI, bank transfer, cheque, etc."
              checked={opts.includePaymentMode}
              onChange={set('includePaymentMode')}
              accent="green"
            />
            <OptionRow
              label="Collected / Paid By (Staff)"
              sublabel="Which staff member collected or made the payment"
              checked={opts.includeReceivedBy}
              onChange={set('includeReceivedBy')}
              accent="green"
            />
          </div>

          {/* ── Notes ── */}
          <SectionHeader title="Notes & Remarks" />
          <div className="space-y-1.5">
            <OptionRow
              label="Notes / Remarks"
              sublabel="Any notes attached to invoices or payments"
              checked={opts.includeNotes}
              onChange={set('includeNotes')}
              accent="violet"
            />
          </div>

          {/* ── Sections ── */}
          <SectionHeader title="Sections" />
          <div className="space-y-1.5">
            <OptionRow
              label="Opening Balance"
              sublabel="Pre-existing balance row at the top of the statement"
              checked={opts.includeOpeningBalance}
              onChange={set('includeOpeningBalance')}
              accent="blue"
            />
            <OptionRow
              label="Services / Misc Charges"
              sublabel="Non-invoice service charges or credits"
              checked={opts.includeMiscCharges}
              onChange={set('includeMiscCharges')}
              accent="blue"
            />
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 mt-4 px-3 py-2.5 rounded-xl"
            style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.12)' }}>
            <Info size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'rgba(96,165,250,0.6)' }} />
            <p className="text-app-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Options marked <span style={{ color: "var(--col-rose)" }}>Private</span> include internal pricing data. 
              Turn them on only for internal records — not for sharing with parties.
            </p>
          </div>
        </div>

        {/* Footer — Download button */}
        <div className="px-4 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--glass-border)', background: 'var(--modal-footer-bg)' }}>
          <button
            onClick={() => { if (!isLoading) onConfirm(opts); }}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl font-black text-sm active:scale-[0.98] transition-all disabled:opacity-60"
            style={{
              background: isLoading
                ? 'var(--col-violet-35)'
                : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              color: 'white',
              boxShadow: isLoading ? 'none' : '0 4px 20px rgba(124,58,237,0.4)',
            }}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                Generating…
              </>
            ) : (
              <>
                <Download size={16} />
                Download {formatLabel[exportFormat]}
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
