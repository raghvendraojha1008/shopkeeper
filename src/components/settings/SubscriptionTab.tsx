import React, { useEffect, useState } from 'react';
import {
  Crown, Check, Zap, Calendar, RefreshCw, Sparkles,
  Star, AlertTriangle, Copy, CreditCard, Smartphone, Clock, Gift, ArrowRight,
} from 'lucide-react';
import { useSubscription } from '../../context/SubscriptionContext';
import { FEATURE_LABELS, PLAN_FEATURES, PLAN_DISPLAY_NAMES, FeatureKey } from '../../utils/featureAccess';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { PaymentConfig, isBackendConfigured } from '../../services/paymentService';
import { PaymentModal } from '../payment/PaymentModal';
import { TransactionHistory } from '../payment/TransactionHistory';
import { useAuth } from '../../context/AuthContext';

const FREE_FEATURES: FeatureKey[] = PLAN_FEATURES.free;
const PRO_FEATURES: FeatureKey[] = PLAN_FEATURES.pro;

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  active: { bg: 'var(--col-success-15)', color: "var(--col-success)", label: 'Active' },
  trial: { bg: 'var(--col-accent-15)', color: "var(--col-violet)", label: 'Trial' },
  grace: { bg: 'var(--col-warning-15)', color: "var(--col-warning)", label: 'Grace Period' },
  expired: { bg: 'var(--col-danger-15)', color: "var(--col-danger)", label: 'Expired' },
};

const PLAN_GRADIENT: Record<string, string> = {
  free: 'linear-gradient(135deg, rgba(100,116,139,0.12), rgba(71,85,105,0.06))',
  pro: 'linear-gradient(135deg, var(--col-warning-14), rgba(251,191,36,0.06))',
  enterprise: 'linear-gradient(135deg, var(--col-accent-14), var(--col-violet-06))',
};
const PLAN_BORDER: Record<string, string> = {
  free: 'rgba(100,116,139,0.25)',
  pro: 'var(--col-warning-40)',
  enterprise: 'var(--col-violet-40)',
};
const PLAN_COLOR: Record<string, string> = {
  free: "var(--col-slate)",
  pro: "var(--col-warning)",
  enterprise: "var(--col-violet)",
};

// PaymentConfig is imported from paymentService — single source of truth.
// UpiEntry is also imported from paymentService.
// SECURITY: paymentService never exposes razorpay.keySecret or razorpay.webhookSecret.

