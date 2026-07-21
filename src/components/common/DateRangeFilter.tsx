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
      className="text-app-md font-bold select-none pointer-events-none truncate w-full"
      style={{
        color: value
          ? (isDark ? 'var(--text-secondary)' : "var(--col-slate-700)")
          : (isDark ? 'var(--text-muted)' : "var(--col-slate)"),
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
        style={{ background: isDark ? 'var(--rgba-white-08)' : 'var(--rgba-black-08)' }}
      >
        <X size={9} style={{ color: isDark ? 'var(--text-muted)' : "var(--col-slate-500)" }} />
      </button>
    )}
  </div>
);

const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  start, end, onStartChange, onEndChange, className = '', compact = false,
}) => {
  const isDark = useIsDark();

  return (
    <div
      className={`date-range-filter flex items-center gap-2 rounded-[14px] ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} ${className}`}
      style={{
        background: isDark ? 'var(--rgba-white-06)' :  'var(--rgba-white-95)',
        border: `1px solid ${isDark ?   'var(--rgba-white-10)' : 'var(--rgba-black-12)'}`,
        minHeight: compact ? 32 : 36,
      }}
    >
      <Calendar size={compact ? 11 : 12} className="flex-shrink-0" style={{ color: isDark ? 'var(--text-muted)' : "var(--col-slate)" }} />

      {!compact && (
        <span className="text-app-xs font-black uppercase tracking-wide flex-shrink-0"
          style={{ color: isDark ? 'var(--text-muted)' : "var(--col-slate)" }}>From</span>
      )}

      <DatePicker value={start} onChange={onStartChange} align="left" isDark={isDark} />

      <div className="w-px self-stretch flex-shrink-0"
        style={{ background: isDark ?   'var(--rgba-white-10)' : 'var(--rgba-black-15)' }} />

      {!compact && (
        <span className="text-app-xs font-black uppercase tracking-wide flex-shrink-0"
          style={{ color: isDark ? 'var(--text-muted)' : "var(--col-slate)" }}>To</span>
      )}

      <DatePicker value={end} onChange={onEndChange} align="right" isDark={isDark} />
    </div>
  );
};

export default DateRangeFilter;
