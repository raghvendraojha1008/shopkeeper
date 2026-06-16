/**
 * RecurringService — Auto-creates scheduled transactions.
 * Runs once per calendar day on app open (after login).
 * Templates are stored in Firestore: users/{uid}/recurring_templates
 */
import { collection, addDoc, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { NotificationService } from './notificationService';

const LAST_RUN_KEY = 'recurring_last_run';

export interface RecurringTemplate {
  id?: string;
  userId: string;
  type: 'received' | 'paid';
  party_name: string;
  amount: number;
  payment_mode?: string;
  payment_purpose?: string;
  notes?: string;
  interval: 'daily' | 'weekly' | 'monthly';
  nextDue: string;
  isActive: boolean;
  createdAt: string;
}

export function advanceDate(dateStr: string, interval: 'daily' | 'weekly' | 'monthly'): string {
  const d = new Date(dateStr);
  if (interval === 'daily')   d.setDate(d.getDate() + 1);
  if (interval === 'weekly')  d.setDate(d.getDate() + 7);
  if (interval === 'monthly') d.setMonth(d.getMonth() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const RecurringService = {
  _col: (uid: string) => collection(db, 'users', uid, 'recurring_templates'),

  async getAll(uid: string): Promise<RecurringTemplate[]> {
    try {
      const snap = await getDocs(this._col(uid));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as RecurringTemplate));
    } catch {
      return [];
    }
  },

  async create(
    uid: string,
    template: Omit<RecurringTemplate, 'id' | 'userId' | 'createdAt' | 'isActive'>,
  ): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const ref = await addDoc(this._col(uid), {
      ...template,
      userId: uid,
      isActive: true,
      createdAt: today,
    });
    return ref.id;
  },

  async checkAndProcess(uid: string): Promise<void> {
    if (!uid) return;

    const today = new Date().toISOString().split('T')[0];
    const lastRun = localStorage.getItem(LAST_RUN_KEY);
    if (lastRun === today) return;
    localStorage.setItem(LAST_RUN_KEY, today);

    try {
      const templates = await this.getAll(uid);
      const due = templates.filter(t => t.isActive && t.nextDue <= today);
      if (due.length === 0) return;

      const txnCol = collection(db, 'users', uid, 'transactions');
      const created: string[] = [];

      for (const tmpl of due) {
        await addDoc(txnCol, {
          date: today,
          type: tmpl.type,
          party_name: tmpl.party_name,
          amount: tmpl.amount,
          payment_mode: tmpl.payment_mode || 'Cash',
          payment_purpose: tmpl.payment_purpose || '',
          notes: tmpl.notes ? `[Recurring] ${tmpl.notes}` : '[Recurring]',
          created_at: new Date().toISOString(),
          source: 'recurring',
        });

        await updateDoc(doc(db, 'users', uid, 'recurring_templates', tmpl.id!), {
          nextDue: advanceDate(today, tmpl.interval),
        });

        const sign = tmpl.type === 'received' ? '+' : '-';
        created.push(`${sign}₹${Number(tmpl.amount).toLocaleString('en-IN')} — ${tmpl.party_name}`);
      }

      if (created.length > 0) {
        await NotificationService.schedule([{
          id: 9998,
          title: `${created.length} Recurring Transaction${created.length > 1 ? 's' : ''} Created`,
          body: created.slice(0, 3).join(', ') + (created.length > 3 ? ` +${created.length - 3} more` : ''),
        }]);
      }
    } catch (e) {
      console.warn('[RecurringService] checkAndProcess error:', e);
    }
  },
};
