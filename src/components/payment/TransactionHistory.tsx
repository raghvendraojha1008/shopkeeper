/**
 * TransactionHistory — real-time timeline of subscription events.
 *
 * Reads subscription_logs/{logId} where userId == uid, ordered by timestamp desc.
 * Matches the admin panel audit trail exactly (same collection, same action values).
 *
 * Firestore index required (firestore.indexes.json):
 *   collection: subscription_logs
 *   fields: userId ASC, timestamp DESC
 */

import React, { useEffect, useState } from 'react';
import {
  collection, query, where, orderBy, limit, onSnapshot, Timestamp,
} from 'firebase/firestore';
import {
  CheckCircle2, AlertTriangle, Clock, Crown, Gift, RefreshCw,
  ArrowUpCircle, ArrowDownCircle, Shield, Zap, X,
} from 'lucide-react';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';

// ── Types ──────────────────────────────────────────────────────────────────────

interface LogEntry {
  id:            string;
  userId:        string;
  action:        string;
  previousState: Record<string, any> | null;
  newState:      Record<string, any>;
  performedBy:   'system' | 'admin';
  timestamp:     Timestamp | null;
}

// ── Action metadata ────────────────────────────────────────────────────────────

const ACTION_META: Record<string, {
  label:  string;
  icon:   React.ReactNode;
  color:  string;
  bg:     string;
}> = {
  payment_success:      { label: 'Payment Successful',   icon: <CheckCircle2 size={13} />, color: "var(--col-success)", bg: 'var(--col-success-12)'  },
  manual_payment:       { label: 'Manual Payment',        icon: <CheckCircle2 size={13} />, color: "var(--col-success)", bg: 'var(--col-success-12)'  },
  manual_payment_note:  { label: 'Payment Note',          icon: <CheckCircle2 size={13} />, color: "var(--col-success-light)", bg: 'var(--col-success-08)'  },
  trial_start:          { label: 'Trial Started',         icon: <Clock        size={13} />, color: "var(--col-violet)", bg: 'var(--col-accent-12)'  },
  grant:                { label: 'Subscription Granted',  icon: <Gift         size={13} />, color: "var(--col-success)", bg: 'var(--col-success-12)'  },
  upgrade:              { label: 'Plan Upgraded',         icon: <ArrowUpCircle size={13}/>, color: "var(--col-warning)", bg: 'var(--col-warning-12)'  },
  downgrade:            { label: 'Plan Downgraded',       icon: <ArrowDownCircle size={13}/>,color:"var(--col-danger)", bg: 'var(--col-danger-10)'   },
  extend:               { label: 'Subscription Extended', icon: <Crown        size={13} />, color: "var(--col-warning)", bg: 'var(--col-warning-12)'  },
  renewal:              { label: 'Subscription Renewed',  icon: <RefreshCw    size={13} />, color: "var(--col-success)", bg: 'var(--col-success-12)'  },
  renewal_failed:       { label: 'Renewal Failed',        icon: <AlertTriangle size={13}/>, color: "var(--col-danger)", bg: 'var(--col-danger-10)'   },
  auto_grace:           { label: 'Grace Period Started',  icon: <Shield       size={13} />, color: "var(--col-warning)", bg: 'var(--col-warning-12)'  },
  auto_expire:          { label: 'Subscription Expired',  icon: <X            size={13} />, color: "var(--col-danger)", bg: 'var(--col-danger-10)'   },
  cancel:               { label: 'Subscription Cancelled',icon: <X            size={13} />, color: "var(--col-danger)", bg: 'var(--col-danger-10)'   },
  admin_override:       { label: 'Admin Override',        icon: <Shield       size={13} />, color: "var(--col-violet)", bg: 'var(--col-accent-12)'  },
  admin_reset_trial:    { label: 'Trial Reset by Admin',  icon: <RefreshCw    size={13} />, color: "var(--col-violet)", bg: 'var(--col-accent-12)'  },
  payment_failed:       { label: 'Payment Failed',        icon: <AlertTriangle size={13}/>, color: "var(--col-danger)", bg: 'var(--col-danger-10)'   },
};

