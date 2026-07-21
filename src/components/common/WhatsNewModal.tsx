/**
 * WhatsNewModal — shown once per app version per user.
 * Storage key: `wnm_seen_{uid}_{version}` in localStorage.
 * Dismissing marks it permanently seen for that version.
 */

import React, { useEffect, useState } from 'react';
import { Sparkles, X, Check, Shield, Zap, Bell, CreditCard, Lock, FileText, Star } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { APP_VERSION } from '../../constants/appVersion';

interface WhatsNewItem {
  icon: React.ElementType;
  color: string;
  bg: string;
  title: string;
  desc: string;
}

const WHATS_NEW: WhatsNewItem[] = [
  {
    icon: Lock,
    color: "var(--col-violet)",
    bg: 'var(--col-violet-15)',
    title: 'PIN Reset via Re-Authentication',
    desc: 'Forgot your lock PIN? Verify with Google or your account password to reset it instantly — no email needed.',
  },
  {
    icon: Bell,
    color: "var(--col-warning)",
    bg: 'var(--col-warning-15)',
    title: 'Smarter Email Verification Banner',
    desc: 'Email verification reminder now shows at most once a week and disappears permanently after 3 dismissals.',
  },
  {
    icon: CreditCard,
    color: "var(--col-success)",
    bg: 'var(--col-emerald-15)',
    title: 'Subscription & Payment Fixes',
    desc: 'Razorpay payment flow is now fully connected. Pay securely with UPI, Card, Netbanking, EMI & Wallet.',
  },
  {
    icon: Zap,
    color: "var(--col-info)",
    bg: 'var(--col-info-15)',
    title: 'Backend Health Indicator',
    desc: 'Subscription page now shows whether the payment backend is reachable before you try to pay.',
  },
  {
    icon: Shield,
    color: "var(--col-danger)",
    bg: 'var(--col-danger-15)',
    title: 'Insight PIN Grace Period',
    desc: 'Re-opening the Profit Insight view within 5 minutes no longer asks for your PIN again.',
  },
  {
    icon: FileText,
    color: "var(--col-slate)",
    bg: 'var(--text-muted)',
    title: 'PDF Symbol Fix',
    desc: 'Rupee symbol in exported invoices and PDFs now renders correctly as "Rs." on all devices.',
  },
  {
    icon: Star,
    color: "var(--col-pink)",
    bg: 'rgba(244,114,182,0.15)',
    title: 'New Settings Controls',
    desc: 'Added invoice print format, dashboard privacy mode, default payment mode, auto-lock timer and more.',
  },
];

function seenKey(uid: string, version: string): string {
  return `wnm_seen_${uid}_${version}`;
}

export const WhatsNewModal: React.FC = () => {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const key = seenKey(user.uid, APP_VERSION);
    if (!localStorage.getItem(key)) {
      // Small delay so other modals / auth screens can settle first
      const t = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(t);
    }
  }, [user?.uid]);

  const handleDismiss = () => {
    if (user?.uid) {
      localStorage.setItem(seenKey(user.uid, APP_VERSION), '1');
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9500] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'var(--rgba-black-85)', backdropFilter: 'blur(16px)' }}
    >
      <div
        className="w-full max-w-[360px] rounded-[28px] flex flex-col overflow-hidden"
        style={{
          background: 'var(--modal-bg)',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 32px 80px var(--rgba-black-70)',
          maxHeight: '88vh',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
          <div
            className="w-11 h-11 rounded-[16px] flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(145deg,#6366f1,#8b5cf6)',
              boxShadow: '0 8px 24px var(--col-accent-45)',
            }}
          >
            <Sparkles size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-app-xs font-black uppercase tracking-[0.2em]" style={{ color: 'rgba(167,139,250,0.7)' }}>
              Version {APP_VERSION}
            </p>
            <h2 className="text-base font-black" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              What&apos;s New
            </h2>
          </div>
          <button
            onClick={handleDismiss}
            className="p-2 rounded-full shrink-0"
            style={{ background: 'var(--rgba-white-07)' }}
          >
            <X size={15} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Feature list */}
        <div className="overflow-y-auto flex-1 px-4 pb-3 space-y-2.5">
          {WHATS_NEW.map((item, i) => {
            const Icon = item.icon;
            return (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-[16px]"
                style={{ background: 'var(--rgba-white-03)', border: '1px solid var(--glass-border)' }}
              >
                <div
                  className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: item.bg }}
                >
                  <Icon size={16} style={{ color: item.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-app-lg font-black leading-tight" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
                  <p className="text-app-sm mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="px-4 pb-5 pt-3 shrink-0">
          <button
            onClick={handleDismiss}
            className="w-full py-3.5 rounded-[18px] font-black text-app-2xl text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            style={{
              background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
              boxShadow: '0 8px 28px var(--col-accent-40)',
            }}
          >
            <Check size={16} />
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhatsNewModal;
