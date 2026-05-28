import React, { useState, useMemo, useRef } from 'react';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { User } from 'firebase/auth';
import {
  Search, Wallet, Edit2, Trash2, Download, Plus,
  Filter, TrendingDown, Check, ChevronDown, ArrowLeft
} from 'lucide-react';
import DateRangeFilter from '../common/DateRangeFilter';
import { getDefaultDateRange } from '../../utils/filterPeriod';
import { TrashService } from '../../services/trash';
import { exportService } from '../../services/export';
import { fmtINR } from '../../utils/gstUtils';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { useSoftDelete } from '../common/UndoSnackbar';
import ExportFormatModal from '../common/ExportFormatModal';
import ExpenseDetailView from './ExpenseDetailView';
import { parseDateSafe, toDateStrSafe } from '../../utils/dateUtils';

function parseRecordDate(raw: any): Date {
  return parseDateSafe(raw);
}

function toDateString(raw: any): string {
  return toDateStrSafe(raw);
}

interface ExpensesViewProps {
  user: User;
  appSettings?: any;
  onAdd: () => void;
  onEdit: (item: any) => void;
  onBack?: () => void;
}

const ExpensesView: React.FC<ExpensesViewProps> = ({ user, appSettings, onAdd, onEdit, onBack }) => {
  const { confirm, showToast } = useUI();
  const { useExpenses } = useData();
  const scrollRef = useScrollMemory('expenses');

  // PERF: use shared TanStack Query cache — eliminates direct Firestore read on every mount
  const { data: expenses, isLoading: loading, setData } = useExpenses(user.uid);

  const [selectedExpense, setSelectedExpense] = useState<any | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateRange, setDateRange] = useState(() => getDefaultDateRange(appSettings));
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCategoryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { scheduleDelete } = useSoftDelete();

  const handleDelete = (id: string) => {
    const item = expenses.find(e => e.id === id);
    if (!item) return;
    scheduleDelete({
      id,
      collection: 'expenses',
      itemName: item.category || 'Expense',
      onOptimistic: () => setData(p => p.filter(i => i.id !== id)),
      onRestore: () => setData(p => [...p, item].sort((a, b) => parseRecordDate(b.date).getTime() - parseRecordDate(a.date).getTime())),
      onCommit: async () => { await TrashService.moveToTrash(user.uid, 'expenses', id); },
    });
  };

  const availableCategories = useMemo(() => {
    const settingsCats = appSettings?.custom_lists?.expense_types || [];
    const dataCats = expenses.map(e => e.category).filter(Boolean);
    return Array.from(new Set(['all', ...settingsCats, ...dataCats])).sort();
  }, [appSettings, expenses]);

  const filtered = useMemo(() => {
    return expenses.filter(e => {
      const matchesSearch =
        e.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.notes?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === 'all' ? true : e.category === categoryFilter;
      // FIX: use toDateString (parseRecordDate) so Timestamp objects are handled correctly.
      const recordDate = toDateString(e.date);
      const matchesDate = (!dateRange.start || recordDate >= dateRange.start) && (!dateRange.end || recordDate <= dateRange.end);
      return matchesSearch && matchesCategory && matchesDate;
    });
  }, [expenses, searchTerm, categoryFilter, dateRange]);

  const totalAmount = useMemo(() => filtered.reduce((sum, item) => sum + (Number(item.amount) || 0), 0), [filtered]);

  const handleExportFormat = async (format: 'pdf' | 'excel') => {
    setShowExportModal(false);
    if (filtered.length === 0) return showToast('No data to export', 'error');

    if (format === 'excel') {
      const rows: string[][] = [
        [appSettings?.profile?.firm_name || 'Business', '', '', ''],
        ['EXPENSES REPORT', '', '', ''],
        ['Period:', `${dateRange.start} to ${dateRange.end}`, '', ''],
        [],
        ['Date', 'Category', 'Amount', 'Paid By', 'Mode', 'Notes'],
        ...filtered.map(e => [
          toDateString(e.date), e.category || '-', String(e.amount || 0),
          e.paid_by || '-', e.payment_mode || 'Cash', e.notes || '-',
        ]),
        [],
        ['TOTAL', '', String(totalAmount.toFixed(2)), '', '', ''],
      ] as any[];
      const csv = rows.map((r: any[]) => r.map((v: any) => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      await exportService.shareOrDownload(csv, `Expenses_${dateRange.start}_to_${dateRange.end}.csv`, 'text/csv');
      showToast('Excel Downloaded', 'success');
    } else {
      try {
        const { jsPDF } = await import('jspdf');
        const atMod = await import('jspdf-autotable');
        const autoTable = (atMod as any).default || atMod;
        const doc = new jsPDF();
        const PW = doc.internal.pageSize.width;
        const m = 14;

        doc.setFillColor(30, 40, 80); doc.rect(0, 0, PW, 22, 'F');
        doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
        doc.text('EXPENSES REPORT', PW / 2, 14, { align: 'center' });

        doc.setTextColor(30, 40, 60); doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text(appSettings?.profile?.firm_name || 'Business', m, 32);
        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
        doc.text(`Period: ${dateRange.start} to ${dateRange.end}`, m, 39);
        doc.text(`Total: ${fmtINR(totalAmount, 'Rs.')}`, PW - m, 39, { align: 'right' });

        autoTable(doc, {
          startY: 44, margin: { left: m, right: m },
          head: [['Date', 'Category', 'Description', 'Paid By', 'Mode', 'Amount']],
          body: filtered.map(e => [
            toDateString(e.date), e.category || '-', e.notes || '-',
            e.paid_by || '-', e.payment_mode || 'Cash',
            fmtINR(Number(e.amount || 0), 'Rs.'),
          ]),
          headStyles: { fillColor: [239, 68, 68], fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 7.5 },
          columnStyles: { 5: { halign: 'right', fontStyle: 'bold' } },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          foot: [[' ', ' ', ' ', ' ', 'Total:', fmtINR(totalAmount, 'Rs.')]],
          footStyles: { fillColor: [240, 240, 250], fontStyle: 'bold', fontSize: 8 },
        });

        const b64 = doc.output('datauristring').split(',')[1];
        await exportService.saveBase64File(b64, `Expenses_${dateRange.start}_to_${dateRange.end}.pdf`);
        showToast('PDF Downloaded', 'success');
      } catch (e: any) { console.error('Export error:', e); showToast('Export failed: ' + (e?.message || 'Unknown'), 'error'); }
    }
  };

  if (selectedExpense) {
    return (
      <ExpenseDetailView
        expense={selectedExpense}
        settings={appSettings || {}}
        onBack={() => setSelectedExpense(null)}
        onEdit={(item) => { setSelectedExpense(null); onEdit(item); }}
      />
    );
  }

  const CAT_COLORS: Record<string, string> = {
    fuel: '#fbbf24', salary: '#818cf8', utilities: '#60a5fa',
    rent: '#34d399', repair: '#f87171', food: '#fb923c',
    transport: '#a78bfa', marketing: '#e879f9', default: '#94a3b8',
  };

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--app-bg)' }}>
      {showExportModal && (
        <ExportFormatModal onSelect={handleExportFormat} onClose={() => setShowExportModal(false)} />
      )}

      {/* STICKY HEADER */}
      <div className="sticky top-0 z-30 px-4 pb-2 md:px-6 flex-shrink-0" style={{ paddingTop: '16px', background: 'rgba(var(--app-bg-rgb),0.92)', backdropFilter: 'blur(20px)' }}>
        <div className="flex justify-between items-center mb-4 relative z-20">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="p-1.5 rounded-full transition-colors text-[rgba(148,163,184,0.6)] hover:bg-[rgba(255,255,255,0.08)]">
                <ArrowLeft size={18} />
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[rgba(240,244,255,0.95)]">Expenses</h1>
            </div>
          </div>

          <div className="flex gap-1.5 relative" ref={dropdownRef}>
            <button
              onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
              className={`p-2 rounded-xl shadow-sm border active:scale-95 transition-all flex items-center gap-2 ${categoryFilter !== 'all' ? 'bg-[rgba(139,92,246,0.25)] text-violet-300 border-[rgba(139,92,246,0.3)]' : 'bg-[rgba(255,255,255,0.06)] text-[rgba(148,163,184,0.45)] border-[rgba(255,255,255,0.08)]'}`}
            >
              <Filter size={18} />
              {categoryFilter !== 'all' && <span className="text-xs font-bold max-w-[60px] truncate">{categoryFilter}</span>}
              <ChevronDown size={14} />
            </button>

            {showCategoryDropdown && (
              <div className="absolute top-12 right-0 w-48 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100" style={{ background: 'rgba(12,16,40,0.98)' }}>
                <div className="max-h-60 overflow-y-auto p-1">
                  {availableCategories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => { setCategoryFilter(cat); setShowCategoryDropdown(false); }}
                      className={`w-full text-left px-3 py-2.5 text-xs font-bold rounded-lg flex items-center justify-between ${categoryFilter === cat ? 'bg-[rgba(59,130,246,0.15)] text-blue-400' : 'text-[rgba(203,213,225,0.7)] hover:bg-[rgba(255,255,255,0.08)]'}`}
                    >
                      {cat === 'all' ? 'All Categories' : cat}
                      {categoryFilter === cat && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => setShowExportModal(true)} className="p-2 text-[#60a5fa] rounded-xl active:scale-95 border border-[rgba(59,130,246,0.2)] bg-[rgba(59,130,246,0.1)] transition-all">
              <Download size={18} />
            </button>
            <button onClick={onAdd} className="text-white p-2 rounded-xl shadow-lg active:scale-95 bg-gradient-to-r from-[#4f46e5] to-[#7c3aed] transition-all">
              <Plus size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* SCROLLABLE CONTENT */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* SUMMARY CARD */}
        <div className="p-4 rounded-3xl shadow-xl mb-4 flex justify-between items-center relative overflow-hidden border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.1)]">
          <div className="relative z-10">
            <div className="text-[10px] font-bold opacity-70 uppercase mb-0.5">Total Expense</div>
            <div className="text-2xl font-black">₹{totalAmount.toLocaleString('en-IN')}</div>
            <div className="text-[10px] font-bold opacity-50 mt-1">{filtered.length} Records</div>
          </div>
          <div className="bg-[rgba(255,255,255,0.06)]/10 p-2.5 rounded-full relative z-10">
            <TrendingDown size={24} className="text-white" />
          </div>
          <TrendingDown size={80} className="absolute -bottom-4 -right-4 text-white opacity-5 pointer-events-none" />
        </div>

        {/* SEARCH & DATE FILTER */}
        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
            <input
              className="w-full pl-9 pr-3 p-2 border border-white/12 rounded-xl text-xs font-bold outline-none"
              style={{ background: 'rgba(255,255,255,0.06)' }}
              placeholder="Search..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <DateRangeFilter
            start={dateRange.start}
            end={dateRange.end}
            onStartChange={v => setDateRange(r => ({ ...r, start: v }))}
            onEndChange={v => setDateRange(r => ({ ...r, end: v }))}
            className="w-full"
          />
        </div>

        {/* LIST */}
        <div className="pb-20 space-y-2">
          {loading ? (
            <div className="text-center py-10 text-[rgba(148,163,184,0.45)]">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <TrendingDown size={28} style={{ color: 'rgba(239,68,68,0.6)' }} />
              </div>
              <p className="text-sm font-black text-white mb-1">
                {searchTerm || categoryFilter !== 'all' ? 'No matching expenses' : 'No expenses yet'}
              </p>
              <p className="text-[11px] mb-5" style={{ color: 'rgba(148,163,184,0.5)' }}>
                {searchTerm || categoryFilter !== 'all'
                  ? 'Try a different search or clear the filter'
                  : 'Track rent, salaries, utilities and other business costs'}
              </p>
              {!searchTerm && categoryFilter === 'all' && (
                <button onClick={onAdd}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-[12px] font-black text-white active:scale-95 transition-all"
                  style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)', boxShadow: '0 6px 20px rgba(239,68,68,0.3)' }}>
                  <Plus size={14} /> Add First Expense
                </button>
              )}
            </div>
          ) : filtered.map(e => {
              const catKey = (e.category || '').toLowerCase();
              const accentColor = CAT_COLORS[catKey] || CAT_COLORS.default;
              return (
                <div
                  key={e.id}
                  onClick={() => setSelectedExpense(e)}
                  className="p-3 rounded-3xl border border-white/10 bg-[rgba(255,255,255,0.04)] flex justify-between items-center group overflow-hidden transition-all active:scale-[0.97] cursor-pointer relative"
                  style={{ borderLeft: `3px solid ${accentColor}40` }}
                >
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r-full" style={{ background: accentColor }} />
                  <div className="min-w-0 flex-1 overflow-hidden pl-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-[rgba(148,163,184,0.45)]">
                        {toDateString(e.date)}
                      </span>
                      {e.payment_mode && (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.5)' }}>
                          {e.payment_mode}
                        </span>
                      )}
                    </div>
                    <div className="font-bold text-xs flex items-center gap-2 text-[rgba(226,232,240,0.88)]">
                      <Wallet size={12} style={{ color: accentColor }} /> {e.category}
                    </div>
                    {(e.description || e.notes) && (
                      <div className="text-[9px] text-slate-400 font-bold mt-0.5 line-clamp-1">{e.description || e.notes}</div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0 pl-2">
                    <div className="font-black text-sm tabular-nums whitespace-nowrap" style={{ color: accentColor }}>₹{Number(e.amount).toLocaleString('en-IN')}</div>
                    <div className="flex gap-1">
                      <button onClick={(e2) => { e2.stopPropagation(); onEdit(e); }} className="p-1 bg-[rgba(59,130,246,0.12)] text-blue-400 rounded-md">
                        <Edit2 size={12} />
                      </button>
                      <button onClick={(e2) => { e2.stopPropagation(); handleDelete(e.id); }} className="p-1 bg-[rgba(239,68,68,0.12)] text-red-400 rounded-md">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default ExpensesView;

