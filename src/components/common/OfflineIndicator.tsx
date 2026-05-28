import React from 'react';
import { WifiOff, RefreshCw, Check } from 'lucide-react';
import { useSyncStatus } from '../../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, isSyncing, syncMessage, queueCount, syncProgress } = useSyncStatus();

  if (isOnline && !isSyncing && !syncMessage) {
    return null;
  }

  return (
    <div
      className={`w-full z-[100] px-4 py-2 flex items-center justify-between gap-3 text-sm font-medium transition-all duration-300 ${
        !isOnline
          ? 'bg-amber-500 text-white'
          : isSyncing
          ? 'bg-blue-600 text-white'
          : 'bg-emerald-500 text-white'
      }`}
      style={{ maxWidth: '100vw', boxSizing: 'border-box' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {!isOnline ? (
          <>
            <WifiOff size={14} className="flex-shrink-0" />
            <span className="truncate text-xs">
              Offline{queueCount > 0 ? ` · ${queueCount} pending` : ''}
            </span>
          </>
        ) : isSyncing ? (
          <>
            <RefreshCw size={14} className="animate-spin flex-shrink-0" />
            <span className="truncate text-xs">
              {syncMessage}{syncProgress && ` (${syncProgress.processed}/${syncProgress.total})`}
            </span>
          </>
        ) : (
          <>
            <Check size={14} className="flex-shrink-0" />
            <span className="truncate text-xs">{syncMessage || 'Synced'}</span>
          </>
        )}
      </div>

      {isSyncing && syncProgress && (
        <div className="flex-shrink-0 w-16 h-1 bg-white/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-300"
            style={{ width: `${(syncProgress.processed / syncProgress.total) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
};







