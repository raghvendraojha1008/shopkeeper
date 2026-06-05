import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../context/AuthContext';
import { SyncQueueService } from '../services/syncQueue';
import { OfflineSyncService } from '../services/offlineSyncService';
import { invalidateAll } from '../context/DataContext';

interface OnlineStatus {
  isOnline: boolean;
  wasOffline: boolean;
  lastOnline: Date | null;
}

export function useOnlineStatus() {
  const [status, setStatus] = useState<OnlineStatus>({
    isOnline: navigator.onLine,
    wasOffline: false,
    lastOnline: navigator.onLine ? new Date() : null,
  });

  const handleOnline = useCallback(() => {
    setStatus(prev => ({
      isOnline: true,
      wasOffline: !prev.isOnline,
      lastOnline: new Date(),
    }));
  }, []);

  const handleOffline = useCallback(() => {
    setStatus(prev => ({ ...prev, isOnline: false }));
  }, []);

  useEffect(() => {
    // Web: use standard browser online/offline events
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    // Native (Android/iOS): @capacitor/network gives reliable connectivity info
    // because navigator.onLine is often stuck at "true" inside a WebView.
    let capNetworkCleanup: (() => void) | null = null;
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/network').then(({ Network }) => {
        // Read current state immediately to correct the initial value
        Network.getStatus().then(s => {
          if (s.connected !== status.isOnline) {
            s.connected ? handleOnline() : handleOffline();
          }
        }).catch(() => {});

        // Subscribe to future changes
        Network.addListener('networkStatusChange', s => {
          s.connected ? handleOnline() : handleOffline();
        }).then(handle => {
          capNetworkCleanup = () => handle.remove();
        }).catch(() => {});
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      capNetworkCleanup?.();
    };
  }, [handleOnline, handleOffline]);

  return status;
}

// Hook to show sync status indicator with auto-sync
export function useSyncStatus() {
  const { user } = useAuth();
  const { isOnline, wasOffline } = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);
  // FIX: track the message clear timer so we can cancel it on unmount
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to BOTH queue systems so the badge reflects every pending
  // offline item — OfflineSyncService (advanced queue) and SyncQueueService
  // (simpler queue used by POS / ManualEntry offline paths).
  useEffect(() => {
    const refresh = () => {
      setQueueCount(
        OfflineSyncService.getPendingCount(user?.uid) +
        SyncQueueService.getUserQueue(user?.uid ?? '').length,
      );
    };

    refresh();
    const unsubOSS = OfflineSyncService.subscribe(refresh);
    const unsubSQS = SyncQueueService.subscribe(refresh);
    return () => { unsubOSS(); unsubSQS(); };
  }, [user?.uid]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (!wasOffline || !isOnline || !user) return;

    const performSync = async () => {
      setIsSyncing(true);
      setSyncMessage('Syncing data...');

      try {
        const result = await SyncQueueService.processQueue(
          user.uid,
          (processed: number, total: number) => {
            setSyncProgress({ processed, total });
          },
        );

        if (result.success > 0) {
          invalidateAll(user.uid);
          setSyncMessage(`Synced ${result.success} items`);
        } else if (result.failed > 0) {
          setSyncMessage(`Synced ${result.success}, ${result.failed} failed`);
        } else {
          setSyncMessage('All data synced');
        }
      } catch (error) {
        console.error('[useSyncStatus] Sync error:', error);
        setSyncMessage('Sync failed, will retry');
      } finally {
        setIsSyncing(false);
        setSyncProgress(null);

        // FIX: The old code returned the timer cleanup from inside an async
        // function — React ignores that return value, so the timer was never
        // cleared.  Store the timer in a ref and clear it in the effect cleanup.
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setSyncMessage(null), 3000);
      }
    };

    performSync();

    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [isOnline, wasOffline, user]);

  return {
    isOnline,
    isSyncing,
    syncMessage,
    queueCount,
    syncProgress,
  };
}

// Separate hook for manual sync control
export function useSyncControl() {
  const { user } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to both queue systems (same fix as useSyncStatus above).
  useEffect(() => {
    const refresh = () => setQueueCount(
      OfflineSyncService.getPendingCount(user?.uid) +
      SyncQueueService.getUserQueue(user?.uid ?? '').length,
    );
    refresh();
    const unsubOSS = OfflineSyncService.subscribe(refresh);
    const unsubSQS = SyncQueueService.subscribe(refresh);
    return () => { unsubOSS(); unsubSQS(); };
  }, [user?.uid]);

  const syncNow = useCallback(async () => {
    if (!user || isSyncing) return;

    setIsSyncing(true);
    setSyncMessage('Syncing...');

    try {
      const result = await SyncQueueService.processQueue(
        user.uid,
        (processed: number, total: number) => {
          setSyncProgress({ processed, total });
        },
      );

      if (result.success > 0) {
        invalidateAll(user.uid);
        setSyncMessage(`Synced: ${result.success} ✓ ${result.failed > 0 ? result.failed + ' ✗' : ''}`);
      } else if (result.failed > 0) {
        setSyncMessage(`Synced: 0 ✓ ${result.failed} ✗`);
      } else {
        setSyncMessage('No items to sync');
      }
    } catch (error) {
      console.error('[useSyncControl] Sync error:', error);
      setSyncMessage('Sync failed');
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
      // FIX: Same timer-ref pattern
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setSyncMessage(null), 3000);
    }
  }, [user, isSyncing]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  return {
    isSyncing,
    syncMessage,
    syncProgress,
    syncNow,
    queueCount,
  };
}

