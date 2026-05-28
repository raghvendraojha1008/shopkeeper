/**
 * GSTR1ExportModal
 * ─────────────────────────────────────────────────────────────
 * Bottom-sheet modal for GSTR-1 month-wise export.
 * Shows:
 *  • Month picker (rolling 12 months)
 *  • Live summary (invoice count, tax totals) before export
 *  • Format selector: JSON (GST Portal upload) / Excel / CSV
 *  • Info tooltip explaining the upload process
 */

import React, { useState, useMemo } from 'react';
import {
  X, FileJson, FileSpreadsheet, FileText,
  Info, CheckCircle2, AlertCircle, Download, Loader2,
  Building2, Receipt, TrendingUp, ChevronRight,
} from 'lucide-react';
import { exportGSTR1, getGSTR1Summary } from '../../services/gstr1ExportService';
import { fmtINR } from '../../utils/gstUtils';

interface GSTR1ExportModalProps {
  ledgerEntries : any[];
  parties?      : any[];
  settings      : any;
  onClose       : () => void;
  onToast       : (msg: string, type: 'success' | 'error' | 'info') => void;
}

type ExportFormat = 'json' | 'excel' | 'csv';

// ── Helpers ──────────────────────────────────────────────────────────────────

function last12Months(): { value: string; label: string }[] {
  const now    = new Date();
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const lb = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    months.push({ value: `${y}-${m}`, label: lb });
  }
  return months;
}

const FORMAT_OPTIONS: { id: ExportFormat; label: string; sub: string; icon: React.ReactNode; color: string; bg: string; border: string }[] = [
  {
    id: 'json', label: 'JSON', sub: 'Upload to GST Portal',
    icon: <FileJson size={20} />,
    color: '#34d399', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.25)',
  },
  {
    id: 'excel', label: 'Excel (.xlsx)', sub: 'Multi-sheet workbook',
    icon: <FileSpreadsheet size={20} />,
    color: '#60a5fa', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.25)',
  },
  {
    id: 'csv', label: 'CSV', sub: 'For spreadsheet apps',
    icon: <FileText size={20} />,
    color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)',
  },
];

// ─────────────────────────────────────────────────────────────────────────────

