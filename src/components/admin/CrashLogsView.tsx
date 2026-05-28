/**
 * CrashLogsView — Developer crash log viewer (superAdmin only)
 *
 * Reads from the global `crash_logs` Firestore collection in real time.
 * Features:
 *  • Filter by status (all / unresolved / resolved), date range, category
 *  • Expandable detail panel with full stack trace, component stack, device info
 *  • Mark as resolved / delete
 *  • Copy individual report as JSON
 *  • Download entire filtered set as JSON file
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection, query, orderBy, limit, onSnapshot,
  deleteDoc, updateDoc, doc, where, Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../../config/firebase';
import {
  AlertTriangle, CheckCircle2, Trash2, Download, Copy,
  RefreshCw, ChevronDown, ChevronUp, Shield, X, Filter,
  Smartphone, Globe, Monitor, ArrowLeft,
} from 'lucide-react';

interface CrashLog {
  id             : string;
  uid            : string;
  message        : string;
  stack          : string;
  component_stack?: string;
  category       : string;
  screen         : string;
  severity       : 'fatal' | 'error';
  resolved       : boolean;
  app_version    : string;
  platform       : string;
  user_agent     : string;
  device         : { screen_width: number; screen_height: number; memory_gb?: number };
  timestamp      : Timestamp | null;
}

type StatusFilter = 'all' | 'unresolved' | 'resolved';

const CATEGORY_COLORS: Record<string, string> = {
  render     : '#f87171',
  async      : '#fb923c',
  network    : '#60a5fa',
  auth       : '#a78bfa',
  storage    : '#fbbf24',
  sync       : '#34d399',
  native     : '#f472b6',
  chunk      : '#94a3b8',
  validation : '#c084fc',
  unknown    : '#64748b',
};

function formatTs(ts: Timestamp | null): string {
  if (!ts) return '-';
  try {
    const d = ts.toDate();
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === 'android' || platform === 'ios')
    return <Smartphone size={11} style={{ color: '#94a3b8' }} />;
  return <Globe size={11} style={{ color: '#94a3b8' }} />;
}

export default function CrashLogsView({ onBack }: { onBack: () => void }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [logs, setLogs]             = useState<CrashLog[]>([]);
  const [loading, setLoading]       = useState(true);
  const [status, setStatus]         = useState<StatusFilter>('all');
  const [search, setSearch]         = useState('');
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [copyFlash, setCopyFlash]   = useState<string | null>(null);

  // Verify superAdmin claim
  useEffect(() => {
    auth.currentUser?.getIdTokenResult(true)
      .then(result => setAuthorized(!!result.claims.superAdmin))
      .catch(() => setAuthorized(false));
  }, []);

  // Real-time listener
  useEffect(() => {
    if (!authorized) return;
    setLoading(true);
    const q = query(
      collection(db, 'crash_logs'),
      orderBy('timestamp', 'desc'),
      limit(500),
    );
    const unsub = onSnapshot(q, snap => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<CrashLog, 'id'>) })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [authorized]);

  const filtered = useMemo(() => {
    let list = logs;
    if (status === 'unresolved') list = list.filter(l => !l.resolved);
    if (status === 'resolved')   list = list.filter(l => l.resolved);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l =>
        l.message?.toLowerCase().includes(q) ||
        l.screen?.toLowerCase().includes(q) ||
        l.uid?.toLowerCase().includes(q) ||
        l.category?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [logs, status, search]);

  const stats = useMemo(() => {
    const total      = logs.length;
    const unresolved = logs.filter(l => !l.resolved).length;
    const today      = (() => {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      return logs.filter(l => l.timestamp && l.timestamp.toDate() >= d).length;
    })();
    return { total, unresolved, today };
  }, [logs]);

  const markResolved = useCallback(async (id: string, resolved: boolean) => {
    await updateDoc(doc(db, 'crash_logs', id), { resolved });
  }, []);

  const deleteLog = useCallback(async (id: string) => {
    await deleteDoc(doc(db, 'crash_logs', id));
  }, []);

  const copyAsJson = useCallback((log: CrashLog) => {
    const { id: _id, ...rest } = log;
    navigator.clipboard?.writeText(JSON.stringify(rest, null, 2)).catch(() => {});
    setCopyFlash(log.id);
    setTimeout(() => setCopyFlash(null), 1500);
  }, []);

  const downloadJson = useCallback(() => {
    const data = filtered.map(({ id: _id, ...rest }) => rest);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `crash_logs_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  // ── Auth check ───────────────────────────────────────────────────────────
  if (authorized === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="animate-spin" style={{ color: '#6366f1' }} />
      </div>
    );
  }

  if (authorized === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
        <Shield size={40} style={{ color: '#f87171' }} />
        <p className="font-black text-white">Access Denied</p>
        <p className="text-xs" style={{ color: 'rgba(148,163,184,0.6)' }}>
          This panel requires the <code>superAdmin</code> custom claim.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>

      {/* Header */}
      <div className="shrink-0 px-4 pt-5 pb-4 flex items-center gap-3 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(var(--app-bg-rgb),0.97)', backdropFilter: 'blur(20px)' }}>
        <button onClick={onBack} className="p-2 rounded-xl active:scale-95 transition-all"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <ArrowLeft size={18} className="text-white/90" />
        </button>
        <div className="w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertTriangle size={16} style={{ color: '#f87171' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-base text-white/95 tracking-tight">Crash Logs</h1>
          <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.5)' }}>
            {loading ? 'Loading…' : `${stats.total} total · ${stats.unresolved} unresolved · ${stats.today} today`}
          </p>
        </div>
        <button onClick={downloadJson} title="Download JSON"
          className="p-2 rounded-xl active:scale-95 transition-all"
          style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)' }}>
          <Download size={16} style={{ color: '#818cf8' }} />
        </button>
      </div>

      {/* Stats row */}
      <div className="shrink-0 grid grid-cols-3 gap-2 px-4 pt-3 pb-2">
        {[
          { label: 'Total',      value: stats.total,      color: '#94a3b8' },
          { label: 'Unresolved', value: stats.unresolved, color: '#f87171' },
          { label: 'Today',      value: stats.today,      color: '#fbbf24' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-3 text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="text-xl font-black tabular-nums" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'rgba(148,163,184,0.4)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="shrink-0 px-4 pb-3 space-y-2">
        {/* Status tabs */}
        <div className="flex gap-1.5 p-1 rounded-2xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {(['all', 'unresolved', 'resolved'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className="flex-1 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all active:scale-95"
              style={status === s
                ? { background: 'rgba(99,102,241,0.8)', color: '#fff' }
                : { color: 'rgba(148,163,184,0.5)' }
              }>
              {s}
            </button>
          ))}
        </div>
        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search message, screen, UID…"
          className="w-full px-3 py-2 rounded-xl text-xs font-semibold outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(240,244,255,0.9)' }}
        />
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-6" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loading && (
          <div className="flex justify-center py-10">
            <RefreshCw size={20} className="animate-spin" style={{ color: '#6366f1' }} />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle2 size={32} className="mb-3" style={{ color: 'rgba(52,211,153,0.4)' }} />
            <p className="text-sm font-bold text-white/60">No crash logs</p>
            <p className="text-[10px] mt-1" style={{ color: 'rgba(148,163,184,0.35)' }}>
              {status !== 'all' ? 'Try changing the filter' : 'Clean slate — no crashes recorded'}
            </p>
          </div>
        )}

        {filtered.map(log => {
          const isOpen = expanded === log.id;
          const catColor = CATEGORY_COLORS[log.category] ?? '#64748b';

          return (
            <div key={log.id} className="rounded-2xl overflow-hidden"
              style={{
                background  : log.resolved ? 'rgba(52,211,153,0.04)' : 'rgba(255,255,255,0.04)',
                border      : `1px solid ${log.resolved ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.08)'}`,
              }}>

              {/* Row */}
              <button className="w-full text-left p-3 flex items-start gap-3"
                onClick={() => setExpanded(isOpen ? null : log.id)}>
                {/* Severity dot */}
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: log.severity === 'fatal' ? '#f87171' : '#fb923c' }} />

                <div className="flex-1 min-w-0 space-y-1">
                  {/* Message */}
                  <p className="text-xs font-bold leading-snug line-clamp-2"
                    style={{ color: log.resolved ? 'rgba(240,244,255,0.45)' : 'rgba(240,244,255,0.9)' }}>
                    {log.message || 'No message'}
                  </p>

                  {/* Meta row */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Category badge */}
                    <span className="px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wide"
                      style={{ background: `${catColor}22`, color: catColor }}>
                      {log.category}
                    </span>

                    {/* Screen */}
                    {log.screen && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md"
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.6)' }}>
                        {log.screen}
                      </span>
                    )}

                    {/* Platform */}
                    <span className="flex items-center gap-0.5">
                      <PlatformIcon platform={log.platform} />
                      <span className="text-[9px]" style={{ color: 'rgba(148,163,184,0.5)' }}>{log.platform}</span>
                    </span>

                    {/* Version */}
                    <span className="text-[9px]" style={{ color: 'rgba(148,163,184,0.35)' }}>
                      v{log.app_version}
                    </span>
                  </div>

                  {/* Timestamp + UID */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px]" style={{ color: 'rgba(148,163,184,0.35)' }}>
                      {formatTs(log.timestamp)}
                    </span>
                    <span className="text-[9px] font-mono" style={{ color: 'rgba(148,163,184,0.25)' }}>
                      {log.uid?.slice(0, 8)}
                    </span>
                    {log.resolved && (
                      <span className="text-[8px] font-black text-emerald-400">✓ Resolved</span>
                    )}
                  </div>
                </div>

                {isOpen
                  ? <ChevronUp size={14} style={{ color: 'rgba(148,163,184,0.4)', flexShrink: 0 }} />
                  : <ChevronDown size={14} style={{ color: 'rgba(148,163,184,0.4)', flexShrink: 0 }} />
                }
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-3 pb-3 space-y-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-3">
                    <button onClick={() => markResolved(log.id, !log.resolved)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black active:scale-95 transition-all"
                      style={log.resolved
                        ? { background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.7)' }
                        : { background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }
                      }>
                      <CheckCircle2 size={11} />
                      {log.resolved ? 'Unresolve' : 'Mark Resolved'}
                    </button>

                    <button onClick={() => copyAsJson(log)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black active:scale-95 transition-all"
                      style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                      <Copy size={11} />
                      {copyFlash === log.id ? 'Copied!' : 'Copy JSON'}
                    </button>

                    <button onClick={() => deleteLog(log.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black active:scale-95 transition-all ml-auto"
                      style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}>
                      <Trash2 size={11} />
                      Delete
                    </button>
                  </div>

                  {/* Device info */}
                  <div className="rounded-xl p-3 space-y-1"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: 'rgba(148,163,184,0.4)' }}>Device Info</p>
                    {[
                      ['UID',         log.uid],
                      ['Screen',      `${log.device?.screen_width ?? '?'} × ${log.device?.screen_height ?? '?'}`],
                      ['Memory',      log.device?.memory_gb != null ? `${log.device.memory_gb} GB` : '-'],
                      ['Platform',    log.platform],
                      ['App Version', `v${log.app_version}`],
                    ].map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-[9px] font-bold w-20 flex-shrink-0" style={{ color: 'rgba(148,163,184,0.4)' }}>{k}</span>
                        <span className="text-[9px] font-mono break-all" style={{ color: 'rgba(148,163,184,0.7)' }}>{v}</span>
                      </div>
                    ))}
                    {log.user_agent && (
                      <div className="flex gap-2">
                        <span className="text-[9px] font-bold w-20 flex-shrink-0" style={{ color: 'rgba(148,163,184,0.4)' }}>User Agent</span>
                        <span className="text-[9px] font-mono break-all leading-relaxed" style={{ color: 'rgba(148,163,184,0.5)' }}>{log.user_agent}</span>
                      </div>
                    )}
                  </div>

                  {/* Stack trace */}
                  {log.stack && (
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest mb-1.5" style={{ color: 'rgba(248,113,113,0.6)' }}>Stack Trace</p>
                      <pre className="text-[9px] font-mono whitespace-pre-wrap break-all leading-relaxed p-3 rounded-xl overflow-auto max-h-48"
                        style={{ background: 'rgba(239,68,68,0.06)', color: 'rgba(248,113,113,0.8)', border: '1px solid rgba(239,68,68,0.1)' }}>
                        {log.stack}
                      </pre>
                    </div>
                  )}

                  {/* Component stack */}
                  {log.component_stack && (
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest mb-1.5" style={{ color: 'rgba(251,146,60,0.6)' }}>Component Stack</p>
                      <pre className="text-[9px] font-mono whitespace-pre-wrap break-all leading-relaxed p-3 rounded-xl overflow-auto max-h-36"
                        style={{ background: 'rgba(251,146,60,0.05)', color: 'rgba(251,146,60,0.7)', border: '1px solid rgba(251,146,60,0.1)' }}>
                        {log.component_stack}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
