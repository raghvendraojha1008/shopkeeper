// MODULE 5 — Last-backup tracker.
// Single source of truth for "When did we last back up?" across every backup
// path the app has (web JSON download, native auto-backup, native manual
// "Backup Now"). Stores an ISO timestamp per user in localStorage with a
// sessionStorage fallback for locked-down browsers (Safari private, etc).
//
// Why a separate util? autoBackup.ts already keeps a date-only string
// (`last_auto_backup_date_${userId}`) but that's:
//   • date-granularity only (can't show "2:30 PM")
//   • native-only (web JSON downloads don't update it)
//   • not subscribable (UI can't refresh after a backup runs)
// This util fixes all three.

const KEY_PREFIX = 'last_backup_at_';

export type BackupSource = 'auto' | 'manual-device' | 'manual-json';

interface BackupRecord {
  timestamp: string; // ISO
  source: BackupSource;
}

// In-process subscriber list so the UI can re-render after a backup runs
// in the same tab without polling.
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach(fn => { try { fn(); } catch (_) {} });

const safeRead = (key: string): string | null => {
  try { return localStorage.getItem(key); }
  catch (_) {
    try { return sessionStorage.getItem(key); }
    catch (__) { return null; }
  }
};
const safeWrite = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); }
  catch (_) {
    try { sessionStorage.setItem(key, value); }
    catch (__) {}
  }
};

export const LastBackupTracker = {
  /**
   * Record that a backup just succeeded. Call this from EVERY backup path
   * (auto-backup, web JSON download, native device backup) so the UI's
   * "Last backup" display stays accurate regardless of which path ran.
   */
  markCompleted(userId: string, source: BackupSource): void {
    if (!userId) return;
    const record: BackupRecord = { timestamp: new Date().toISOString(), source };
    safeWrite(KEY_PREFIX + userId, JSON.stringify(record));
    notify();
  },

  /**
   * Returns the most recent backup record for the user, or null if no
   * backup has ever been recorded. Tolerates legacy values that are just
   * a bare ISO string (no JSON wrapper) so an early-tester install
   * doesn't lose its history.
   */
  get(userId: string): BackupRecord | null {
    if (!userId) return null;
    const raw = safeRead(KEY_PREFIX + userId);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.timestamp === 'string') return parsed as BackupRecord;
      // Legacy: a bare ISO string written by an older version
      if (typeof parsed === 'string') return { timestamp: parsed, source: 'auto' };
    } catch (_) {
      // Bare string (not JSON) — treat as legacy ISO
      if (raw.length > 10 && raw.includes('T')) return { timestamp: raw, source: 'auto' };
    }
    return null;
  },

  /**
   * Subscribe to changes. Returns an unsubscribe fn. Call from a useEffect
   * inside the LastBackupCard so it re-reads after any backup completes.
   */
  subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  },

  /**
   * Friendly relative-time formatter. Examples:
   *   "Just now"
   *   "5 minutes ago"
   *   "Today 2:30 PM"
   *   "Yesterday 11:42 AM"
   *   "3 days ago"
   *   "12 Apr, 2026"
   *   "Never"
   */
  formatRelative(record: BackupRecord | null): string {
    if (!record) return 'Never';
    const date = new Date(record.timestamp);
    if (isNaN(date.getTime())) return 'Never';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    const timeStr = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;

    // Same calendar day
    const isSameDay = date.toDateString() === now.toDateString();
    if (isSameDay) return `Today ${timeStr}`;

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${timeStr}`;

    // Within the last week — show "N days ago" for quick scanning
    if (diffHr < 24 * 7) {
      const days = Math.floor(diffHr / 24);
      return `${days} day${days === 1 ? '' : 's'} ago`;
    }

    // Older — show explicit date
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  },
};
