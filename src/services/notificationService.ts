import { Capacitor } from '@capacitor/core';

export interface ReminderItem {
  id: number;
  title: string;
  body: string;
  scheduleAt?: Date;
}

export class NotificationService {
  static async requestPermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const result = await LocalNotifications.requestPermissions();
      return result.display === 'granted';
    } catch (e) {
      console.warn('Notifications not available:', e);
      return false;
    }
  }

  static async schedule(items: ReminderItem[]): Promise<void> {
    if (!Capacitor.isNativePlatform() || items.length === 0) return;
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const granted = await NotificationService.requestPermission();
      if (!granted) return;

      await LocalNotifications.schedule({
        notifications: items.map(item => ({
          id: item.id,
          title: item.title,
          body: item.body,
          schedule: item.scheduleAt ? { at: item.scheduleAt } : undefined,
          sound: undefined,
          attachments: undefined,
          actionTypeId: '',
          extra: null,
        }))
      });
    } catch (e) {
      console.warn('Failed to schedule notifications:', e);
    }
  }

  static async cancelAll(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications });
      }
    } catch (e) {
      console.warn('Failed to cancel notifications:', e);
    }
  }

  static async scheduleLowStockAlert(lowStockItems: any[]): Promise<void> {
    if (!Capacitor.isNativePlatform() || lowStockItems.length === 0) return;
    const names = lowStockItems.slice(0, 3).map((i: any) => i.name).join(', ');
    const extra = lowStockItems.length > 3 ? ` +${lowStockItems.length - 3} more` : '';
    await NotificationService.schedule([{
      id: 1001,
      title: '⚠️ Low Stock Alert',
      body: `${names}${extra} are running low`,
    }]);
  }

  static _getOrAssignNotificationId(partyId: string): number {
    const MAP_KEY = 'notif_id_map_v1';
    let map: Record<string, number> = {};
    try { map = JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); } catch {}
    if (map[partyId] !== undefined) return map[partyId];
    const usedIds = Object.values(map);
    let nextId = 10000;
    while (usedIds.includes(nextId)) nextId++;
    map[partyId] = nextId;
    try { localStorage.setItem(MAP_KEY, JSON.stringify(map)); } catch {}
    return nextId;
  }

  static async scheduleOverdueReminder(partyName: string, amount: number, daysOverdue: number, partyId?: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const stableKey = partyId || partyName;
    const notifId = NotificationService._getOrAssignNotificationId(stableKey);
    await NotificationService.schedule([{
      id: notifId,
      title: '💰 Payment Due',
      body: `${partyName} owes ₹${amount.toLocaleString('en-IN')} — ${daysOverdue} days overdue`,
    }]);
  }

  static async scheduleDailySummary(sales: number, expenses: number): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const tomorrow2am = new Date();
    tomorrow2am.setDate(tomorrow2am.getDate() + 1);
    tomorrow2am.setHours(8, 0, 0, 0);

    await NotificationService.schedule([{
      id: 2001,
      title: '📊 Daily Summary',
      body: `Sales: ₹${sales.toLocaleString('en-IN')} | Expenses: ₹${expenses.toLocaleString('en-IN')}`,
      scheduleAt: tomorrow2am,
    }]);
  }
}
