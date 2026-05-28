import React from 'react';
import { Package, Plus } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
    {/* Icon */}
    <div className="w-20 h-20 rounded-[28px] flex items-center justify-center mb-5 relative"
      style={{
        background: 'rgba(139,92,246,0.12)',
        border: '1px solid rgba(139,92,246,0.2)',
        boxShadow: '0 8px 32px rgba(139,92,246,0.15)',
      }}>
      <div className="absolute inset-0 rounded-[28px]" style={{background:'radial-gradient(circle at 50% 0%, rgba(167,139,250,0.2), transparent 70%)'}} />
      {icon || <Package size={34} style={{color:'rgba(167,139,250,0.7)'}} strokeWidth={1.5} />}
    </div>

    <h3 className="font-black mb-2"
      style={{fontSize:17, letterSpacing:'-0.025em', color:'rgba(240,244,255,0.85)'}}>
      {title}
    </h3>
    {description && (
      <p className="text-sm font-medium mb-6 max-w-xs leading-relaxed"
        style={{color:'rgba(148,163,184,0.55)'}}>
        {description}
      </p>
    )}
    {action && (
      <button onClick={action.onClick}
        className="px-6 py-3 rounded-[16px] font-black text-white text-sm flex items-center gap-2 active:scale-95 transition-all"
        style={{
          background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
          boxShadow: '0 6px 20px rgba(124,58,237,0.45)',
          border: '1px solid rgba(167,139,250,0.3)',
        }}>
        <Plus size={16} />
        {action.label}
      </button>
    )}
  </div>
);
export default EmptyState;







