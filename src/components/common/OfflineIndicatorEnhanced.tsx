/**
 * OfflineIndicatorEnhanced  — Full-Fledge
 * ─────────────────────────────────────────────────────────────
 * Shows: offline status | queue count | sync progress bar
 *        | conflict count | expandable conflict resolver
 * ConflictModal: side-by-side Your Change vs Cloud Version cards
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  WifiOff, RefreshCw, Check, AlertTriangle,
  ChevronDown, ChevronUp, X, GitMerge,
  Server, Smartphone, RotateCcw, Clock,
} from 'lucide-react';
import { OfflineSyncService, SyncConflict } from '../../services/offlineSyncService';
import { useSyncStatus, useSyncControl } from '../../hooks/useOnlineStatus';

// ─── Conflict Modal ───────────────────────────────────────────────────────────
const ConflictModal: React.FC<{
  conflict : SyncConflict;
  onResolve: (r: 'use-client' | 'use-server') => void;
  onClose  : () => void;
}> = ({ conflict, onResolve, onClose }) => {
  const getLabel = (d: any) =>
    d?.party_name || d?.name || d?.category || d?.description ||
    conflict.item.collection.replace(/_/g, ' ');

  const fmtTs = (ts: number) =>
    new Date(ts).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });

  return (
    <div className="fixed inset-0 z-[250] flex items-end justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }}>
      <div className="w-full max-w-md rounded-[28px] p-5 space-y-4"
        style={{ background: 'rgba(12,16,40,0.98)', border: '1px solid rgba(245,158,11,0.35)', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-[14px]" style={{ background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <GitMerge size={16} style={{ color: '#fbbf24' }} />
            </div>
            <div>
              <p className="font-black text-sm text-white">Sync Conflict</p>
              <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.55)' }}>
                {conflict.item.collection.replace(/_/g, ' ')} · {conflict.item.operation}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl active:scale-90 transition-all"
            style={{ background: 'rgba(255,255,255,0.07)' }}>
            <X size={13} style={{ color: 'rgba(148,163,184,0.6)' }} />
          </button>
        </div>

        <p className="text-[11px]" style={{ color: 'rgba(203,213,225,0.6)' }}>
          This record was changed on another device. Choose which version to keep.
        </p>

        {/* Side-by-side cards */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Client */}
          <button onClick={() => onResolve('use-client')}
            className="p-4 rounded-[20px] text-left space-y-3 active:scale-95 transition-all"
            style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.28)' }}>
            <div className="flex items-center gap-1.5">
              <Smartphone size={11} style={{ color: '#60a5fa' }} />
              <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#60a5fa' }}>Your Change</span>
            </div>
            <p className="text-xs font-bold text-white truncate">{getLabel(conflict.clientData)}</p>
            <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.45)' }}>{fmtTs(conflict.item.clientUpdatedAt)}</p>
            <div className="text-center text-[9px] font-black py-1 rounded-lg"
              style={{ background: 'rgba(59,130,246,0.22)', color: '#93c5fd' }}>KEEP THIS →</div>
          </button>

          {/* Server */}
          <button onClick={() => onResolve('use-server')}
            className="p-4 rounded-[20px] text-left space-y-3 active:scale-95 transition-all"
            style={{ background: 'rgba(16,185,129,0.09)', border: '1px solid rgba(16,185,129,0.24)' }}>
            <div className="flex items-center gap-1.5">
              <Server size={11} style={{ color: '#34d399' }} />
              <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#34d399' }}>Cloud Version</span>
            </div>
            <p className="text-xs font-bold text-white truncate">{getLabel(conflict.serverData)}</p>
            <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.45)' }}>Last saved on server</p>
            <div className="text-center text-[9px] font-black py-1 rounded-lg"
              style={{ background: 'rgba(16,185,129,0.18)', color: '#6ee7b7' }}>KEEP THIS →</div>
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
export const OfflineIndicatorEnhanced: React.FC = () => {
  const { isOnline, isSyncing, syncMessage, queueCount, syncProgress } = useSyncStatus();
  const { syncNow, isSyncing: isSyncingNow } = useSyncControl();
  const [conflicts, setConflicts]         = useState<SyncConflict[]>([]);
  const [activeConflict, setActiveConflict] = useState<SyncConflict | null>(null);
  const [expanded, setExpanded]           = useState(false);
  const [resolving, setResolving]         = useState(false);

  // Poll conflicts every 2 s, but pause when the document is hidden
  // (app backgrounded) to avoid unnecessary wakeups and battery drain.
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === 'hidden') return;
      setConflicts(OfflineSyncService.getConflicts());
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, []);

  const handleResolve = useCallback(async (resolution: 'use-client' | 'use-server') => {
    if (!activeConflict) return;
    setResolving(true);
    await OfflineSyncService.applyConflictResolution(activeConflict, resolution);
    setConflicts(OfflineSyncService.getConflicts());
    setActiveConflict(null);
    setResolving(false);
  }, [activeConflict]);

  const hasConflicts = conflicts.length > 0;
  const isVisible    = !isOnline || isSyncing || !!syncMessage || hasConflicts || queueCount > 0;
  if (!isVisible) return null;

  // Dynamic theme
  let bg     = 'rgba(15,20,40,0.92)';
  let border = 'rgba(255,255,255,0.1)';
  let color  = 'rgba(203,213,225,0.9)';
  if (!isOnline)        { bg = 'rgba(245,158,11,0.14)'; border = 'rgba(245,158,11,0.3)';  color = '#fbbf24'; }
  else if (hasConflicts){ bg = 'rgba(239,68,68,0.12)';  border = 'rgba(239,68,68,0.3)';   color = '#f87171'; }
  else if (isSyncing)   { bg = 'rgba(59,130,246,0.12)'; border = 'rgba(59,130,246,0.3)';  color = '#60a5fa'; }
  else if (syncMessage) { bg = 'rgba(16,185,129,0.12)'; border = 'rgba(16,185,129,0.3)';  color = '#34d399'; }

  const mainMsg = !isOnline
    ? `Offline${queueCount > 0 ? ` · ${queueCount} change${queueCount > 1 ? 's' : ''} queued` : ''}`
    : hasConflicts  ? `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''} – tap to resolve`
    : isSyncing     ? `Syncing${syncProgress ? ` (${syncProgress.processed}/${syncProgress.total})` : '…'}`
    : syncMessage   ? syncMessage
    : queueCount > 0 ? `${queueCount} pending upload`
    : '';

  const expandable = hasConflicts || queueCount > 0;

  return (
    <>
      {activeConflict && (
        <ConflictModal
          conflict={activeConflict}
          onResolve={handleResolve}
          onClose={() => setActiveConflict(null)}
        />
      )}

      {/* Status bar */}
      <div
        className="mx-3 mt-2 mb-0 rounded-2xl px-3.5 py-2.5 transition-all duration-300 relative overflow-hidden"
        style={{ background: bg, border: `1px solid ${border}`, backdropFilter: 'blur(20px)', cursor: expandable ? 'pointer' : 'default' }}
        onClick={() => expandable && setExpanded(e => !e)}>
        {/* Top sheen */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg,transparent,${color}35,transparent)` }} />

        <div className="flex items-center gap-2.5">
          <div className="flex-shrink-0">
            {!isOnline    ? <WifiOff       size={13} style={{ color }} /> :
             hasConflicts ? <AlertTriangle size={13} style={{ color }} /> :
             isSyncing    ? <RefreshCw     size={13} className="animate-spin" style={{ color }} /> :
                            <Check         size={13} style={{ color }} />}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black leading-none truncate" style={{ color }}>{mainMsg}</p>
            {/* Progress bar */}
            {isSyncing && syncProgress && (
              <div className="mt-1.5 h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(syncProgress.processed / syncProgress.total) * 100}%`, background: color }} />
              </div>
            )}
          </div>

          {expandable && (
            <div style={{ color }}>
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </div>
          )}
        </div>
      </div>

      {/* Expanded: conflicts list */}
      {expanded && hasConflicts && (
        <div className="mx-3 mt-1 rounded-[18px] overflow-hidden"
          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)' }}>
          {conflicts.map((c, idx) => (
            <button key={c.item.id}
              className="w-full flex items-center justify-between px-4 py-3 active:bg-white/5 transition-all text-left"
              style={{ borderBottom: idx < conflicts.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
              onClick={() => { setActiveConflict(c); setExpanded(false); }}>
              <div>
                <p className="text-xs font-bold text-white">
                  {c.clientData?.party_name || c.clientData?.name || c.item.collection}
                </p>
                <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.5)' }}>
                  {c.item.collection.replace(/_/g, ' ')} · {c.item.operation}
                </p>
              </div>
              <span className="text-[9px] font-black px-2.5 py-1 rounded-lg flex-shrink-0"
                style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}>RESOLVE</span>
            </button>
          ))}
        </div>
      )}

      {/* Expanded: offline queue summary + sync now */}
      {expanded && !hasConflicts && queueCount > 0 && (
        <div className="mx-3 mt-1 px-4 py-3 rounded-[18px]"
          style={{
            background: isOnline ? 'rgba(59,130,246,0.08)' : 'rgba(245,158,11,0.08)',
            border: `1px solid ${isOnline ? 'rgba(59,130,246,0.2)' : 'rgba(245,158,11,0.18)'}`,
          }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock size={10} style={{ color: isOnline ? '#60a5fa' : '#fbbf24' }} />
              <p className="text-[10px] font-bold" style={{ color: isOnline ? 'rgba(96,165,250,0.9)' : 'rgba(251,191,36,0.8)' }}>
                {queueCount} write{queueCount > 1 ? 's' : ''} queued
                {!isOnline ? ' — will auto-sync when back online' : ''}
              </p>
            </div>
            {isOnline && (
              <button
                onClick={() => { syncNow(); setExpanded(false); }}
                disabled={isSyncingNow}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black active:scale-95 transition-all disabled:opacity-40"
                style={{ background: 'rgba(59,130,246,0.18)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', flexShrink: 0 }}>
                <RotateCcw size={9} className={isSyncingNow ? 'animate-spin' : ''} />
                {isSyncingNow ? 'Syncing…' : 'Sync Now'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};

// Backward-compat alias
export const OfflineIndicator = OfflineIndicatorEnhanced;
export default OfflineIndicatorEnhanced;







