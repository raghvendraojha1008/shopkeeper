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
      icon: AlertTriangle, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)',
      title: `${lowStockItems.length} items low on stock`,
      sub: lowStockItems.slice(0,2).map(i => i.name).join(', ') + (lowStockItems.length > 2 ? ` +${lowStockItems.length-2}` : ''),
      action: isNative ? 'Alert tomorrow 9 AM' : null,
    },
    pendingReceivable > 0 && topPendingParty && {
      icon: Clock, color: '#f87171', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.22)',
      title: `₹${pendingReceivable.toLocaleString('en-IN')} receivable pending`,
      sub: overdueDays > 0 ? `${topPendingParty} — ${overdueDays}d overdue` : `From ${topPendingParty}`,
      action: isNative ? 'Send reminder' : null,
    },
    todaySales > 0 && {
      icon: TrendingDown, color: '#818cf8', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.22)',
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
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.09)',
      backdropFilter: 'blur(20px)'
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5" style={{borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{background:'rgba(139,92,246,0.15)'}}>
            <Bell size={13} style={{color:'#a78bfa'}}/>
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
              className="text-[9px] font-bold px-2.5 py-1 rounded-full transition-all active:scale-90"
              style={{
                background: scheduled ? 'rgba(16,185,129,0.2)' : 'rgba(139,92,246,0.2)',
                color: scheduled ? '#34d399' : '#a78bfa',
                border: scheduled ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(139,92,246,0.3)'
              }}
            >
              {scheduled ? <CheckCircle2 size={10} className="inline mr-1"/> : null}
              {scheduling ? 'Scheduling…' : scheduled ? 'Scheduled!' : 'Schedule All'}
            </button>
          )}
          {onDismiss && (
            <button onClick={onDismiss} className="p-1 rounded-full" style={{color:'rgba(148,163,184,0.4)'}}>
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
                <div className="text-xs font-bold truncate" style={{color:'rgba(240,244,255,0.9)'}}>
                  {rem.title}
                </div>
                <div className="text-[9px] font-semibold truncate" style={{color:'rgba(148,163,184,0.55)'}}>
                  {rem.sub}
                </div>
              </div>
              {rem.action && isNative && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{background:'rgba(255,255,255,0.06)', color:rem.color}}>
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