const FALLBACK_META = {
  label: 'Subscription Event',
  icon:  <Zap size={13} />,
  color: "var(--col-slate)",
  bg:    'var(--text-muted)',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTs(ts: Timestamp | null): string {
  if (!ts) return '—';
  try {
    const d = ts.toDate();
    return d.toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    }) + ' · ' + d.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return '—'; }
}

function planLabel(state: Record<string, any> | null): string {
  if (!state) return '';
  const id = state.planId ?? state.plan ?? '';
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : '';
}

function paymentMethodLabel(method: string | undefined): string {
  if (!method) return '';
  return ({
    upi:           'UPI',
    razorpay:      'Razorpay',
    bank_transfer: 'Bank Transfer',
    cash:          'Cash',
  }[method]) ?? method;
}

// ── TransactionHistory ────────────────────────────────────────────────────────

export const TransactionHistory: React.FC = () => {
  const { user }                     = useAuth();
  const [entries, setEntries]        = useState<LogEntry[]>([]);
  const [loading, setLoading]        = useState(true);

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }

    const q = query(
      collection(db, 'subscription_logs'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(25),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map(d => ({
          id:            d.id,
          ...(d.data() as Omit<LogEntry, 'id'>),
        })));
        setLoading(false);
      },
      () => { setLoading(false); },
    );

    return unsub;
  }, [user?.uid]);

  if (loading) {
    return (
      <div className="space-y-2 mt-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-[14px] p-3 animate-pulse"
            style={{ background: 'var(--rgba-white-03)', height: 64 }} />
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div className="rounded-[18px] px-4 py-6 text-center mt-4"
        style={{ background: 'var(--rgba-white-02)', border: '1px solid var(--glass-border)' }}>
        <Zap size={18} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
        <p className="text-app-md" style={{ color: 'var(--text-muted)' }}>
          No subscription events yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-1">
      {entries.map((entry, idx) => {
        const meta       = ACTION_META[entry.action] ?? FALLBACK_META;
        const newPlan    = planLabel(entry.newState);
        const prevPlan   = planLabel(entry.previousState);
        const payMethod  = paymentMethodLabel(entry.newState?.paymentMethod);
        const paymentId  = entry.newState?.paymentId as string | undefined;
        const isFirst    = idx === 0;

        return (
          <div key={entry.id} className="relative flex gap-3">
            {/* Timeline line */}
            {idx < entries.length - 1 && (
              <div className="absolute left-[19px] top-10 bottom-0 w-px"
                style={{ background: 'var(--rgba-white-05)' }} />
            )}

            {/* Icon bubble */}
            <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center z-10"
              style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}22` }}>
              {meta.icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 rounded-[14px] px-3 py-2.5"
              style={{
                background: isFirst ? 'var(--rgba-white-04)' : 'var(--rgba-white-02)',
                border: `1px solid ${isFirst ? 'var(--rgba-white-08)' : 'var(--rgba-white-04)'}`,
              }}>

              <div className="flex items-start justify-between gap-2 flex-wrap">
                <p className="text-app-md font-black" style={{ color: meta.color }}>
                  {meta.label}
                </p>
                <p className="text-app-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  {formatTs(entry.timestamp)}
                </p>
              </div>

              {/* Plan transition */}
              {newPlan && (
                <p className="text-app-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>
                  {prevPlan && prevPlan !== newPlan
                    ? `${prevPlan} → ${newPlan}`
                    : newPlan + ' Plan'}
                </p>
              )}

              {/* Payment method + ID */}
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                {payMethod && (
                  <span className="text-app-xs font-bold px-1.5 py-0.5 rounded-md"
                    style={{ background: 'var(--rgba-white-06)', color: 'var(--text-muted)' }}>
                    {payMethod}
                  </span>
                )}
                {paymentId && (
                  <span className="text-app-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {paymentId.length > 20 ? paymentId.slice(0, 20) + '…' : paymentId}
                  </span>
                )}
                {entry.performedBy === 'admin' && (
                  <span className="text-app-xs font-bold px-1.5 py-0.5 rounded-md"
                    style={{ background: 'rgba(167,139,250,0.1)', color: "var(--col-violet)" }}>
                    Admin action
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
