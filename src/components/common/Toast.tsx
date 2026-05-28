import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';
interface ToastProps {
  id: string; message: string; type: ToastType;
  onClose: (id: string) => void;
  actionLabel?: string; onAction?: () => void;
}

const Toast: React.FC<ToastProps> = ({ id, message, type, onClose, actionLabel, onAction }) => {
  useEffect(() => {
    const timer = setTimeout(() => onClose(id), actionLabel ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [id, onClose, actionLabel]);

  const cfg = {
    success: { grad: 'linear-gradient(135deg,rgba(5,150,105,0.92),rgba(6,95,70,0.88))', bdr: 'rgba(16,185,129,0.6)', ic: '#ecfdf5', txt: '#ecfdf5', ibg: 'rgba(255,255,255,0.18)', btn: 'linear-gradient(135deg,#10b981,#059669)', glow: 'rgba(16,185,129,0.4)' },
    error:   { grad: 'linear-gradient(135deg,rgba(220,38,38,0.92),rgba(153,27,27,0.88))',   bdr: 'rgba(239,68,68,0.6)',   ic: '#fef2f2', txt: '#fef2f2', ibg: 'rgba(255,255,255,0.18)', btn: 'linear-gradient(135deg,#ef4444,#dc2626)', glow: 'rgba(239,68,68,0.4)'   },
    info:    { grad: 'linear-gradient(135deg,rgba(79,70,229,0.92),rgba(55,48,163,0.88))',    bdr: 'rgba(99,102,241,0.6)',  ic: '#eef2ff', txt: '#eef2ff', ibg: 'rgba(255,255,255,0.18)', btn: 'linear-gradient(135deg,#6366f1,#4f46e5)', glow: 'rgba(99,102,241,0.4)'  },
  }[type];
  const Icon = { success: CheckCircle, error: AlertCircle, info: Info }[type];

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:10, padding:'11px 14px',
      borderRadius:20, width:'100%', maxWidth:'100%', boxSizing:'border-box',
      background: cfg.grad, border:`1.5px solid ${cfg.bdr}`,
      backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)',
      boxShadow:`0 8px 32px ${cfg.glow}, 0 2px 6px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15)`,
      animation:'toastIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <div style={{flexShrink:0,padding:5,borderRadius:10,background:cfg.ibg}}>
        <Icon size={15} style={{color:cfg.ic,display:'block'}} />
      </div>
      <span style={{flex:1,fontSize:13,fontWeight:700,color:cfg.txt,lineHeight:1.4}}>{message}</span>
      {actionLabel && onAction && (
        <button onClick={()=>{onAction();onClose(id);}}
          style={{padding:'4px 10px',borderRadius:12,fontSize:10,fontWeight:900,
            background:cfg.btn,color:'white',border:'none',cursor:'pointer',
            boxShadow:`0 2px 8px ${cfg.glow}`,textTransform:'uppercase',letterSpacing:'0.06em',flexShrink:0}}>
          {actionLabel}
        </button>
      )}
      <button onClick={()=>onClose(id)} style={{opacity:0.75,border:'none',background:'none',cursor:'pointer',padding:2,flexShrink:0}}>
        <X size={14} style={{color:cfg.ic,display:'block'}} />
      </button>
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateY(-14px) scale(0.88)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>
    </div>
  );
};
export default Toast;
