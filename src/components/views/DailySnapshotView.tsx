import React, { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft, Archive, Calendar, Download, FileText,
  RefreshCw, AlertCircle, CheckCircle, Loader2, ChevronDown, ChevronUp,
  HardDrive,
} from 'lucide-react';
import { DailySnapshotService } from '../../services/dailySnapshot';
import { useUI } from '../../context/UIContext';

interface DailySnapshotViewProps {
  userId: string;
  userEmail?: string;
  onBack: () => void;
}

const FILE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  'transactions.csv': { label: 'Transactions',  color: '#a78bfa', bg: 'rgba(139,92,246,0.12)'  },
  'ledger.csv':       { label: 'Ledger Entries', color: '#60a5fa', bg: 'rgba(59,130,246,0.12)'  },
  'expenses.csv':     { label: 'Expenses',       color: '#f87171', bg: 'rgba(239,68,68,0.12)'   },
  'inventory.csv':    { label: 'Inventory',      color: '#34d399', bg: 'rgba(16,185,129,0.12)'  },
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().split('T')[0];
}

interface DayRowProps {
  dateStr: string;
  userId: string;
  userEmail?: string;
}

const DayRow: React.FC<DayRowProps> = ({ dateStr, userId, userEmail }) => {
  const { showToast } = useUI();
  const identifier = userEmail || userId;
  const [open, setOpen] = useState(isToday(dateStr));
  const [files, setFiles] = useState<string[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const loadFiles = useCallback(async () => {
    const list = await DailySnapshotService.listFilesForDate(dateStr, identifier);
    setFiles(list);
    setFilesLoaded(true);
  }, [dateStr, identifier]);

  useEffect(() => {
    if (open && !filesLoaded) {
      loadFiles();
    }
  }, [open, filesLoaded, loadFiles]);

  const handleDownload = async (fileName: string) => {
    setDownloading(fileName);
    try {
      await DailySnapshotService.shareSnapshotFile(dateStr, fileName, identifier);
    } catch (e: any) {
      showToast('Could not share file: ' + (e?.message ?? 'Unknown error'), 'error');
    } finally {
      setDownloading(null);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await DailySnapshotService.createSnapshot(userId, dateStr, identifier);
      await loadFiles();
      showToast('Snapshot refreshed', 'success');
    } catch (e: any) {
      showToast('Refresh failed: ' + (e?.message ?? 'Unknown error'), 'error');
    } finally {
      setRegenerating(false);
    }
  };

  const today = isToday(dateStr);

  return (
    <div
      className="rounded-[18px] overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: today
          ? '1px solid rgba(96,165,250,0.35)'
          : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Header row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-4 active:opacity-80 transition-opacity"
        onClick={() => setOpen(p => !p)}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: today ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.07)' }}
        >
          <Calendar size={16} color={today ? '#60a5fa' : 'rgba(148,163,184,0.7)'} />
        </div>

        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-black truncate" style={{ color: today ? '#60a5fa' : 'rgba(240,244,255,0.9)' }}>
            {formatDate(dateStr)}
          </p>
          <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.5)' }}>
            {today ? 'Today\'s snapshot' : 'Daily snapshot'}
          </p>
        </div>

        {today && (
          <button
            onClick={e => { e.stopPropagation(); handleRegenerate(); }}
            disabled={regenerating}
            className="p-2 rounded-xl flex-shrink-0 active:scale-95 transition-all"
            style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.2)' }}
            title="Refresh today's snapshot"
          >
            {regenerating
              ? <Loader2 size={14} color="#60a5fa" className="animate-spin" />
              : <RefreshCw size={14} color="#60a5fa" />}
          </button>
        )}

        {open
          ? <ChevronUp size={16} color="rgba(148,163,184,0.5)" />
          : <ChevronDown size={16} color="rgba(148,163,184,0.5)" />}
      </button>

      {/* File list */}
      {open && (
        <div
          className="border-t px-4 py-3 space-y-2"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          {!filesLoaded && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 size={14} color="rgba(148,163,184,0.5)" className="animate-spin" />
              <span className="text-xs" style={{ color: 'rgba(148,163,184,0.5)' }}>Loading files…</span>
            </div>
          )}

          {filesLoaded && files.length === 0 && (
            <div className="flex items-center gap-2 py-2">
              <AlertCircle size={14} color="rgba(248,113,113,0.7)" />
              <span className="text-xs" style={{ color: 'rgba(148,163,184,0.5)' }}>
                No CSV files found for this date.
              </span>
            </div>
          )}

          {filesLoaded && files.map(fileName => {
            const meta = FILE_LABELS[fileName] ?? { label: fileName, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
            const isDown = downloading === fileName;
            return (
              <div
                key={fileName}
                className="flex items-center gap-3 px-3 py-2.5 rounded-[12px]"
                style={{ background: meta.bg, border: `1px solid ${meta.color}22` }}
              >
                <FileText size={14} color={meta.color} className="flex-shrink-0" />
                <span className="flex-1 text-xs font-bold truncate" style={{ color: meta.color }}>
                  {meta.label}
                </span>
                <span className="text-[10px] font-mono" style={{ color: 'rgba(148,163,184,0.4)' }}>
                  CSV
                </span>
                <button
                  onClick={() => handleDownload(fileName)}
                  disabled={isDown || !!downloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg active:scale-95 transition-all disabled:opacity-50"
                  style={{
                    background: meta.color + '22',
                    border: `1px solid ${meta.color}44`,
                  }}
                >
                  {isDown
                    ? <Loader2 size={12} color={meta.color} className="animate-spin" />
                    : <Download size={12} color={meta.color} />}
                  <span className="text-[11px] font-black" style={{ color: meta.color }}>
                    {isDown ? 'Sharing…' : 'Download'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const DailySnapshotView: React.FC<DailySnapshotViewProps> = ({ userId, userEmail, onBack }) => {
  const { showToast } = useUI();
  const isNative = Capacitor.isNativePlatform();
  const identifier = userEmail || userId;

  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotRunning, setSnapshotRunning] = useState(false);

  const loadDates = useCallback(async () => {
    const list = await DailySnapshotService.listSnapshotDates(identifier);
    setDates(list);
    setLoading(false);
  }, [identifier]);

  useEffect(() => {
    loadDates();
  }, [loadDates]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDates();
    setRefreshing(false);
  };

  const handleCreateNow = async () => {
    setSnapshotRunning(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      await DailySnapshotService.createSnapshot(userId, today, identifier);
      showToast('Snapshot created successfully', 'success');
      await loadDates();
    } catch (e: any) {
      showToast('Snapshot failed: ' + (e?.message ?? 'Unknown error'), 'error');
    } finally {
      setSnapshotRunning(false);
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>

      {/* Header */}
      <div
        className="shrink-0 px-4 pt-5 pb-4 flex items-center gap-3 border-b"
        style={{
          background: 'rgba(var(--app-bg-rgb),0.97)',
          backdropFilter: 'blur(20px)',
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        <button
          onClick={onBack}
          className="p-2 rounded-xl active:scale-95 transition-all"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <ArrowLeft size={18} color="rgba(240,244,255,0.9)" />
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="font-black text-base tracking-tight" style={{ color: 'rgba(240,244,255,0.95)' }}>
            Daily Data Archive
          </h1>
          <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.45)' }}>
            Last 7 days · CSV · Read-only
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 rounded-xl active:scale-95 transition-all"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <RefreshCw size={16} color="rgba(148,163,184,0.7)" className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Scroll area */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-4 pb-28 space-y-3"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >

        {/* Info banner */}
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-[14px]"
          style={{ background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.18)' }}
        >
          <HardDrive size={16} color="#60a5fa" className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-black" style={{ color: '#60a5fa' }}>
              Stored on Device — Tap Download to Save Anywhere
            </p>
            <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'rgba(148,163,184,0.55)' }}>
              Snapshots are saved privately on your device and updated automatically every day.
              Tap <strong style={{ color: 'rgba(148,163,184,0.75)' }}>Download</strong> on any file to open the share sheet — you can save it to
              <strong style={{ color: 'rgba(148,163,184,0.75)' }}> Downloads, Google Drive, WhatsApp</strong>, or any other app.
              Files saved that way will stay in your file manager even if you reinstall the app.
              You can view but not modify data here.
            </p>
          </div>
        </div>

        {!isNative && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-[14px]"
            style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)' }}
          >
            <AlertCircle size={16} color="#f87171" className="flex-shrink-0" />
            <p className="text-xs" style={{ color: '#f87171' }}>
              Daily snapshots are only available on the Android / iOS app.
            </p>
          </div>
        )}

        {isNative && (
          <>
            {/* Create snapshot now */}
            <button
              onClick={handleCreateNow}
              disabled={snapshotRunning}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-[14px] active:scale-95 transition-all disabled:opacity-60"
              style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}
            >
              {snapshotRunning
                ? <Loader2 size={16} color="#34d399" className="animate-spin flex-shrink-0" />
                : <Archive size={16} color="#34d399" className="flex-shrink-0" />}
              <div className="flex-1 text-left">
                <p className="text-sm font-black" style={{ color: '#34d399' }}>
                  {snapshotRunning ? 'Creating Snapshot…' : 'Capture Snapshot Now'}
                </p>
                <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.45)' }}>
                  Saves today's complete data as CSVs
                </p>
              </div>
              {!snapshotRunning && (
                <CheckCircle size={14} color="rgba(52,211,153,0.5)" className="flex-shrink-0" />
              )}
            </button>

            {/* Date list */}
            {loading && (
              <div className="flex items-center justify-center gap-2 py-10">
                <Loader2 size={18} color="rgba(148,163,184,0.5)" className="animate-spin" />
                <span className="text-sm" style={{ color: 'rgba(148,163,184,0.5)' }}>Loading snapshots…</span>
              </div>
            )}

            {!loading && dates.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.06)' }}
                >
                  <Archive size={24} color="rgba(148,163,184,0.4)" />
                </div>
                <p className="text-sm font-black" style={{ color: 'rgba(148,163,184,0.6)' }}>
                  No snapshots yet
                </p>
                <p className="text-xs text-center max-w-xs" style={{ color: 'rgba(148,163,184,0.35)' }}>
                  Snapshots are created automatically each day. Tap "Capture Snapshot Now" to create one immediately.
                </p>
              </div>
            )}

            {!loading && dates.map(dateStr => (
              <DayRow key={dateStr} dateStr={dateStr} userId={userId} userEmail={userEmail} />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default DailySnapshotView;
