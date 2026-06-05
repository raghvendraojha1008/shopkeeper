/**
 * ExportFormatModal — Bottom sheet asking PDF or Excel/CSV
 * Used by all detail views and list export buttons
 */

import React from 'react';
import { X, FileText, Sheet } from 'lucide-react';
import { useBackHandler } from '../../services/useBackHandler';

interface ExportFormatModalProps {
  onSelect : (format: 'pdf' | 'excel') => void;
  onClose  : () => void;
  title?   : string;
}

const ExportFormatModal: React.FC<ExportFormatModalProps> = ({
  onSelect, onClose, title = 'Export Format',
}) => {
  // Android back button dismisses the bottom sheet
  useBackHandler(onClose, true);
  return (
  <div
    className="fixed inset-0 z-[200] flex items-end justify-center"
    style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)' }}
    onClick={onClose}>

    <div
      className="w-full max-w-sm mx-3 rounded-[28px] p-5 space-y-4"
      style={{
        marginBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
        background    : 'rgba(12,16,40,0.98)',
        border        : '1px solid rgba(255,255,255,0.12)',
        boxShadow     : '0 32px 80px rgba(0,0,0,0.8)',
        animation     : 'slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
      }}
      onClick={e => e.stopPropagation()}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-base font-black text-white">{title}</p>
        <button onClick={onClose}
          className="p-2 rounded-xl active:scale-90 transition-all"
          style={{ background: 'rgba(255,255,255,0.07)' }}>
          <X size={13} style={{ color: 'rgba(148,163,184,0.6)' }} />
        </button>
      </div>

      <p className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>
        Choose export format — PDF is print-ready, Excel/CSV works with spreadsheets.
      </p>

      {/* Options */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onSelect('pdf')}
          className="flex flex-col items-center gap-3 p-5 rounded-[20px] active:scale-[0.97] transition-all"
          style={{
            background : 'rgba(239,68,68,0.1)',
            border     : '1px solid rgba(239,68,68,0.25)',
          }}>
          <div className="p-3 rounded-[16px]"
            style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <FileText size={24} style={{ color: '#f87171' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-black text-white">PDF</p>
            <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.45)' }}>Print-ready · Shareable</p>
          </div>
        </button>

        <button
          onClick={() => onSelect('excel')}
          className="flex flex-col items-center gap-3 p-5 rounded-[20px] active:scale-[0.97] transition-all"
          style={{
            background : 'rgba(16,185,129,0.09)',
            border     : '1px solid rgba(16,185,129,0.22)',
          }}>
          <div className="p-3 rounded-[16px]"
            style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.3)' }}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none"
              stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18M9 21V9"/>
              <path d="m6 12 3 3-3 3M15 12h3M15 15h3M15 18h3"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-black text-white">Excel / CSV</p>
            <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.45)' }}>Spreadsheet · Data</p>
          </div>
        </button>
      </div>
    </div>

    <style>{`
      @keyframes slideUp {
        from { opacity:0; transform:translateY(24px) }
        to   { opacity:1; transform:translateY(0)    }
      }
    `}</style>
  </div>
  );
};

export default ExportFormatModal;






