/**
 * AutoReminderService
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs once per day (on app open). If auto-reminder is enabled in settings it:
 *   1. Fetches ledger + transactions from Firestore.
 *   2. Finds all customers who have outstanding dues older than `reminderDays`.
 *   3. On Android: fires a local notification summarising overdue parties.
 *      Tapping the notification navigates to the Pending Dues view.
 *   4. In the browser: no-op (WhatsApp must be user-initiated per browser policy).
 *
 * State is persisted in localStorage so the check only runs once per calendar day.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Capacitor } from '@capacitor/core';
import { ApiService } from './api';

const LAST_RUN_KEY   = 'auto_reminder_last_run';
const NOTIF_ID       = 9001;

interface ReminderSettings {
  auto_reminder_enabled?: boolean;
  auto_reminder_days?: number;
}

interface OverdueParty {
  name: string;
  phone: string;
  totalDue: number;
  maxDaysOld: number;
}

export const AutoReminderService = {
  /**
   * Main entry point. Call after user is authenticated and settings are loaded.
   * @param uid            Firebase UID of the active firm owner
   * @param settings       The automation section of AppSettings
   * @param onNavigate     Callback to navigate to 'pending' tab when notification tapped
   */
  async checkAndSchedule(
    uid: string,
    settings: ReminderSettings,
    onNavigate?: () => void,
  ): Promise<void> {
    if (!uid) return;
    if (!settings?.auto_reminder_enabled) return;

    const reminderDays = Number(settings.auto_reminder_days ?? 15);

    // Throttle: only check once per calendar day
    const today   = new Date().toISOString().split('T')[0];
    const lastRun = localStorage.getItem(LAST_RUN_KEY);
    if (lastRun === today) return;
    localStorage.setItem(LAST_RUN_KEY, today);

    try {
      const [ledgerSnap, txnSnap] = await Promise.all([
        ApiService.getAll(uid, 'ledger_entries'),
        ApiService.getAll(uid, 'transactions'),
      ]);

      const ledger       = ledgerSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      const transactions = txnSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

      // Build a received-payment map keyed by bill/invoice number
      const paidByBill: Record<string, number> = {};
      transactions.forEach((t: any) => {
        if (t.type === 'received' && t.bill_no) {
          paidByBill[t.bill_no] = (paidByBill[t.bill_no] || 0) + Number(t.amount || 0);
        }
      });

      // Aggregate outstanding balances per party
      const partyMap: Record<string, OverdueParty> = {};
      const nowMs = Date.now();

      ledger.forEach((entry: any) => {
        if (entry.type !== 'sell') return;
        const total   = Number(entry.total_amount || 0);
        const paid    = paidByBill[entry.invoice_no] || 0;
        const balance = total - paid;
        if (balance <= 0) return;

        const entryMs  = new Date(entry.date).getTime();
        const daysOld  = Math.floor((nowMs - entryMs) / 86_400_000);
        if (daysOld < reminderDays) return;

        const key = entry.party_name || 'Unknown';
        if (!partyMap[key]) {
          partyMap[key] = {
            name:       key,
            phone:      entry.party_phone || '',
            totalDue:   0,
            maxDaysOld: 0,
          };
        }
        partyMap[key].totalDue   += balance;
        partyMap[key].maxDaysOld  = Math.max(partyMap[key].maxDaysOld, daysOld);
        if (!partyMap[key].phone && entry.party_phone) {
          partyMap[key].phone = entry.party_phone;
        }
      });

      const overdue = Object.values(partyMap);
      if (overdue.length === 0) return;

      if (Capacitor.isNativePlatform()) {
        await AutoReminderService._scheduleNotification(overdue, reminderDays, onNavigate);
      }
      // Web: no silent-send allowed; UI in PendingView already handles this.
    } catch (e) {
      console.warn('[AutoReminder] check failed:', e);
    }
  },

  /** Returns the current list of overdue parties for in-app display (no notifications). */
  async getOverdueParties(
    uid: string,
    reminderDays: number,
  ): Promise<OverdueParty[]> {
    try {
      const [ledgerSnap, txnSnap] = await Promise.all([
        ApiService.getAll(uid, 'ledger_entries'),
        ApiService.getAll(uid, 'transactions'),
      ]);
      const ledger       = ledgerSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      const transactions = txnSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

      const paidByBill: Record<string, number> = {};
      transactions.forEach((t: any) => {
        if (t.type === 'received' && t.bill_no) {
          paidByBill[t.bill_no] = (paidByBill[t.bill_no] || 0) + Number(t.amount || 0);
        }
      });

      const partyMap: Record<string, OverdueParty> = {};
      const nowMs = Date.now();
      ledger.forEach((entry: any) => {
        if (entry.type !== 'sell') return;
        const balance = Number(entry.total_amount || 0) - (paidByBill[entry.invoice_no] || 0);
        if (balance <= 0) return;
        const daysOld = Math.floor((nowMs - new Date(entry.date).getTime()) / 86_400_000);
        if (daysOld < reminderDays) return;
        const key = entry.party_name || 'Unknown';
        if (!partyMap[key]) partyMap[key] = { name: key, phone: entry.party_phone || '', totalDue: 0, maxDaysOld: 0 };
        partyMap[key].totalDue   += balance;
        partyMap[key].maxDaysOld  = Math.max(partyMap[key].maxDaysOld, daysOld);
      });
      return Object.values(partyMap);
    } catch (e) {
      console.warn('[AutoReminder] getOverdueParties failed:', e);
      return [];
    }
  },

  /** Schedule the Android local notification. */
  async _scheduleNotification(
    overdue: OverdueParty[],
    reminderDays: number,
    onNavigate?: () => void,
  ): Promise<void> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') return;

      // Register listener ONCE — navigate to pending view when tapped
      LocalNotifications.removeAllListeners().then(() => {
        LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
          if (action.notification?.extra?.action === 'pending_view') {
            onNavigate?.();
          }
        });
      });

      const names     = overdue.slice(0, 3).map(p => p.name).join(', ');
      const extra     = overdue.length > 3 ? ` +${overdue.length - 3} more` : '';
      const totalDue  = overdue.reduce((s, p) => s + p.totalDue, 0);
      const fmtAmt    = totalDue.toLocaleString('en-IN');

      await LocalNotifications.schedule({
        notifications: [{
          id:       NOTIF_ID,
          title:    `\uD83D\uDCB0 Payment Reminder — ${overdue.length} Customer${overdue.length > 1 ? 's' : ''}`,
          body:     `${names}${extra} have dues \u20B9${fmtAmt} pending for ${reminderDays}+ days. Tap to send reminders.`,
          schedule: { at: new Date(Date.now() + 3_000) },
          extra:    { action: 'pending_view' },
          actionTypeId: '',
        }],
      });
    } catch (e) {
      console.warn('[AutoReminder] notification scheduling failed:', e);
    }
  },

  /** Force-reset the daily throttle (useful after settings change). */
  resetThrottle(): void {
    localStorage.removeItem(LAST_RUN_KEY);
  },
};
