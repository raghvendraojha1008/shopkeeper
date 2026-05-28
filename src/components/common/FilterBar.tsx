import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { useDebounce } from '../../hooks/usePaginatedData';
import DateRangeFilter from './DateRangeFilter';

interface FilterBarProps {
  onSearch: (term: string) => void;
  onDateChange: (range: { start: string, end: string }) => void;
  searchTerm?: string;
  dateRange?: { start: string, end: string };
}

const FilterBar: React.FC<FilterBarProps> = ({ onSearch, onDateChange, searchTerm, dateRange }) => {
  const [val, setVal] = useState(searchTerm || '');
  const dbVal = useDebounce(val, 400);
  useEffect(() => { if (dbVal !== undefined) onSearch(dbVal); }, [dbVal, onSearch]);

  return (
    <div className="mb-4 space-y-2.5 no-print">
      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          className="w-full pl-10 pr-10 py-3 font-bold text-sm outline-none text-[rgba(226,232,240,0.88)] placeholder-slate-400"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
          }}
          placeholder="Search records..."
          value={val}
          onChange={e => setVal(e.target.value)}
        />
        {val && (
          <button onClick={() => setVal('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.08)' }}>
            <X size={12} style={{ color: 'rgba(148,163,184,0.5)' }} />
          </button>
        )}
      </div>

      <DateRangeFilter
        start={dateRange?.start || ''}
        end={dateRange?.end || ''}
        onStartChange={v => onDateChange && onDateChange({ ...dateRange!, start: v })}
        onEndChange={v => onDateChange && onDateChange({ ...dateRange!, end: v })}
      />
    </div>
  );
};

export default FilterBar;
