import React, { useState, useMemo, useRef } from 'react';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { User } from 'firebase/auth';
import {
  Wallet, Edit2, Trash2, Download, Plus,
  Filter, TrendingDown, Check, ChevronDown, ArrowLeft
} from 'lucide-react';
import SearchBarWithSuggest from '../common/SearchBarWithSuggest';
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
      onRestore: () => setData(p => [...p, item].sort((a, b) => {
        const dA = (a.date||'').slice(0,10), dB = (b.date||'').slice(0,10);
        if (dA !== dB) return dB < dA ? -1 : 1;
        const cA = a.created_at ? parseRecordDate(a.created_at).getTime() : 0;
        const cB = b.created_at ? parseRecordDate(b.created_at).getTime() : 0;
        return cB - cA;
      })),
      onCommit: async () => { await TrashService.moveToTrash(user.uid, 'expenses', id); },
    });
  };

  const availableCategories = useMemo(() => {
    const settingsCats = appSettings?.custom_lists?.expense_types || [];
    const dataCats = expenses.map(e => e.category).filter(Boolean);
    return Array.from(new Set(['all', ...settingsCats, ...dataCats])).sort();
  }, [appSettings, expenses]);

  const expenseSuggestions = useMemo(() => {
    const cats = (expenses || []).map((e: any) => e.category).filter(Boolean);
    return [...new Set(cats)] as string[];
  }, [expenses]);

  const filtered = useMemo(() => {
    const s = searchTerm.toLowerCase().trim();
    return expenses.filter(e => {
      const matchesSearch = !s || (
        (e.category     || '').toLowerCase().includes(s) ||
        (e.notes        || '').toLowerCase().includes(s) ||
        (e.expense_no   || '').toLowerCase().includes(s) ||
        (e.paid_by      || '').toLowerCase().includes(s) ||
        (e.payment_mode || '').toLowerCase().includes(s) ||
        (e.description  || '').toLowerCase().includes(s) ||
        String(e.amount ?? '').includes(s)
      );
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
        const { buildPdf, drawPdfHeader, drawSummaryBoxes, addPageFooters, tableStyles, pdfRupee } = await import('../../utils/professionalPdf');
        const { doc, PW, m, autoTable } = await buildPdf('landscape');
        const firm = appSettings?.profile?.firm_name || 'Business';
        const period = `${dateRange.start}  →  ${dateRange.end}`;

        // Category breakdown for summary boxes
        const catTotals: Record<string, number> = {};
        filtered.forEach(e => { const c = e.category || 'Other'; catTotals[c] = (catTotals[c] || 0) + Number(e.amount || 0); });
        const topCats = Object.entries(catTotals).sort(([,a],[,b]) => b - a).slice(0, 2);

        let y = drawPdfHeader(doc, PW, { firm, title: 'Expenses Report', subtitle: period });
        y = drawSummaryBoxes(doc, y, PW, m, [
          { label: 'Total Expenses',  value: pdfRupee(totalAmount), warn: totalAmount > 0 },
          { label: 'Records',         value: String(filtered.length) },
          ...(topCats[0] ? [{ label: topCats[0][0], value: pdfRupee(topCats[0][1]) }] : []),
          ...(topCats[1] ? [{ label: topCats[1][0], value: pdfRupee(topCats[1][1]) }] : []),
        ]);

        autoTable(doc, {
          startY: y, margin: { left: m, right: m },
          head: [['Date', 'Category', 'Description / Notes', 'Paid By', 'Mode', 'Amount']],
          body: filtered.map(e => [
            toDateString(e.date),
            e.category || '-',
            e.notes || '-',
            e.paid_by || '-',
            e.payment_mode || 'Cash',
            pdfRupee(Number(e.amount || 0)),
          ]),
          ...tableStyles([5]),
          foot: [['', '', '', '', 'Total', pdfRupee(totalAmount)]],
          footStyles: { fillColor: [230, 235, 255], fontStyle: 'bold', fontSize: 8.5, halign: 'right' as any },
        });

        addPageFooters(doc, firm);
        const blob = doc.output('blob');
        await exportService.sharePdfBlob(blob, `Expenses_${dateRange.start}_to_${dateRange.end}.pdf`);
        showToast('PDF Downloaded', 'success');
      } catch (e: any) { console.error('Expense PDF error:', e); showToast('Export failed: ' + (e?.message || 'Unknown'), 'error'); }
    }
  };

  const CAT_COLORS: Record<string, string> = {
    fuel: "var(--col-warning)", salary: "var(--col-indigo)", utilities: "var(--col-info)",
    rent: "var(--col-success)", repair: "var(--col-danger)", food: "var(--col-orange-400)",
    transport: "var(--col-violet)", marketing: "var(--col-fuchsia)", default: "var(--col-slate)",
  };

  // Android-safe scroll preservation: visibility:hidden keeps the list in the
  // render tree (scrollTop preserved) while the detail view overlays it absolutely.
  // display:none can cause Android WebView to evict the element and reset scrollTop.
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      {selectedExpense && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
          <ExpenseDetailView
            expense={selectedExpense}
            settings={appSettings || {}}
            onBack={() => setSelectedExpense(null)}
            onEdit={(item) => { setSelectedExpense(null); onEdit(item); }}
          />
        </div>
      )}
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--app-bg)', visibility: selectedExpense ? 'hidden' : 'visible', pointerEvents: selectedExpense ? 'none' : 'auto' }}>
      {showExportModal && (
        <ExportFormatModal onSelect={handleExportFormat} onClose={() => setShowExportModal(false)} />
      )}

      {/* STICKY HEADER */}
      <div className="sticky top-0 z-30 px-4 pb-2 md:px-6 flex-shrink-0" style={{ paddingTop: '16px', background: 'rgba(var(--app-bg-rgb),0.92)', backdropFilter: 'blur(20px)' }}>
        <div className="flex justify-between items-center mb-4 relative z-20">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="p-1.5 rounded-full transition-colors text-[var(--text-muted)] hover:bg-[var(--rgba-white-08)]">
                <ArrowLeft size={18} />
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Expenses</h1>
            </div>
          </div>

          <div className="flex gap-1.5 relative" ref={dropdownRef}>
            <button
              onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
              className={`p-2 rounded-xl shadow-sm border active:scale-95 transition-all flex items-center gap-2 ${categoryFilter !== 'all' ? 'bg-[var(--col-violet-25)] text-violet-300 border-[var(--col-violet-35)]' : 'bg-[var(--rgba-white-06)] text-[var(--text-muted)] border-[var(--rgba-white-08)]'}`}
            >
              <Filter size={18} />
              {categoryFilter !== 'all' && <span className="text-xs font-bold max-w-[60px] truncate">{categoryFilter}</span>}
              <ChevronDown size={14} />
            </button>

            {showCategoryDropdown && (
              <div className="absolute top-12 right-0 w-48 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--glass-border)' }}>
                <div className="max-h-60 overflow-y-auto p-1">
                  {availableCategories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => { setCategoryFilter(cat); setShowCategoryDropdown(false); }}
                      className={`w-full text-left px-3 py-2.5 text-xs font-bold rounded-lg flex items-center justify-between ${categoryFilter === cat ? 'bg-[var(--col-info-15)] text-blue-400' : 'text-[var(--text-secondary)] hover:bg-[var(--rgba-white-08)]'}`}
                    >
                      {cat === 'all' ? 'All Categories' : cat}
                      {categoryFilter === cat && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => setShowExportModal(true)} className="p-2 text-col-info rounded-xl active:scale-95 border border-[var(--col-info-25)] bg-[var(--col-info-15)] transition-all">
              <Download size={18} />
            </button>
            <button onClick={onAdd} className="text-white p-2 rounded-xl shadow-lg active:scale-95 bg-gradient-to-r from-col-indigo-600 to-col-violet-600 transition-all">
              <Plus size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* SCROLLABLE CONTENT */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* SUMMARY CARD */}
        <div className="p-4 rounded-3xl shadow-xl mb-4 flex justify-between items-center relative overflow-hidden border border-[var(--col-warning-25)] bg-[var(--col-warning-15)]">
          <div className="relative z-10">
            <div className="text-app-sm font-bold opacity-70 uppercase mb-0.5">Total Expense</div>
            <div className="text-2xl font-black">₹{totalAmount.toLocaleString('en-IN')}</div>
            <div className="text-app-sm font-bold opacity-50 mt-1">{filtered.length} Records</div>
          </div>
          <div className="bg-[var(--rgba-white-06)]/10 p-2.5 rounded-full relative z-10">
            <TrendingDown size={24} className="text-white" />
          </div>
          <TrendingDown size={80} className="absolute -bottom-4 -right-4 text-white opacity-5 pointer-events-none" />
        </div>

        {/* SEARCH & DATE FILTER */}
        <div className="mb-3 space-y-2">
          <SearchBarWithSuggest
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Category, notes, paid by, amount…"
            suggestions={expenseSuggestions}
            className="rounded-xl border border-white/12"
            inputClassName="p-2 text-xs font-bold bg-transparent outline-none text-[var(--text-primary)]"
            containerStyle={{ background: 'var(--rgba-white-06)' }}
          />
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
            <div className="text-center py-10 text-[var(--text-muted)]">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
                style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)' }}>
                <TrendingDown size={28} style={{ color: 'var(--col-danger-60)' }} />
              </div>
              <p className="text-sm font-black text-white mb-1">
                {searchTerm || categoryFilter !== 'all' ? 'No matching expenses' : 'No expenses yet'}
              </p>
              <p className="text-app-md mb-5" style={{ color: 'var(--text-muted)' }}>
                {searchTerm || categoryFilter !== 'all'
                  ? 'Try a different search or clear the filter'
                  : 'Track rent, salaries, utilities and other business costs'}
              </p>
              {!searchTerm && categoryFilter === 'all' && (
                <button onClick={onAdd}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-app-lg font-black text-white active:scale-95 transition-all"
                  style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)', boxShadow: '0 6px 20px var(--col-danger-35)' }}>
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
                  className="p-3 rounded-3xl border border-white/10 bg-[var(--rgba-white-04)] flex justify-between items-center group overflow-hidden transition-all active:scale-[0.97] cursor-pointer relative"
                  style={{ borderLeft: `3px solid ${accentColor}40` }}
                >
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r-full" style={{ background: accentColor }} />
                  <div className="min-w-0 flex-1 overflow-hidden pl-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-app-xs font-bold px-1.5 py-0.5 rounded text-[var(--text-muted)]">
                        {toDateString(e.date)}
                      </span>
                      {e.expense_no && (
                        <span className="text-app-2xs font-mono font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--col-warning-15)', color: 'var(--col-warning-65)' }}>
                          {e.expense_no}
                        </span>
                      )}
                    </div>
                    <div className="font-bold text-xs flex items-center gap-2 text-[var(--text-secondary)]">
                      <Wallet size={12} style={{ color: accentColor }} /> {e.category}
                    </div>
                    {(e.description || e.notes) && (
                      <div className="text-app-xs text-slate-400 font-bold mt-0.5 line-clamp-1">{e.description || e.notes}</div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0 pl-2">
                    <div className="font-black text-sm tabular-nums whitespace-nowrap" style={{ color: accentColor }}>₹{Number(e.amount).toLocaleString('en-IN')}</div>
                    <div className="flex gap-1">
                      <button onClick={(e2) => { e2.stopPropagation(); onEdit(e); }} className="p-1 bg-[var(--col-info-12)] text-blue-400 rounded-md">
                        <Edit2 size={12} />
                      </button>
                      <button onClick={(e2) => { e2.stopPropagation(); handleDelete(e.id); }} className="p-1 bg-[var(--col-danger-12)] text-red-400 rounded-md">
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
    </div>
  );
};

export default ExpensesView;