const GSTR1ExportModal: React.FC<GSTR1ExportModalProps> = ({
  ledgerEntries, parties = [], settings, onClose, onToast,
}) => {
  const months = useMemo(last12Months, []);
  const [selectedMonth,  setSelectedMonth]  = useState(months[0].value);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('json');
  const [exporting,      setExporting]      = useState(false);
  const [showInfo,       setShowInfo]       = useState(false);

  const sellerGstin = settings?.profile?.gstin || '';
  const hasGstin    = sellerGstin.length === 15;

  const summary = useMemo(
    () => getGSTR1Summary(ledgerEntries, settings, selectedMonth, parties),
    [ledgerEntries, parties, settings, selectedMonth],
  );

  const handleExport = async () => {
    if (!hasGstin) {
      onToast('Please configure your GSTIN in Settings → Firm Profile', 'error');
      return;
    }
    if (!summary) {
      onToast(`No sales invoices found for ${months.find(m => m.value === selectedMonth)?.label}`, 'error');
      return;
    }
    setExporting(true);
    try {
      await exportGSTR1({
        ledgerEntries,
        parties,
        settings,
        month : selectedMonth,
        format: selectedFormat,
      });
      onToast(`GSTR-1 ${selectedFormat.toUpperCase()} exported successfully!`, 'success');
      onClose();
    } catch (e: any) {
      onToast(e.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ background: '#0f1221', border: '1px solid rgba(255,255,255,0.1)', borderBottom: 'none', maxHeight: '92vh', overflowY: 'auto' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <Receipt size={18} style={{ color: '#34d399' }} />
            </div>
            <div>
              <h2 className="font-black text-white text-base leading-none">GSTR-1 Export</h2>
              <p className="text-[10px] mt-0.5" style={{ color: 'rgba(148,163,184,0.6)' }}>Monthly GST Return · Outward Supplies</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-8 space-y-5">

          {/* GSTIN Status */}
          <div
            className="flex items-center gap-3 p-3 rounded-xl"
            style={{ background: hasGstin ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${hasGstin ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }}
          >
            {hasGstin
              ? <CheckCircle2 size={16} style={{ color: '#34d399', flexShrink: 0 }} />
              : <AlertCircle  size={16} style={{ color: '#f87171', flexShrink: 0 }} />}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold" style={{ color: hasGstin ? '#34d399' : '#f87171' }}>
                {hasGstin ? 'GSTIN Configured' : 'GSTIN Missing'}
              </p>
              <p className="text-[10px] truncate" style={{ color: 'rgba(148,163,184,0.6)' }}>
                {hasGstin ? sellerGstin : 'Settings → Firm Profile → GSTIN'}
              </p>
            </div>
            {hasGstin && <Building2 size={14} style={{ color: 'rgba(52,211,153,0.5)', flexShrink: 0 }} />}
          </div>

          {/* Month Selector */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider mb-2 block" style={{ color: 'rgba(148,163,184,0.5)' }}>
              Select Month
            </label>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="w-full p-3 rounded-xl text-sm font-bold outline-none appearance-none cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(240,244,255,0.9)' }}
            >
              {months.map(m => (
                <option key={m.value} value={m.value} style={{ background: '#0f1221' }}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Live Summary */}
          {summary ? (
            <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.18)' }}>
              <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(139,92,246,0.05)' }}>
                <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: 'rgba(167,139,250,0.8)' }}>
                  {summary.monthLabel} — Preview
                </p>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)' }}>
                  FY {summary.financialYear}
                </span>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                {[
                  { label: 'Total Invoices',  value: String(summary.totalInvoices), sub: `B2B: ${summary.b2bCount} · B2C: ${summary.b2cCount}` },
                  { label: 'Taxable Value',    value: fmtINR(summary.totalTaxable), sub: 'Excl. GST' },
                  { label: 'Total GST',        value: fmtINR(summary.totalGst),     sub: `CGST ${fmtINR(summary.totalCgst)} + SGST ${fmtINR(summary.totalSgst)}` },
                  { label: 'Grand Total',      value: fmtINR(summary.grandTotal),   sub: 'Incl. GST' },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(148,163,184,0.5)' }}>{label}</p>
                    <p className="text-sm font-black text-white leading-none">{value}</p>
                    <p className="text-[9px] mt-1" style={{ color: 'rgba(148,163,184,0.4)' }}>{sub}</p>
                  </div>
                ))}
              </div>
              {summary.totalIgst > 0 && (
                <div className="px-4 pb-3">
                  <div className="p-2.5 rounded-lg flex items-center gap-2" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
                    <TrendingUp size={12} style={{ color: '#60a5fa' }} />
                    <p className="text-[10px] font-bold" style={{ color: '#60a5fa' }}>
                      IGST {fmtINR(summary.totalIgst)} — includes inter-state transactions
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-xs font-bold text-slate-400">No sales invoices for this month</p>
              <p className="text-[10px] mt-1" style={{ color: 'rgba(148,163,184,0.35)' }}>Only SELL type ledger entries with GST are included</p>
            </div>
          )}

          {/* Format Selector */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider mb-2 block" style={{ color: 'rgba(148,163,184,0.5)' }}>
              Export Format
            </label>
            <div className="space-y-2">
              {FORMAT_OPTIONS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setSelectedFormat(f.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-98"
                  style={{
                    background: selectedFormat === f.id ? f.bg : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${selectedFormat === f.id ? f.border : 'rgba(255,255,255,0.07)'}`,
                  }}
                >
                  <span style={{ color: f.color }}>{f.icon}</span>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-black" style={{ color: selectedFormat === f.id ? f.color : 'rgba(240,244,255,0.8)' }}>{f.label}</p>
                    <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.5)' }}>{f.sub}</p>
                  </div>
                  {selectedFormat === f.id && <CheckCircle2 size={16} style={{ color: f.color, flexShrink: 0 }} />}
                </button>
              ))}
            </div>
          </div>

          {/* Info Box */}
          {selectedFormat === 'json' && (
            <div>
              <button
                onClick={() => setShowInfo(v => !v)}
                className="flex items-center gap-2 text-[10px] font-bold mb-2"
                style={{ color: 'rgba(96,165,250,0.8)' }}
              >
                <Info size={12} /> How to upload to GST Portal
                <ChevronRight size={12} style={{ transform: showInfo ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
              </button>
              {showInfo && (
                <div className="p-3 rounded-xl space-y-1.5" style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.15)' }}>
                  {[
                    '1. Download the JSON file below',
                    '2. Go to gst.gov.in → Login → Returns',
                    '3. Select GSTR-1 → Choose the period',
                    '4. Click "Upload JSON" → Select the downloaded file',
                    '5. Review tables, validate, then Submit/File',
                    '⚠ Always preview before filing — check HSN codes are filled in your items',
                  ].map((s, i) => (
                    <p key={i} className="text-[10px]" style={{ color: i === 5 ? '#fbbf24' : 'rgba(148,163,184,0.7)' }}>{s}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Export Button */}
          <button
            onClick={handleExport}
            disabled={exporting || !hasGstin || !summary}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-sm transition-all active:scale-98"
            style={{
              background: (!hasGstin || !summary) ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,rgba(16,185,129,0.85),rgba(5,150,105,0.8))',
              color: (!hasGstin || !summary) ? 'rgba(148,163,184,0.4)' : 'white',
              border: '1px solid rgba(255,255,255,0.1)',
              cursor: (!hasGstin || !summary) ? 'not-allowed' : 'pointer',
            }}
          >
            {exporting
              ? <><Loader2 size={18} className="animate-spin" /> Generating...</>
              : <><Download size={18} /> Export GSTR-1 {selectedFormat.toUpperCase()}</>}
          </button>

        </div>
      </div>
    </div>
  );
};

export default GSTR1ExportModal;
