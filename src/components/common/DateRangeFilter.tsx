import React from 'react';
import { Calendar, X } from 'lucide-react';
import { useIsDark } from '../../hooks/useIsDark';

interface DateRangeFilterProps {
  start: string;
  end: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  className?: string;
  compact?: boolean;
}

function fmtDisplay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

const DatePicker: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  align?: 'left' | 'right';
  isDark: boolean;
}> = ({ value, onChange, placeholder = 'DD/MM/YYYY', align = 'left', isDark }) => (
  <div className="relative flex items-center flex-1 min-w-0 overflow-hidden">
    <span
      className="text-[11px] font-bold select-none pointer-events-none truncate w-full"
      style={{
        color: value
          ? (isDark ? 'rgba(203,213,225,0.9)' : '#334155')
          : (isDark ? 'rgba(148,163,184,0.4)' : '#94a3b8'),
        textAlign: align,
        display: 'block',
      }}
    >
      {value ? fmtDisplay(value) : placeholder}
    </span>
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      style={{ colorScheme: isDark ? 'dark' : 'light' }}
    />
    {value && (
      <button
        onPointerDown={e => { e.stopPropagation(); e.preventDefault(); onChange(''); }}
        className="relative z-10 flex-shrink-0 ml-1 rounded-full p-0.5"
        style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}
      >
        <X size={9} style={{ color: isDark ? 'rgba(148,163,184,0.5)' : '#64748b' }} />
      </button>
    )}
  </div>
);

const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  start, end, onStartChange, onEndChange, className = '',
}) => {
  const isDark = useIsDark();

  return (
    <div
      className={`date-range-filter flex items-center gap-2 px-3 py-2 rounded-[14px] ${className}`}
      style={{
        background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.95)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`,
        minHeight: 36,
      }}
    >
      <Calendar size={12} className="flex-shrink-0" style={{ color: isDark ? 'rgba(148,163,184,0.45)' : '#94a3b8' }} />

      <span className="text-[9px] font-black uppercase tracking-wide flex-shrink-0"
        style={{ color: isDark ? 'rgba(148,163,184,0.35)' : '#94a3b8' }}>From</span>

      <DatePicker value={start} onChange={onStartChange} align="left" isDark={isDark} />

      <div className="w-px self-stretch flex-shrink-0"
        style={{ background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }} />

      <span className="text-[9px] font-black uppercase tracking-wide flex-shrink-0"
        style={{ color: isDark ? 'rgba(148,163,184,0.35)' : '#94a3b8' }}>To</span>

      <DatePicker value={end} onChange={onEndChange} align="right" isDark={isDark} />
    </div>
  );
};

export default DateRangeFilter;
