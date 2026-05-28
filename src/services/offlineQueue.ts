import { Capacitor } from '@capacitor/core';
import { OfflineCommand } from '../types/models';
import { SyncLock } from './syncLock';

const STORAGE_KEY = 'offline_commands_queue';
const MAX_RETRIES = 3;

export const OfflineQueueService = {
  // Get all pending commands
  getQueue: (): OfflineCommand[] => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  // Add command to queue
  enqueue: async (text: string, file?: File): Promise<string> => {
    const id = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let fileData: OfflineCommand['file'] | undefined;
    if (file) {
      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const base64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res((reader.result as string).split(',')[1]);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        const nativePath = `offline_queue/${id}_${file.name}`;
        await Filesystem.writeFile({ path: nativePath, data: base64, directory: Directory.Cache });
        fileData = { name: file.name, type: file.type, nativePath };
      } else {
        const base64 = await new Promise<string>((res) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result as string);
          reader.readAsDataURL(file);
        });
        fileData = { name: file.name, type: file.type, data: base64 };
      }
    }

    const command: OfflineCommand = {
      id,
      text,
      file: fileData,
      timestamp: Date.now(),
      status: 'pending',
      retries: 0,
    };

    const queue = OfflineQueueService.getQueue();
    queue.push(command);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));

    return id;
  },

  // Update command status
  updateStatus: (id: string, status: OfflineCommand['status'], incrementRetry = false) => {
    const queue = OfflineQueueService.getQueue();
    const updated = queue.map(cmd => {
      if (cmd.id === id) {
        return {
          ...cmd,
          status,
          retries: incrementRetry ? cmd.retries + 1 : cmd.retries,
        };
      }
      return cmd;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  },

  // Remove command from queue
  remove: (id: string) => {
    const queue = OfflineQueueService.getQueue();
    const filtered = queue.filter(cmd => cmd.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  },

  // Get pending commands count
  getPendingCount: (): number => {
    return OfflineQueueService.getQueue().filter(c => c.status === 'pending').length;
  },

  // Check if we're online
  isOnline: (): boolean => {
    return navigator.onLine;
  },

  // Process queue when online (guarded by SyncLock to prevent concurrent runs)
  processQueue: async (
    processor: (text: string, file: File | null) => Promise<any[]>,
    onSuccess: (commands: any[]) => Promise<void>
  ) => {
    if (!OfflineQueueService.isOnline()) return;
    if (!SyncLock.acquire()) return; // already running elsewhere

    try {
      const queue = OfflineQueueService.getQueue();
      const pending = queue.filter(c => c.status === 'pending' && c.retries < MAX_RETRIES);

      for (const cmd of pending) {
        OfflineQueueService.updateStatus(cmd.id, 'processing');

        try {
          let file: File | null = null;
          if (cmd.file) {
            if (cmd.file.nativePath && Capacitor.isNativePlatform()) {
              const { Filesystem, Directory } = await import('@capacitor/filesystem');
              const result = await Filesystem.readFile({ path: cmd.file.nativePath, directory: Directory.Cache });
              const base64 = typeof result.data === 'string' ? result.data : '';
              const blob = await fetch(`data:${cmd.file.type};base64,${base64}`).then(r => r.blob());
              file = new File([blob], cmd.file.name, { type: cmd.file.type });
              await Filesystem.deleteFile({ path: cmd.file.nativePath, directory: Directory.Cache }).catch(() => {});
            } else if (cmd.file.data) {
              const response = await fetch(cmd.file.data);
              const blob = await response.blob();
              file = new File([blob], cmd.file.name, { type: cmd.file.type });
            }
          }

          const result = await processor(cmd.text, file);
          await onSuccess(result);
          OfflineQueueService.remove(cmd.id);
        } catch (error) {
          console.error('Queue processing error:', error);
          OfflineQueueService.updateStatus(cmd.id, 'pending', true);
        }
      }
    } finally {
      SyncLock.release();
    }
  },

  // Setup online listener
  setupOnlineListener: (callback: () => void) => {
    window.addEventListener('online', callback);
    return () => window.removeEventListener('online', callback);
  },
};







