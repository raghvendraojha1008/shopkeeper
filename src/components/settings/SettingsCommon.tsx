import React from 'react';
import { Loader2 } from 'lucide-react';

export const SettingsSection = ({ title, icon: Icon, children, className = '' }: any) => (
  <div className={`rounded-2xl p-5 border border-white/10 ${className}`}>
    <div className="flex items-center gap-2 mb-4 font-bold text-xs uppercase tracking-wider text-[rgba(148,163,184,0.45)]">
      {Icon && <Icon size={14} />} {title}
    </div>
    <div className="space-y-4">
      {children}
    </div>
  </div>
);

export const SettingInput = ({ label, value, onChange, placeholder, type = "text", disabled = false, icon: Icon }: any) => (
    <div className="relative group">
        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block ml-1">{label}</label>
        <div className="relative">
            {Icon && <div className="absolute left-3 top-3 text-[rgba(148,163,184,0.45)]"><Icon size={16}/></div>}
            <input 
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                className={`w-full  border border-white/12 rounded-xl py-3 ${Icon ? 'pl-10' : 'pl-4'} pr-4 text-sm font-bold text-[rgba(226,232,240,0.88)] outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50`}
            />
        </div>
    </div>
);

export const LoadingButton = ({ loading, onClick, icon: Icon, label, className = '', style }: any) => (
    <button 
        onClick={onClick} 
        disabled={loading}
        style={style}
        className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed ${className}`}
    >
        {loading ? <Loader2 size={18} className="animate-spin"/> : (Icon && <Icon size={18}/>)}
        {label}
    </button>
);






