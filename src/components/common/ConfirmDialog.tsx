import React from 'react';
import { AlertTriangle, Trash2, CheckCircle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'info';
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen, title, message, onConfirm, onCancel,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'danger'
}) => {
  if (!isOpen) return null;
  const isDanger = variant === 'danger';

  return (
    <div className="confirm-dialog-root fixed inset-0 z-[200] flex items-end justify-center"
      style={{ background: 'var(--rgba-black-70)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        animation: 'fadeIn 0.2s ease', paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))', paddingLeft: 16, paddingRight: 16 }}>
      <div className="confirm-dialog-card w-full max-w-sm rounded-[28px] overflow-hidden relative"
        style={{
          background: 'var(--modal-bg)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          boxShadow: '0 24px 64px var(--rgba-black-70), 0 8px 24px var(--rgba-black-40)',
          border: `1px solid ${isDanger ? 'var(--col-danger-25)' : 'var(--col-accent-25)'}`,
          animation: 'slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        }}>
        {/* Sheen */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{background:`linear-gradient(90deg, transparent, ${isDanger ? 'var(--col-danger-40)' : 'var(--col-violet-40)'}, transparent)`}} />
        {/* Top accent bar */}
        <div style={{height:3, background: isDanger ? 'linear-gradient(90deg,#ef4444,#f97316)' : 'linear-gradient(90deg,#7c3aed,#4f46e5)'}} />
        
        <div className="p-6">
          {/* Icon */}
          <div className="w-14 h-14 rounded-[22px] flex items-center justify-center mb-4 relative"
            style={{background: isDanger ? 'var(--col-danger-12)' : 'var(--col-accent-12)', border: `1px solid ${isDanger ? 'var(--col-danger-25)' : 'var(--col-accent-25)'}`}}>
            <div className="absolute inset-0 rounded-[22px]" style={{background:`radial-gradient(circle at 50% 0%, ${isDanger ? 'var(--col-danger-15)' : 'var(--col-violet-15)'}, transparent 70%)`}} />
            {isDanger
              ? <Trash2 size={26} style={{color:"var(--col-danger)"}} />
              : <CheckCircle size={26} style={{color:"var(--col-violet)"}} />}
          </div>

          <h2 className="font-black mb-2" style={{fontSize:20, letterSpacing:'-0.03em', color: 'var(--text-primary)'}}>{title}</h2>
          <p className="text-sm leading-relaxed mb-6" style={{fontWeight:500, color: 'var(--text-muted)'}}>{message}</p>

          <div className="flex gap-3">
            <button onClick={onCancel}
              className="flex-1 py-3.5 rounded-[18px] font-bold text-sm active:scale-95 transition-all"
              style={{background:'var(--rgba-white-06)', color: 'var(--text-muted)', border:'1px solid var(--glass-border)'}}>
              {cancelLabel}
            </button>
            <button onClick={onConfirm}
              className="flex-1 py-3.5 rounded-[18px] font-black text-sm text-white active:scale-95 transition-all"
              style={{
                background: isDanger ? 'linear-gradient(135deg,#ef4444,#dc2626)' : 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                boxShadow: isDanger ? '0 6px 18px var(--col-danger-40)' : '0 6px 18px rgba(124,58,237,0.45)',
                border: 'none',
              }}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{opacity:0;transform:translateY(24px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}
      `}</style>
    </div>
  );
};
export default ConfirmDialog;







