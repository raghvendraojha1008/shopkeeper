import React, { useState, useMemo } from 'react';
import { User } from 'firebase/auth';
import {
  ArrowLeft, Search, Wrench, FileText, Download, Calendar, Tag, IndianRupee
} from 'lucide-react';
import DateRangeFilter from '../common/DateRangeFilter';
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { parseDateSafe, toDateStrSafe } from '../../utils/dateUtils';
import { ServiceItem } from '../../types/models';

interface ServiceDetailViewProps {
  user: User;
  service: ServiceItem;
  onBack: () => void;
}

function toDateString(raw: any): string { return toDateStrSafe(raw); }

const ServiceDetailView: React.FC<ServiceDetailViewProps> = ({ user, service, onBack }) => {
  const { showToast } = useUI();
  const { useMiscCharges } = useData();
  const { data: allMiscCharges = [], isLoading: loading } = useMiscCharges(user.uid);
  const [searchTerm, setSearchTerm] = useState('');

  type QuickKey = 'fy' | `m${number}` | 'custom';
  const [quickKey, setQuickKey] = useState<QuickKey>('fy');

  const fmtIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const fyInfo = useMemo(() => {
    const now = new Date();
    const fyStartYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    const start = new Date(fyStartYear, 3, 1);
    const end   = new Date(fyStartYear + 1, 2, 31);
    return { fyStartYear, start, end, label: `FY ${String(fyStartYear).slice(-2)}-${String(fyStartYear + 1).slice(-2)}` };
  }, []);

  const todayIso = useMemo(() => fmtIso(new Date()), []);

  const [dateRange, setDateRange] = useState({
    start: fmtIso(fyInfo.start),
    end:   todayIso,
  });

  const monthRange = (fyMonthIdx: number) => {
    const calendarMonth = (3 + fyMonthIdx) % 12;
    const yearOffset    = fyMonthIdx <= 8 ? 0 : 1;
    const year          = fyInfo.fyStartYear + yearOffset;
    const start = new Date(year, calendarMonth, 1);
    const end   = new Date(year, calendarMonth + 1, 0);
    return { start: fmtIso(start), end: fmtIso(end) };
  };

  const applyQuick = (key: QuickKey) => {
    setQuickKey(key);
    if (key === 'fy') {
      const fyEndIso = fmtIso(fyInfo.end);
      setDateRange({ start: fmtIso(fyInfo.start), end: todayIso < fyEndIso ? todayIso : fyEndIso });
    } else if (key !== 'custom') {
      const m = parseInt(key.slice(1), 10);
      setDateRange(monthRange(m));
    }
  };

  const MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

  const descDateCreated = (a: any, b: any) => {
    const dA = (a.date || '').slice(0, 10), dB = (b.date || '').slice(0, 10);
    if (dA !== dB) return dB < dA ? -1 : 1;
    const cA = a.created_at ? parseDateSafe(a.created_at).getTime() : 0;
    const cB = b.created_at ? parseDateSafe(b.created_at).getTime() : 0;
    return cB - cA;
  };

  // All misc-charge records for this service
  const miscChargeRecords = useMemo(() => {
    const svcId   = (service as any).id;
    const svcName = service.name?.toLowerCase();
    return allMiscCharges
      .filter((mc: any) =>
        (mc.service_id && mc.service_id === svcId) ||
        (mc.service_name && mc.service_name.toLowerCase() === svcName)
      )
      .slice()
      .sort(descDateCreated);
  }, [allMiscCharges, service]);

  // Filtered by search term + date range
  const filteredMisc = useMemo(() => {
    return miscChargeRecords.filter(mc => {
      const matchesSearch = mc.party_name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesDate   = toDateString(mc.date) >= dateRange.start &&
                            toDateString(mc.date) <= dateRange.end;
      return matchesSearch && matchesDate;
    });
  }, [miscChargeRecords, searchTerm, dateRange]);

  const stats = useMemo(() => {
    const totalAmount = filteredMisc.reduce((s, mc) => s + (Number(mc.amount) || 0), 0);
    return { totalRecords: filteredMisc.length, totalAmount: Math.round(totalAmount) };
  }, [filteredMisc]);

  const accentCharge = "var(--col-cyan)";

  const handleExport = async () => {
    if (filteredMisc.length === 0) return showToast('No data to export', 'error');
    const data = filteredMisc.map(mc => ({
      Date:      mc.date,
      Party:     mc.party_name || '-',
      Direction: mc.direction === 'charge_to_party' ? 'Charge to Party' : 'Charge from Party',
      Amount:    mc.amount,
      Notes:     mc.notes || '-',
    }));
    await exportService.exportToCSV(data, Object.keys(data[0]), `${service.name}_service_charges.csv`);
    showToast('Downloaded', 'success');
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--app-bg)' }}>

      {/* HEADER */}
      <div className="sticky top-0 z-30 flex justify-between items-center px-3 md:px-6 pb-3"
        style={{ paddingTop: 16, background: 'rgba(var(--app-bg-rgb),0.92)', backdropFilter: 'blur(20px)' }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-full active:scale-95 transition-all">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-black leading-none">{service.name}</h1>
            <p className="text-app-sm font-bold text-slate-400 uppercase">
              Service Details • {stats.totalRecords} Records
            </p>
          </div>
        </div>
        <button onClick={handleExport}
          className="p-2.5 rounded-xl active:scale-95 transition-all glass-icon-btn"
          style={{ color: accentCharge }}>
          <Download size={18} />
        </button>
      </div>

      <div className="px-3 md:px-6">

        {/* SERVICE INFO CARD */}
        <div className="p-4 rounded-2xl mb-3 border border-white/08"
          style={{ background: 'rgba(168,85,247,0.06)' }}>
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-[14px]"
                style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.2)' }}>
                <Wrench size={16} style={{ color: "var(--col-purple)" }} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  {(service as any).service_code && (
                    <span className="px-1.5 py-0.5 rounded-md text-app-xs font-black tracking-wide"
                      style={{ background: 'rgba(168,85,247,0.15)', color: "var(--col-purple-light)", border: '1px solid rgba(168,85,247,0.25)' }}>
                      {(service as any).service_code}
                    </span>
                  )}
                  {(service as any).category && (
                    <span className="px-1.5 py-0.5 rounded-md text-app-xs font-semibold"
                      style={{ background: 'var(--rgba-white-06)', color: 'var(--text-muted)' }}>
                      <Tag size={8} className="inline mr-0.5" />{(service as any).category}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <IndianRupee size={13} style={{ color: "var(--col-purple)" }} />
                  <span className="font-black text-lg" style={{ color: "var(--col-purple)" }}>
                    {Number(service.rate_per_unit).toLocaleString('en-IN')}
                  </span>
                  <span className="text-app-sm font-semibold ml-0.5" style={{ color: 'rgba(168,85,247,0.6)' }}>
                    / {service.unit}
                  </span>
                </div>
              </div>
            </div>
          </div>
          {(service as any).notes && (
            <p className="text-app-sm mt-2 pt-2 border-t border-dashed border-white/08"
              style={{ color: 'var(--text-muted)' }}>{(service as any).notes}</p>
          )}
        </div>

        {/* STATS CARD */}
        <div className="p-4 rounded-2xl shadow-lg mb-3 flex justify-between items-center relative overflow-hidden text-white"
          style={{ background: accentCharge }}>
          <div className="relative z-10">
            <div className="text-app-sm font-bold opacity-70 uppercase mb-0.5">Total Charged</div>
            <div className="text-2xl font-black leading-none mb-2">
              ₹{stats.totalAmount.toLocaleString('en-IN')}
            </div>
            <div className="flex gap-3">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background:  'var(--rgba-white-15)' }}>
                <FileText size={12} />
                <span className="text-app-sm font-bold uppercase">{stats.totalRecords} Records</span>
              </div>
            </div>
          </div>
          <div className="p-3 rounded-full relative z-10" style={{ background:  'var(--rgba-white-15)' }}>
            <Tag size={24} />
          </div>
          <Tag size={80} className="absolute -bottom-4 -right-4 opacity-10 pointer-events-none" />
        </div>

        {/* SEARCH + DATE FILTER */}
        <div className="p-2.5 rounded-xl mb-3 space-y-2 border border-white/08"
          style={{ background: 'var(--rgba-white-04)' }}>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
            <input
              className="w-full pl-8 p-2 border border-white/12 rounded-lg text-xs font-bold outline-none"
              placeholder="Search party…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
            {([
              { key: 'fy' as QuickKey, label: fyInfo.label },
              ...MONTH_LABELS.map((m, i) => ({ key: `m${i}` as QuickKey, label: m })),
              { key: 'custom' as QuickKey, label: 'Custom' },
            ]).map(opt => {
              const active = quickKey === opt.key;
              return (
                <button key={opt.key} type="button" onClick={() => applyQuick(opt.key)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-full text-app-md font-black transition-all flex items-center gap-1 ${
                    active ? 'text-white shadow-md' : 'border border-white/12 text-slate-400 active:scale-95'
                  }`}
                  style={active ? { background: accentCharge } : {}}>
                  {opt.key === 'custom' && <Calendar size={10} />}
                  {opt.label}
                </button>
              );
            })}
          </div>

          {quickKey === 'custom' && (
            <DateRangeFilter
              start={dateRange.start} end={dateRange.end}
              onStartChange={v => setDateRange(r => ({ ...r, start: v }))}
              onEndChange={v => setDateRange(r => ({ ...r, end: v }))}
            />
          )}
        </div>

        {/* CHARGES LIST */}
        <div className="space-y-1.5 pb-20">
          {loading ? (
            <div className="text-center py-10 text-[var(--text-muted)] text-xs">Loading…</div>
          ) : filteredMisc.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="w-14 h-14 rounded-[18px] flex items-center justify-center"
                style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.15)' }}>
                <Tag size={24} style={{ color: 'rgba(6,182,212,0.5)' }} />
              </div>
              <p className="text-xs text-slate-400 font-bold">No service charges found for this period</p>
            </div>
          ) : filteredMisc.map(mc => {
            const isChargeTo = mc.direction === 'charge_to_party';
            return (
              <div key={mc.id} className="p-3 rounded-xl relative overflow-hidden border"
                style={{ borderColor: isChargeTo ? 'var(--col-danger-25)' : 'var(--col-success-25)' }}>
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
                  style={{ background: isChargeTo ? "var(--col-danger)" : "var(--col-success)" }} />
                <div className="pl-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-app-sm font-bold text-slate-400">{mc.date}</span>
                      <span className="text-app-xs font-black px-1.5 py-0.5 rounded uppercase"
                        style={isChargeTo
                          ? { background: 'var(--col-danger-12)', color: "var(--col-danger)" }
                          : { background: 'var(--col-success-12)', color: "var(--col-success)" }}>
                        {isChargeTo ? 'We Charge' : 'They Charge'}
                      </span>
                    </div>
                    <div className="font-black text-base" style={{ color: 'var(--text-primary)' }}>
                      ₹{Math.round(Number(mc.amount)).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="font-bold text-sm truncate max-w-[60%]">{mc.party_name || '—'}</div>
                  </div>
                  {mc.notes && (
                    <p className="text-app-sm mt-1 text-slate-500 italic">{mc.notes}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ServiceDetailView;