function formatDate(ts: any): string {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-auto flex items-center gap-1 text-app-sm font-bold px-2 py-0.5 rounded-lg active:scale-95 transition-all"
      style={{
        background: 'var(--col-accent-12)',
        color: copied ? "var(--col-success)" : "var(--col-violet)",
        border: '1px solid var(--col-accent-25)',
      }}
    >
      <Copy size={9} />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export const SubscriptionTab: React.FC = () => {
  // ── Context — pulls admin-controlled config + live plans ──────────────────
  const { user } = useAuth();
  const { subscription, loading, refresh, isInGracePeriod, globalConfig, plans } =
    useSubscription();

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPlanForPayment, setSelectedPlanForPayment] = useState<any | null>(null);

  const [paymentMethods, setPaymentMethods] = useState<PaymentConfig | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(true);

  // ── Backend health indicator ──────────────────────────────────────────────
  type HealthStatus = 'unknown' | 'ok' | 'error';
  const [backendHealth, setBackendHealth] = useState<HealthStatus>('unknown');

  useEffect(() => {
    if (!isBackendConfigured()) {
      setBackendHealth('error');
      return;
    }
    const base = (import.meta.env.VITE_BACKEND_URL as string).replace(/\/$/, '');
    fetch(`${base}/health`, { method: 'GET', signal: AbortSignal.timeout(6000) })
      .then(r => setBackendHealth(r.ok ? 'ok' : 'error'))
      .catch(() => setBackendHealth('error'));
  }, []);

  // Real-time listener — reflects admin panel changes instantly without reload.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'config', 'payment_methods'),
      (snap) => {
        setPaymentMethods(snap.exists() ? (snap.data() as PaymentConfig) : null);
        setPaymentLoading(false);
      },
      () => {
        setPaymentMethods(null);
        setPaymentLoading(false);
      },
    );
    return unsub;
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/60 animate-spin" />
      </div>
    );
  }
  if (!subscription) return null;

  // ── Derive values from admin-controlled config ────────────────────────────

  // appMode: 'free' means admin opened full access globally — no paywalls.
  const appMode = globalConfig?.appMode ?? 'hybrid';
  const isFullyFree = appMode === 'free';

  // Grace period days — live from admin config, not hardcoded.
  const graceDays = globalConfig?.gracePeriodDays ?? 3;

  // Trial info — admin controls whether trials are enabled and their duration.
  const trialEnabled = globalConfig?.freeTrialEnabled ?? false;
  const trialDays = globalConfig?.trialDurationDays ?? 14;

  // Pro plan price — from Firestore plans collection, not hardcoded.
  const proPlanData = plans.find((p) => p.id === 'pro');
  const proPrice = proPlanData?.price ?? 299;
  const proCurrency = proPlanData?.currency ?? 'INR';
  const currencySymbol = proCurrency === 'INR' ? '₹' : proCurrency;

  // Plan features — prefer Firestore plan.features if available; fall back to static PLAN_FEATURES.
  const planFeatureKeys: FeatureKey[] = (() => {
    const firestorePlan = plans.find((p) => p.id === subscription.plan);
    if (firestorePlan?.features?.length) return firestorePlan.features as FeatureKey[];
    const plan = subscription.plan as keyof typeof PLAN_FEATURES;
    return PLAN_FEATURES[plan] ?? PLAN_FEATURES.free;
  })();

  const { plan, status, startDate, endDate } = subscription;
  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES.active;
  const planColor = PLAN_COLOR[plan] ?? "var(--col-slate)";
  const isPro = plan !== 'free';

  // Derive active payment channels from the new nested admin panel schema
  const activeUpiEntries = paymentMethods?.upi?.enabled
    ? (paymentMethods.upi.entries ?? []).filter((e) => e.isActive)
    : [];
  const hasBankTransfer = paymentMethods?.bankTransfer?.enabled ?? false;
  const hasCash = paymentMethods?.cash?.enabled ?? false;
  const hasRazorpay = paymentMethods?.razorpay?.enabled ?? false;
  const hasPayment =
    !paymentLoading &&
    paymentMethods &&
    (activeUpiEntries.length > 0 || hasBankTransfer || hasCash || hasRazorpay);

  // Show upgrade CTA only when: user is not Pro-equivalent AND admin hasn't opened free access.
  const showUpgrade =
    !isFullyFree && (plan === 'free' || status === 'expired' || status === 'trial');

  // Trial countdown
  const trialDaysRemaining =
    status === 'trial' && endDate
      ? Math.max(0, Math.ceil((endDate.toMillis() - Date.now()) / 86_400_000))
      : null;

  return (
    <div className="space-y-4">
      {/* ── Free-mode banner: admin opened full access globally ─────────────── */}
      {isFullyFree && (
        <div
          className="rounded-[18px] px-4 py-3 flex items-start gap-3"
          style={{
            background: 'var(--col-success-15)',
            border: '1px solid var(--col-success-35)',
          }}
        >
          <div
            className="w-8 h-8 rounded-[12px] flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: 'var(--col-success-15)' }}
          >
            <Gift size={15} style={{ color: "var(--col-success)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-app-lg" style={{ color: "var(--col-success)" }}>
              All Features Unlocked
            </p>
            <p
              className="text-app-sm mt-0.5 leading-relaxed"
              style={{ color: 'var(--col-success-65)' }}
            >
              The app is currently in free-access mode. All Pro features are
              available to everyone.
            </p>
          </div>
        </div>
      )}

      {/* ── Grace period warning ─────────────────────────────────────────────── */}
      {isInGracePeriod && (
        <div
          className="rounded-[18px] px-4 py-3 flex items-start gap-3"
          style={{
            background: 'var(--col-warning-15)',
            border: '1px solid var(--col-warning-35)',
          }}
        >
          <div
            className="w-8 h-8 rounded-[12px] flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: 'var(--col-warning-15)' }}
          >
            <AlertTriangle size={15} style={{ color: "var(--col-warning)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-app-lg" style={{ color: "var(--col-warning)" }}>
              Grace Period Active
            </p>
            <p
              className="text-app-sm mt-0.5 leading-relaxed"
              style={{ color: 'rgba(251,191,36,0.65)' }}
            >
              Your subscription expired but you still have full access for{' '}
              {graceDays} day{graceDays === 1 ? '' : 's'}. Renew to keep all Pro
              features.
            </p>
          </div>
        </div>
      )}

      {/* ── Trial countdown ──────────────────────────────────────────────────── */}
      {status === 'trial' && trialDaysRemaining !== null && (
        <div
          className="rounded-[18px] px-4 py-3 flex items-start gap-3"
          style={{
            background: 'var(--col-accent-15)',
            border: '1px solid var(--col-accent-35)',
          }}
        >
          <div
            className="w-8 h-8 rounded-[12px] flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: 'var(--col-accent-15)' }}
          >
            <Clock size={15} style={{ color: "var(--col-violet)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-app-lg" style={{ color: "var(--col-violet)" }}>
              {trialDaysRemaining > 0
                ? `${trialDaysRemaining} day${
                    trialDaysRemaining === 1 ? '' : 's'
                  } left in your trial`
                : 'Trial ending today'}
            </p>
            <p
              className="text-app-sm mt-0.5 leading-relaxed"
              style={{ color: 'rgba(167,139,250,0.65)' }}
            >
              You have full Pro access during your {trialDays}-day trial. Upgrade
              to keep all features after it ends.
            </p>
          </div>
        </div>
      )}

      {/* ── Expired notice ───────────────────────────────────────────────────── */}
      {status === 'expired' && !isInGracePeriod && (
        <div
          className="rounded-[18px] px-4 py-3 flex items-start gap-3"
          style={{
            background: 'var(--col-danger-08)',
            border: '1px solid var(--col-danger-35)',
          }}
        >
          <div
            className="w-8 h-8 rounded-[12px] flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: 'var(--col-danger-12)' }}
          >
            <AlertTriangle size={15} style={{ color: "var(--col-danger)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-app-lg" style={{ color: "var(--col-danger)" }}>
              Subscription Expired
            </p>
            <p
              className="text-app-sm mt-0.5 leading-relaxed"
              style={{ color: 'rgba(248,113,113,0.65)' }}
            >
              Premium features have been locked. Upgrade to restore full access.
            </p>
          </div>
        </div>
      )}

      {!showUpgrade && subscription && subscription.plan !== 'free' && (
        <div
          className="rounded-[22px] p-5 relative overflow-hidden"
          style={{ background: 'var(--col-emerald-08)', border: '1px solid var(--col-emerald-35)' }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-[14px] flex items-center justify-center"
              style={{ background: 'var(--col-emerald-15)' }}
            >
              <Crown size={18} style={{ color: "var(--col-success)" }} />
            </div>
            <div>
              <p className="font-black text-sm text-emerald-400">Current Plan</p>
              <p className="text-app-sm text-slate-400">
                {PLAN_DISPLAY_NAMES[subscription.plan as keyof typeof PLAN_DISPLAY_NAMES] ?? subscription.plan}
              </p>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">Valid until</span>
            <span className="text-sm font-black text-white">
              {subscription.endDate ? formatDate(subscription.endDate) : '—'}
            </span>
          </div>
        </div>
      )}

      {/* ── Active plan card ─────────────────────────────────────────────────── */}
      <div
        className="rounded-[22px] p-5 relative overflow-hidden"
        style={{
          background: PLAN_GRADIENT[plan] ?? PLAN_GRADIENT.free,
          border: `1px solid ${PLAN_BORDER[plan] ?? PLAN_BORDER.free}`,
        }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-11 h-11 rounded-[16px] flex items-center justify-center flex-shrink-0"
            style={{ background: `${planColor}22` }}
          >
            {plan === 'free' ? (
              <Zap size={20} style={{ color: planColor }} />
            ) : (
              <Crown size={20} style={{ color: planColor }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-black text-base" style={{ color: planColor }}>
                Shopkeeper{' '}
                {PLAN_DISPLAY_NAMES[
                  plan as keyof typeof PLAN_DISPLAY_NAMES
                ] ?? plan}
              </p>
              <span
                className="text-app-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: statusStyle.bg, color: statusStyle.color }}
              >
                {statusStyle.label}
              </span>
              {isFullyFree && (
                <span
                  className="text-app-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{
                    background: 'var(--col-success-15)',
                    color: "var(--col-success)",
                  }}
                >
                  Free Access
                </span>
              )}
            </div>
            <p
              className="text-app-sm mt-0.5"
              style={{ color: 'var(--text-muted)' }}
            >
              {isFullyFree
                ? 'All features unlocked by admin'
                : isPro
                  ? 'Full access to all features'
                  : 'Core features included'}
            </p>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div
            className="rounded-[14px] px-3 py-2.5"
            style={{ background: 'var(--rgba-black-25)' }}
          >
            <p
              className="text-app-xs font-black uppercase tracking-wider mb-0.5"
              style={{ color: 'var(--text-muted)' }}
            >
              Started
            </p>
            <div className="flex items-center gap-1.5">
              <Calendar size={10} style={{ color: planColor }} />
              <p className="text-app-md font-bold text-white">
                {formatDate(startDate)}
              </p>
            </div>
          </div>
          <div
            className="rounded-[14px] px-3 py-2.5"
            style={{ background: 'var(--rgba-black-25)' }}
          >
            <p
              className="text-app-xs font-black uppercase tracking-wider mb-0.5"
              style={{ color: 'var(--text-muted)' }}
            >
              {status === 'trial' ? 'Trial Ends' : 'Valid Until'}
            </p>
            <div className="flex items-center gap-1.5">
              {status === 'trial' ? (
                <Clock size={10} style={{ color: "var(--col-violet)" }} />
              ) : (
                <Calendar
                  size={10}
                  style={{
                    color:
                      status === 'expired' ? "var(--col-danger)" : planColor,
                  }}
                />
              )}
              <p
                className="text-app-md font-bold"
                style={{
                  color:
                    status === 'expired'
                      ? "var(--col-danger)"
                      : status === 'trial'
                        ? "var(--col-violet)"
                        : 'white',
                }}
              >
                {formatDate(endDate)}
              </p>
            </div>
          </div>
        </div>

        {/* Launch promo banner */}
        {isPro && (subscription as any).introOffer && (
          <div
            className="rounded-[12px] px-3 py-2 flex items-center gap-2 mb-4"
            style={{
              background: 'var(--col-success-15)',
              border: '1px solid var(--col-success-25)',
            }}
          >
            <Star size={11} style={{ color: "var(--col-success)", flexShrink: 0 }} />
            <p className="text-app-sm font-bold" style={{ color: "var(--col-success)" }}>
              Early access — Pro plan active at ₹0 during launch
            </p>
          </div>
        )}

        {/* Feature list — from Firestore plans if available, else static */}
        <div className="space-y-2">
          <p
            className="text-app-xs font-black uppercase tracking-[0.2em] mb-2"
            style={{ color: 'var(--text-muted)' }}
          >
            What's included
          </p>
          {(isFullyFree ? PRO_FEATURES : planFeatureKeys).map((key) => (
            <div key={key} className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: `${planColor}22` }}
              >
                <Check size={9} style={{ color: planColor }} />
              </div>
              <span
                className="text-app-md font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {FEATURE_LABELS[key] ?? key}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Upgrade cards — hidden when admin has set appMode = 'free' ──────── */}
      {showUpgrade && (
        <div className="space-y-4">
          {(plans || [])
            .filter(
              (plan) => plan.id !== 'free' && plan.isActive !== false,
            )
            .map((plan) => {
              const isPlanEnterprise = plan.id === 'enterprise';
              const PlanIcon = isPlanEnterprise ? Sparkles : Crown;
              const iconColor = isPlanEnterprise
                ? "var(--col-violet)"
                : "var(--col-warning)";
              const borderColor = isPlanEnterprise
                ? 'var(--col-violet-40)'
                : 'var(--col-warning-40)';
              const bgGradient = isPlanEnterprise
                ? 'linear-gradient(135deg, var(--col-violet-12), var(--col-accent-06))'
                : 'linear-gradient(135deg, var(--col-warning-12), rgba(251,191,36,0.06))';

              return (
                <div
                  key={plan.id}
                  className="rounded-[22px] p-5 relative overflow-hidden"
                  style={{
                    background: bgGradient,
                    border: `1px solid ${borderColor}`,
                  }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-10 h-10 rounded-[14px] flex items-center justify-center"
                      style={{ background: `${iconColor}22` }}
                    >
                      <PlanIcon
                        size={18}
                        style={{ color: iconColor }}
                      />
                    </div>
                    <div>
                      <p
                        className="font-black text-sm"
                        style={{ color: iconColor }}
                      >
                        {plan.name}
                      </p>
                      <p
                        className="text-app-sm"
                        style={{
                          color: 'var(--text-muted)',
                        }}
                      >
                        {plan.durationDays} days ·{' '}
                        {plan.price === 0
                          ? 'Free'
                          : `₹${plan.price.toLocaleString(
                              'en-IN',
                            )}/month`}
                      </p>
                    </div>
                  </div>

                  {/* Features list – show a few key ones */}
                  <div className="space-y-2 mb-4">
                    {(plan.features || [])
                      .slice(0, 4)
                      .map((featureKey) => (
                        <div
                          key={featureKey}
                          className="flex items-center gap-2"
                        >
                          <Crown
                            size={10}
                            style={{
                              color: iconColor,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            className="text-app-md font-bold"
                            style={{
                              color: 'var(--text-primary)',
                            }}
                          >
                            {FEATURE_LABELS[
                              featureKey as FeatureKey
                            ] ?? featureKey}
                          </span>
                        </div>
                      ))}
                    {(plan.features?.length || 0) > 4 && (
                      <p
                        className="text-app-sm pl-5"
                        style={{
                          color: 'var(--text-muted)',
                        }}
                      >
                        +{plan.features!.length - 4} more features
                      </p>
                    )}
                  </div>

                  {/* Price and CTA */}
                  <div className="flex items-baseline gap-1 mb-4">
                    <span
                      className="text-2xl font-black"
                      style={{ color: iconColor }}
                    >
                      ₹{plan.price.toLocaleString('en-IN')}
                    </span>
                    <span
                      className="text-app-md font-bold"
                      style={{
                        color: 'var(--text-muted)',
                      }}
                    >
                      /month
                    </span>
                  </div>

                  {hasPayment ? (
                    <button
                      onClick={() => {
                        setSelectedPlanForPayment(plan);
                        setShowPaymentModal(true);
                      }}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[16px] font-black text-app-xl active:scale-[0.98] transition-all"
                      style={{
                        background: `linear-gradient(135deg, ${iconColor}dd, ${iconColor}aa)`,
                        color: 'black',
                      }}
                    >
                      <PlanIcon size={15} />
                      Upgrade to {plan.name}
                      <ArrowRight size={14} />
                    </button>
                  ) : (
                    <div className="text-center py-2">
                      <p
                        className="text-app-sm"
                        style={{
                          color: 'var(--text-muted)',
                        }}
                      >
                        Payment options coming soon. Contact
                        support to upgrade.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* ── Transaction history ───────────────────────────────────────────────── */}
      <div className="mt-2">
        <p
          className="text-app-xs font-black uppercase tracking-[0.2em] mb-3"
          style={{ color: 'var(--text-muted)' }}
        >
          Subscription History
        </p>
        <TransactionHistory />
      </div>

      {/* ── Refresh ──────────────────────────────────────────────────────────── */}
      <button
        onClick={refresh}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-[16px] text-app-md font-bold active:scale-95 transition-all"
        style={{
          background: 'var(--rgba-white-04)',
          border: '1px solid var(--glass-border)',
          color: 'var(--text-muted)',
        }}
      >
        <RefreshCw size={12} />
        Sync subscription status
        {/* Backend health dot */}
        <span
          className="ml-auto w-2 h-2 rounded-full flex-shrink-0 transition-colors"
          style={{
            background: backendHealth === 'ok'
              ? "var(--col-success)"
              : backendHealth === 'error'
              ? "var(--col-danger)"
              : 'var(--text-muted)',
            boxShadow: backendHealth === 'ok'
              ? '0 0 6px var(--col-success-60)'
              : backendHealth === 'error'
              ? '0 0 6px rgba(248,113,113,0.5)'
              : 'none',
          }}
          title={backendHealth === 'ok' ? 'Backend reachable' : backendHealth === 'error' ? 'Backend unreachable' : 'Checking backend…'}
        />
      </button>

      <p
        className="text-center text-app-sm"
        style={{ color: 'var(--text-muted)' }}
      >
        Payments processed securely · Cancel anytime
      </p>

      {/* ── Payment modal — full lifecycle: method → confirm → activate ───── */}
      <PaymentModal
        open={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setSelectedPlanForPayment(null);
        }}
        targetPlanId={selectedPlanForPayment?.id || 'pro'}
        plans={plans}
        paymentMethods={paymentMethods}
        globalConfig={globalConfig}
        subscription={subscription}
      />
    </div>
  );
};