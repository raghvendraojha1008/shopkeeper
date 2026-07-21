import React, { useState, useEffect } from 'react';
import { Bell, BellOff, AlertTriangle, Clock, TrendingDown, CheckCircle2, X } from 'lucide-react';
import { NotificationService } from '../../services/notificationService';
import { Capacitor } from '@capacitor/core';

interface SmartRemindersWidgetProps {
  lowStockItems: any[];
  todaySales: number;
  todayExpenses: number;
  pendingReceivable: number;
  overdueDays?: number;
  topPendingParty?: string;
  onDismiss?: () => void;
}

const SmartRemindersWidget: React.FC<SmartRemindersWidgetProps> = ({
  lowStockItems, todaySales, todayExpenses, pendingReceivable,
  overdueDays = 0, topPendingParty = '', onDismiss
}) => {
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  const reminders = [
    lowStockItems.length > 0 && {
      icon: AlertTriangle, color: "var(--col-amber)", bg: 'var(--col-warning-12)', border: 'var(--col-warning-25)',
      title: `${lowStockItems.length} items low on stock`,
      sub: lowStockItems.slice(0,2).map(i => i.name).join(', ') + (lowStockItems.length > 2 ? ` +${lowStockItems.length-2}` : ''),
      action: isNative ? 'Alert tomorrow 9 AM' : null,
    },
    pendingReceivable > 0 && topPendingParty && {
      icon: Clock, color: "var(--col-danger)", bg: 'var(--col-danger-15)', border: 'var(--col-danger-22)',
      title: `₹${pendingReceivable.toLocaleString('en-IN')} receivable pending`,
      sub: overdueDays > 0 ? `${topPendingParty} — ${overdueDays}d overdue` : `From ${topPendingParty}`,
      action: isNative ? 'Send reminder' : null,
    },
    todaySales > 0 && {
      icon: TrendingDown, color: "var(--col-indigo)", bg: 'var(--col-accent-15)', border: 'var(--col-accent-22)',
      title: `Today: ₹${todaySales.toLocaleString('en-IN')} sales`,
      sub: `Expenses ₹${todayExpenses.toLocaleString('en-IN')} — Net ₹${(todaySales - todayExpenses).toLocaleString('en-IN')}`,
      action: isNative ? 'Daily summary at 8 PM' : null,
    },
  ].filter(Boolean) as any[];

  const handleScheduleAll = async () => {
    setScheduling(true);
    try {
      if (lowStockItems.length > 0) {
        await NotificationService.scheduleLowStockAlert(lowStockItems);
      }
      if (todaySales > 0) {
        await NotificationService.scheduleDailySummary(todaySales, todayExpenses);
      }
      setScheduled(true);
      setTimeout(() => setScheduled(false), 3000);
    } finally {
      setScheduling(false);
    }
  };

  if (reminders.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl overflow-hidden" style={{
      background: 'var(--rgba-white-04)',
      border: '1px solid var(--glass-border)',
      backdropFilter: 'blur(20px)'
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5" style={{borderBottom:'1px solid var(--glass-border)'}}>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{background:'var(--col-violet-15)'}}>
            <Bell size={13} style={{color:"var(--col-violet)"}}/>
          </div>
          <span className="text-xs font-black uppercase tracking-wide" style={{color:'rgba(167,139,250,0.9)'}}>
            Smart Reminders
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isNative && (
            <button
              onClick={handleScheduleAll}
              disabled={scheduling}
              className="text-app-xs font-bold px-2.5 py-1 rounded-full transition-all active:scale-90"
              style={{
                background: scheduled ? 'var(--col-emerald-25)' : 'var(--col-violet-25)',
                color: scheduled ? "var(--col-success)" : "var(--col-violet)",
                border: scheduled ? '1px solid var(--col-emerald-35)' : '1px solid var(--col-violet-35)'
              }}
            >
              {scheduled ? <CheckCircle2 size={10} className="inline mr-1"/> : null}
              {scheduling ? 'Scheduling…' : scheduled ? 'Scheduled!' : 'Schedule All'}
            </button>
          )}
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded-full" style={{color: 'var(--text-muted)'}}>
              <X size={12}/>
            </button>
          )}
        </div>
      </div>

      {/* Reminder rows */}
      <div className="p-2 space-y-1.5">
        {reminders.map((rem, i) => {
          const Icon = rem.icon;
          return (
            <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl"
              style={{background: rem.bg, border:`1px solid ${rem.border}`}}>
              <div className="p-2 rounded-lg flex-shrink-0"
                style={{background:`${rem.bg}`}}>
                <Icon size={13} style={{color: rem.color}}/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate" style={{color: 'var(--text-primary)'}}>
                  {rem.title}
                </div>
                <div className="text-app-xs font-semibold truncate" style={{color: 'var(--text-muted)'}}>
                  {rem.sub}
                </div>
              </div>
              {rem.action && isNative && (
                <span className="text-app-2xs font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{background:'var(--rgba-white-06)', color:rem.color}}>
                  {rem.action}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SmartRemindersWidget;






