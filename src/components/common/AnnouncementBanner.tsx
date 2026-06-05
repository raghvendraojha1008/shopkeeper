/**
 * AnnouncementBanner — real-time dismissible banners from the admin panel.
 *
 * Uses an `onSnapshot` listener so new/updated/removed announcements from
 * the Super Admin Panel appear instantly without a page reload.
 * Dismissal is stored in sessionStorage (per session, not permanent).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Info, AlertTriangle, CheckCircle, Wrench, X } from 'lucide-react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';

// ── Types ──────────────────────────────────────────────────────────────────

interface Announcement {
  id:             string;
  title:          string;
  message:        string;
  type:           'info' | 'warning' | 'success' | 'maintenance';
  targetAudience: 'all' | 'active' | 'expired';
  isActive:       boolean;
  expiresAt:      Timestamp | null;
}

interface Props {
  subscriptionStatus?: string;
}

// ── Visual config ──────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  info: {
    bg:      'rgba(99,102,241,0.1)',
    border:  'rgba(99,102,241,0.3)',
    iconBg:  'rgba(99,102,241,0.15)',
    color:   '#a78bfa',
    Icon:    Info,
  },
  warning: {
    bg:      'rgba(245,158,11,0.1)',
    border:  'rgba(245,158,11,0.3)',
    iconBg:  'rgba(245,158,11,0.15)',
    color:   '#fbbf24',
    Icon:    AlertTriangle,
  },
  success: {
    bg:      'rgba(52,211,153,0.08)',
    border:  'rgba(52,211,153,0.25)',
    iconBg:  'rgba(52,211,153,0.12)',
    color:   '#34d399',
    Icon:    CheckCircle,
  },
  maintenance: {
    bg:      'rgba(239,68,68,0.08)',
    border:  'rgba(239,68,68,0.25)',
    iconBg:  'rgba(239,68,68,0.12)',
    color:   '#f87171',
    Icon:    Wrench,
  },
} as const;

// ── Session dismissal helpers ──────────────────────────────────────────────

const DISMISSED_KEY = 'sk_dismissed_announcements_v1';

function getDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    return raw ? new Set<string>(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function persistDismiss(id: string): void {
  try {
    const s = getDismissed();
    s.add(id);
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...s]));
  } catch {}
}

// ── Component ──────────────────────────────────────────────────────────────

export const AnnouncementBanner: React.FC<Props> = ({ subscriptionStatus }) => {
  const [items,     setItems]     = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(getDismissed);
  // Keep subscriptionStatus in a ref so the snapshot callback always uses
  // the latest value without needing to re-subscribe on every status change.
  const statusRef = useRef(subscriptionStatus);
  useEffect(() => { statusRef.current = subscriptionStatus; }, [subscriptionStatus]);

  // ── Real-time listener ─────────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'announcements'),
      where('isActive', '==', true),
    );

    const unsub = onSnapshot(q, (snap) => {
      const now    = Date.now();
      const status = statusRef.current;

      const filtered = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Announcement))
        .filter(a => {
          // Expiry
          if (a.expiresAt && a.expiresAt.toMillis() < now) return false;
          // Audience
          switch (a.targetAudience) {
            case 'all':     return true;
            case 'active':  return status === 'active' || status === 'trial';
            case 'expired': return status === 'expired' || status === 'grace';
            default:        return true;
          }
        })
        .slice(0, 3); // max 3 visible at once

      setItems(filtered);
    }, () => {
      // Non-fatal — announcements are supplementary content
    });

    return unsub;
  }, []); // subscribe once; statusRef handles status changes without re-subscribing

  // ── Re-apply audience filter when status changes ───────────────────────
  // The snapshot already holds the full list; we just need to re-filter.
  // We do this by triggering a forced re-render when status changes so the
  // "visible" computation below picks up the new status from statusRef.
  const [, forceRender] = useState(0);
  useEffect(() => {
    forceRender(n => n + 1);
  }, [subscriptionStatus]);

  // ── Render ─────────────────────────────────────────────────────────────

  const now    = Date.now();
  const status = subscriptionStatus;

  const visible = items.filter(a => {
    if (dismissed.has(a.id)) return false;
    if (a.expiresAt && a.expiresAt.toMillis() < now) return false;
    switch (a.targetAudience) {
      case 'all':     return true;
      case 'active':  return status === 'active' || status === 'trial';
      case 'expired': return status === 'expired' || status === 'grace';
      default:        return true;
    }
  });

  if (visible.length === 0) return null;

  const handleDismiss = (id: string) => {
    persistDismiss(id);
    setDismissed(prev => new Set([...prev, id]));
  };

  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2 shrink-0">
      {visible.map(a => {
        const cfg  = TYPE_CONFIG[a.type] ?? TYPE_CONFIG.info;
        const { Icon } = cfg;
        return (
          <div
            key={a.id}
            className="flex items-start gap-2.5 rounded-[14px] px-3 py-2.5"
            style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
          >
            <div
              className="w-7 h-7 rounded-[10px] flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: cfg.iconBg }}
            >
              <Icon size={13} style={{ color: cfg.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black leading-tight" style={{ color: cfg.color }}>
                {a.title}
              </p>
              <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'rgba(148,163,184,0.7)' }}>
                {a.message}
              </p>
            </div>
            <button
              onClick={() => handleDismiss(a.id)}
              className="flex-shrink-0 p-1 rounded-lg active:scale-90 transition-transform"
              style={{ color: 'rgba(148,163,184,0.4)' }}
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
