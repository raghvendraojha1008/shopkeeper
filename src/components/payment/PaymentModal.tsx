/**
 * PaymentModal — full payment lifecycle UI for Shopkeeper.
 *
 * Steps:
 *   method-select → confirm → processing → success | error
 *
 * Supported methods (driven entirely by config/payment_methods from Firestore):
 *   UPI          — show UPI ID(s), user pays externally, taps "I Paid"
 *   Razorpay     — opens Razorpay checkout, handles success/failure natively
 *   Bank Transfer — show account details, user confirms manually
 *   Cash          — show admin instructions, user confirms manually
 *
 * Security:
 *   ❌ Never reads razorpay.keySecret or razorpay.webhookSecret
 *   ❌ Never writes subscription without PaymentService.activateSubscription()
 *   ✅ Double-click guard via isProcessingRef
 *   ✅ Re-fetches plan in PaymentService before write (plan-changed guard)
 *   ✅ Audit log written on every success AND failure
 */

import React, { useState, useRef, useCallback } from 'react';
import { buildUpiUri } from '../common/UpiQrInvoice';
import {
  X, Crown, CreditCard, Smartphone, Banknote, CheckCircle2,
  AlertTriangle, Loader2, ArrowLeft, Copy, Check, Mail,
} from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { useSubscription, Subscription } from '../../context/SubscriptionContext';
import { Plan, GlobalConfig } from '../../services/subscriptionService';
import {
  PaymentService,
  BackendAPI,
  PaymentConfig,
  PaymentMethod,
  UpiEntry,
  generateUpiPaymentId,
  generateCashPaymentId,
  generateBankPaymentId,
  isBackendConfigured,
} from '../../services/paymentService';

// Support email for payment failure escalation (set via VITE_SUPPORT_EMAIL env var)
const SUPPORT_EMAIL: string = import.meta.env.VITE_SUPPORT_EMAIL ?? '';

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 'method-select' | 'upi-confirm' | 'bank-confirm' | 'cash-confirm' | 'processing' | 'success' | 'error';

interface Props {
  open:           boolean;
  onClose:        () => void;
  targetPlanId:   string;
  plans:          Plan[];
  paymentMethods: PaymentConfig | null;
  globalConfig:   GlobalConfig | null;
  subscription:   Subscription | null;
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-auto flex items-center gap-1 text-app-sm font-bold px-2 py-0.5 rounded-lg active:scale-95 transition-all"
      style={{ background: 'var(--col-accent-12)', color: copied ? "var(--col-success)" : "var(--col-violet)", border: '1px solid var(--col-accent-25)' }}
    >
      {copied ? <Check size={9} /> : <Copy size={9} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function MethodCard({
  icon, label, sub, onClick,
}: { icon: React.ReactNode; label: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-[16px] p-3.5 text-left active:scale-[0.98] transition-all"
      style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}
    >
      <div className="w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(251,191,36,0.12)' }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-app-lg font-black text-white">{label}</p>
        <p className="text-app-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>
      </div>
      <div className="text-white/30 text-xs">›</div>
    </button>
  );
}

// ── PaymentModal ───────────────────────────────────────────────────────────────

export const PaymentModal: React.FC<Props> = ({
  open, onClose,
  targetPlanId, plans, paymentMethods, globalConfig, subscription,
}) => {
  const { user }                 = useAuth();
  const { refresh }              = useSubscription();

  const [step,             setStep]             = useState<Step>('method-select');
  const [selectedUpiEntry, setSelectedUpiEntry] = useState<UpiEntry | null>(null);
  const [errorMsg,         setErrorMsg]         = useState('');

  // Double-click / double-submit guard
  const isProcessingRef = useRef(false);

  const plan         = plans.find(p => p.id === targetPlanId);
  const price        = plan?.price ?? 0;
  const currency     = plan?.currency ?? 'INR';
  const symbol       = currency === 'INR' ? '₹' : currency;
  const planName     = plan?.name ?? targetPlanId;

  // Derive enabled payment channels from admin-panel config
  const activeUpi    = (paymentMethods?.upi?.enabled && paymentMethods.upi.entries?.filter(e => e.isActive)) || [];
  const bankEnabled  = paymentMethods?.bankTransfer?.enabled ?? false;
  const cashEnabled  = paymentMethods?.cash?.enabled ?? false;
  const rzpEnabled   = paymentMethods?.razorpay?.enabled ?? false;
  const rzpKeyId     = paymentMethods?.razorpay?.keyId ?? '';

  const hasAnyMethod = activeUpi.length > 0 || bankEnabled || cashEnabled || rzpEnabled;

  // ── Reset on open ────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (open) {
      setStep('method-select');
      setSelectedUpiEntry(null);
      setErrorMsg('');
      isProcessingRef.current = false;
    }
  }, [open]);

  // ── Core: activate via backend only ───────────────────────────────────────
  //
  // All manual payment confirmation (UPI, bank, cash) must go through the
  // backend. VITE_BACKEND_URL is required — if not set, the method is blocked
  // with an error so the user contacts the admin rather than bypassing payment.
  // Razorpay always requires the backend for HMAC signature verification.
  const activate = useCallback(async (
    _localPaymentId: string,
    method: PaymentMethod,
    referenceNote?: string,
  ) => {
    if (!user?.uid) { setErrorMsg('Not signed in.'); setStep('error'); return; }
    if (isProcessingRef.current) return;

    if (!isBackendConfigured()) {
      setErrorMsg(
        'Payment backend is not configured. Please contact support to complete your subscription.',
      );
      setStep('error');
      return;
    }

    isProcessingRef.current = true;
    setStep('processing');
    setErrorMsg('');

    try {
      await BackendAPI.confirmManualPayment({
        userId:        user.uid,
        planId:        targetPlanId,
        paymentMethod: method as 'upi' | 'bank_transfer' | 'cash',
        referenceNote,
      });

      refresh();
      setStep('success');
    } catch (err: any) {
      const reason = err?.message ?? 'Unknown error';
      await PaymentService.logPaymentFailure(user.uid, targetPlanId, reason, method);
      setErrorMsg(reason);
      setStep('error');
    } finally {
      isProcessingRef.current = false;
    }
  }, [user, targetPlanId, refresh]);

  // ── Razorpay flow ──────────────────────────────────────────────────────────
  //
  // Backend-first: createOrder → Razorpay checkout → verifyPayment (signature verified server-side)
  // Backend is the single writer. Frontend only reads via onSnapshot after backend commits.
  // ❌ Razorpay ALWAYS requires backend — HMAC signature verification is server-side only.
  const handleRazorpay = useCallback(async () => {
    if (!user?.uid) return;
    if (isProcessingRef.current) return;

    // Guard: Razorpay cannot work without a configured backend
    if (!isBackendConfigured()) {
      setErrorMsg(
        'Razorpay requires a backend server for payment verification.\n\n' +
        'Set VITE_BACKEND_URL to your backend URL, or contact support.\n\n' +
        'You can still use UPI / Bank Transfer / Cash if those methods are enabled.'
      );
      setStep('error');
      return;
    }

    isProcessingRef.current = true;
    setStep('processing');

    const loaded = await PaymentService.loadRazorpayScript();
    if (!loaded) {
      isProcessingRef.current = false;
      setErrorMsg('Could not load payment gateway. Check your internet connection and try again.');
      setStep('error');
      return;
    }

    // Backend creates the order — retry up to 2 times on network failure
    let orderData: { orderId: string; amount: number; currency: string; keyId: string };
    let lastOrderErr: any;
    let orderCreated = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await BackendAPI.createOrder(targetPlanId);
        orderData = { orderId: result.orderId, amount: result.amount, currency: result.currency, keyId: result.keyId };
        orderCreated = true;
        break;
      } catch (err: any) {
        lastOrderErr = err;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1200));
      }
    }
    if (!orderCreated) {
      isProcessingRef.current = false;
      const msg = lastOrderErr?.message ?? '';
      const isNetwork = !msg || /network|fetch|timeout|offline/i.test(msg);
      setErrorMsg(isNetwork
        ? 'Network error — could not reach payment server. Check your connection and try again.'
        : (msg || 'Could not create payment order. Try again.'));
      setStep('error');
      return;
    }

    isProcessingRef.current = false; // Razorpay opens its own modal; allow re-entry on dismiss

    PaymentService.openRazorpayCheckout({
      keyId:        orderData.keyId,
      amount:       orderData.amount,
      currency:     orderData.currency,
      name:         'Shopkeeper',
      description:  `${planName} Plan`,
      orderId:      orderData.orderId,
      prefillEmail: user.email ?? undefined,
      onSuccess: async (payload) => {
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        setStep('processing');
        try {
          // Backend verifies HMAC-SHA256 signature server-side
          await BackendAPI.verifyPayment({
            razorpay_order_id:   payload.razorpay_order_id!,
            razorpay_payment_id: payload.razorpay_payment_id,
            razorpay_signature:  payload.razorpay_signature!,
            planId:              targetPlanId,
          });
          refresh();
          setStep('success');
        } catch (err: any) {
          const reason = err?.message ?? 'Payment verification failed';
          if (user?.uid) {
            await PaymentService.logPaymentFailure(user.uid, targetPlanId, reason, 'razorpay');
          }
          setErrorMsg(reason);
          setStep('error');
        } finally {
          isProcessingRef.current = false;
        }
      },
      onFailure: async (err) => {
        if (err?.message === 'dismissed') {
          setStep('method-select');
          return;
        }
        const reason = err?.description ?? err?.message ?? 'Payment failed';
        if (user?.uid) {
          await PaymentService.logPaymentFailure(user.uid, targetPlanId, reason, 'razorpay');
        }
        setErrorMsg(reason);
        setStep('error');
      },
    });
  }, [user, planName, targetPlanId, refresh]);

  if (!open) return null;

  // ── Render ───────────────────────────────────────────────────────────────────

  const modalStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    background: 'var(--rgba-black-70)', backdropFilter: 'blur(4px)',
  };
  const sheetStyle: React.CSSProperties = {
    width: '100%', maxWidth: 480,
    background: 'var(--modal-sheet-bg)',
    border: '1px solid var(--glass-border)',
    borderBottom: 'none',
    borderRadius: '24px 24px 0 0',
    padding: '24px 20px 40px',
    maxHeight: '90vh',
    overflowY: 'auto',
  };

  // ── Header ──
  const Header = ({ title, canBack, backStep }: { title: string; canBack?: boolean; backStep?: Step }) => (
    <div className="flex items-center gap-3 mb-5">
      {canBack && backStep && (
        <button onClick={() => setStep(backStep)}
          className="w-8 h-8 rounded-full flex items-center justify-center active:scale-95 transition-all"
          style={{ background: 'var(--rgba-white-06)' }}>
          <ArrowLeft size={14} className="text-white/60" />
        </button>
      )}
      <p className="font-black text-base text-white flex-1">{title}</p>
      <button onClick={onClose}
        className="w-8 h-8 rounded-full flex items-center justify-center active:scale-95 transition-all"
        style={{ background: 'var(--rgba-white-06)' }}>
        <X size={14} className="text-white/60" />
      </button>
    </div>
  );

  // ── Plan pill ──
  const PlanPill = () => (
    <div className="flex items-center gap-2 rounded-[14px] px-3 py-2.5 mb-5"
      style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
      <Crown size={13} style={{ color: "var(--col-warning)" }} />
      <p className="text-app-md font-black" style={{ color: "var(--col-warning)" }}>
        {planName} Plan — {price === 0 ? 'Free' : `${symbol}${price.toLocaleString('en-IN')}/month`}
      </p>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // STEP: method-select
  // ════════════════════════════════════════════════════════════
  if (step === 'method-select') return (
    <div style={modalStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="payment-modal-sheet" style={sheetStyle}>
        <Header title="Choose Payment Method" />
        <PlanPill />

        {!hasAnyMethod ? (
          <div className="text-center py-8">
            <p className="text-app-lg" style={{ color: 'var(--text-muted)' }}>
              No payment methods configured. Contact support to upgrade.
            </p>
          </div>
        ) : rzpEnabled && rzpKeyId ? (
          /* ── Razorpay is configured: single prominent CTA, no manual options ── */
          <div className="flex flex-col gap-3">
            {/* Accepted methods label + chips — these are informational, NOT buttons */}
            <div className="flex flex-col gap-1.5">
              <p className="text-center text-app-xs font-black uppercase tracking-[0.15em]"
                style={{ color: 'var(--text-muted)' }}>
                Accepts
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {['UPI', 'Card', 'Netbanking', 'EMI', 'Wallet'].map(m => (
                  <span key={m} className="text-app-xs font-black uppercase tracking-[0.12em] px-2.5 py-1 rounded-full"
                    style={{ background: 'var(--col-accent-08)', color: 'var(--text-muted)', border: '1px solid var(--col-accent-12)' }}>
                    {m}
                  </span>
                ))}
              </div>
            </div>

            {/* Big pay button */}
            <button
              onClick={handleRazorpay}
              className="w-full py-4 rounded-[18px] font-black text-app-3xl flex items-center justify-center gap-3 active:scale-[0.98] transition-all mt-1"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', color: 'black', boxShadow: '0 8px 32px var(--col-warning-35)' }}
            >
              <CreditCard size={20} />
              Pay {price > 0 ? `${symbol}${price.toLocaleString('en-IN')}` : ''} Securely
            </button>

            <p className="text-center text-app-sm" style={{ color: 'var(--text-muted)' }}>
              Powered by Razorpay · 100% secure · Auto-activated on success
            </p>
          </div>
        ) : (
          /* ── Razorpay not configured: show manual methods ── */
          <div className="space-y-2.5">
            {activeUpi.length > 0 && (
              <div className="space-y-2">
                {activeUpi.map(entry => (
                  <MethodCard
                    key={entry.id}
                    icon={<Smartphone size={16} style={{ color: "var(--col-warning)" }} />}
                    label={`UPI${entry.label ? ` — ${entry.label}` : ''}`}
                    sub={entry.upiId}
                    onClick={() => { setSelectedUpiEntry(entry); setStep('upi-confirm'); }}
                  />
                ))}
              </div>
            )}
            {bankEnabled && (
              <MethodCard
                icon={<CreditCard size={16} style={{ color: "var(--col-warning)" }} />}
                label="Bank Transfer / NEFT"
                sub="Transfer to our bank account"
                onClick={() => setStep('bank-confirm')}
              />
            )}
            {cashEnabled && (
              <MethodCard
                icon={<Banknote size={16} style={{ color: "var(--col-warning)" }} />}
                label="Cash Payment"
                sub={paymentMethods?.cash?.instructions ? 'See instructions below' : 'Contact us to pay cash'}
                onClick={() => setStep('cash-confirm')}
              />
            )}
          </div>
        )}

        <p className="text-center text-app-xs mt-5" style={{ color: 'var(--text-muted)' }}>
          Payments processed securely · Cancel anytime
        </p>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // STEP: upi-confirm
  // ════════════════════════════════════════════════════════════
  if (step === 'upi-confirm' && selectedUpiEntry) {
    const upiUri = buildUpiUri(
      selectedUpiEntry.upiId,
      planName,
      price === 0 ? undefined : price,
      generateUpiPaymentId() // optional reference
    );

    return (
      <div style={modalStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="payment-modal-sheet" style={sheetStyle}>
          <Header title="UPI Payment" canBack backStep="method-select" />
          <PlanPill />

          <div className="rounded-[18px] p-4 mb-4"
            style={{ background: 'var(--rgba-black-35)', border: '1px solid rgba(251,191,36,0.15)' }}>
            <p className="text-app-xs font-black uppercase tracking-[0.15em] mb-3"
              style={{ color: 'var(--text-muted)' }}>
              Step 1 — Send {price === 0 ? 'any amount' : `${symbol}${price.toLocaleString('en-IN')}`} to this UPI ID
            </p>
            <div className="flex items-center gap-2 rounded-[12px] px-3 py-2.5"
              style={{ background: 'var(--col-accent-08)', border: '1px solid var(--col-accent-15)' }}>
              <Smartphone size={14} style={{ color: "var(--col-violet)" }} />
              <p className="text-app-xl font-black text-white flex-1">{selectedUpiEntry.upiId}</p>
              <CopyBtn value={selectedUpiEntry.upiId} />
            </div>
            {selectedUpiEntry.label && (
              <p className="text-app-sm mt-2 ml-1" style={{ color: 'var(--text-muted)' }}>
                {selectedUpiEntry.label}
              </p>
            )}
          </div>

          {/* 🆕 UPI APP BUTTON */}
          <button
            onClick={() => window.open(upiUri, '_blank')}
            className="w-full py-3.5 rounded-[16px] font-black text-app-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-all mb-3"
            style={{ background: "var(--col-blue)", color: 'white' }}
          >
            <Smartphone size={16} />
            Pay with {selectedUpiEntry.label || 'UPI App'}
          </button>

          <div className="rounded-[14px] px-4 py-3 mb-5"
            style={{ background: 'var(--col-warning-07)', border: '1px solid var(--col-warning-25)' }}>
            <p className="text-app-xs font-black uppercase tracking-[0.15em] mb-1"
              style={{ color: 'var(--col-warning-60)' }}>
              Step 2 — After payment
            </p>
            <p className="text-app-md" style={{ color: 'var(--text-primary)' }}>
              Tap the button below once your payment is complete.
              Your subscription activates immediately.
            </p>
          </div>

          <button
            onClick={() => activate(generateUpiPaymentId(), 'upi')}
            className="w-full py-3.5 rounded-[16px] font-black text-app-xl active:scale-[0.98] transition-all"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', color: 'black' }}
          >
            I've Paid — Activate {planName}
          </button>

          <p className="text-center text-app-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            Your plan activates instantly once confirmed.
          </p>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // STEP: bank-confirm
  // ════════════════════════════════════════════════════════════
  if (step === 'bank-confirm') {
    const bt = paymentMethods?.bankTransfer;
    return (
      <div style={modalStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="payment-modal-sheet" style={sheetStyle}>
          <Header title="Bank Transfer" canBack backStep="method-select" />
          <PlanPill />

          <div className="rounded-[18px] p-4 mb-4 space-y-2.5"
            style={{ background: 'var(--rgba-black-35)', border: '1px solid var(--col-accent-15)' }}>
            <p className="text-app-xs font-black uppercase tracking-[0.15em]"
              style={{ color: 'var(--text-muted)' }}>
              Transfer {price === 0 ? '' : `${symbol}${price.toLocaleString('en-IN')} `}to this account
            </p>
            {[
              { label: 'Account Name', value: bt?.accountName },
              { label: 'Bank',         value: bt?.bankName },
              { label: 'Account No.',  value: bt?.accountNumber },
              { label: 'IFSC Code',    value: bt?.ifscCode },
              { label: 'Branch',       value: bt?.branch },
            ].filter(r => r.value).map(row => (
              <div key={row.label} className="flex items-center gap-2">
                <p className="text-app-sm w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>{row.label}</p>
                <p className="text-app-md font-bold text-white flex-1 truncate">{row.value}</p>
                <CopyBtn value={row.value!} />
              </div>
            ))}
          </div>

          <div className="rounded-[14px] px-4 py-3 mb-5"
            style={{ background: 'var(--col-warning-07)', border: '1px solid var(--col-warning-25)' }}>
            <p className="text-app-md" style={{ color: 'var(--text-primary)' }}>
              After the transfer, tap the button below. Your subscription will be activated immediately.
              Keep your transaction ID as proof.
            </p>
          </div>

          <button
            onClick={() => activate(generateBankPaymentId(), 'bank_transfer')}
            className="w-full py-3.5 rounded-[16px] font-black text-app-xl active:scale-[0.98] transition-all"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', color: 'black' }}
          >
            I've Transferred — Activate {planName}
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // STEP: cash-confirm
  // ════════════════════════════════════════════════════════════
  if (step === 'cash-confirm') return (
    <div style={modalStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="payment-modal-sheet" style={sheetStyle}>
        <Header title="Cash Payment" canBack backStep="method-select" />
        <PlanPill />

        <div className="rounded-[18px] p-4 mb-4"
          style={{ background: 'var(--rgba-black-35)', border: '1px solid var(--col-success-15)' }}>
          <p className="text-app-xs font-black uppercase tracking-[0.15em] mb-2"
            style={{ color: 'var(--col-success-55)' }}>
            Instructions
          </p>
          <p className="text-app-lg leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {paymentMethods?.cash?.instructions || `Pay ${symbol}${price.toLocaleString('en-IN')} in cash to our representative.`}
          </p>
        </div>

        <button
          onClick={() => activate(generateCashPaymentId(), 'cash')}
          className="w-full py-3.5 rounded-[16px] font-black text-app-xl active:scale-[0.98] transition-all"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', color: 'black' }}
        >
          I've Paid — Activate {planName}
        </button>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // STEP: processing
  // ════════════════════════════════════════════════════════════
  if (step === 'processing') return (
    <div style={modalStyle}>
      <div className="payment-modal-sheet" style={sheetStyle}>
        <div className="flex flex-col items-center py-10 gap-5">
          <div className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(251,191,36,0.12)' }}>
            <Loader2 size={26} style={{ color: "var(--col-warning)" }} className="animate-spin" />
          </div>
          <div className="text-center">
            <p className="font-black text-app-2xl text-white mb-1">Activating subscription…</p>
            <p className="text-app-md" style={{ color: 'var(--text-muted)' }}>
              Writing to Firestore and logging audit trail
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // STEP: success
  // ════════════════════════════════════════════════════════════
  if (step === 'success') return (
    <div style={modalStyle}>
      <div className="payment-modal-sheet" style={sheetStyle}>
        <div className="flex flex-col items-center py-8 gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: 'var(--col-success-12)' }}>
            <CheckCircle2 size={30} style={{ color: "var(--col-success)" }} />
          </div>
          <div className="text-center">
            <p className="font-black text-app-4xl text-white mb-1">You're on {planName}!</p>
            <p className="text-app-md" style={{ color: 'var(--text-muted)' }}>
              All Pro features are now unlocked. Enjoy Shopkeeper.
            </p>
          </div>
          <button
            onClick={onClose}
            className="mt-2 w-full py-3.5 rounded-[16px] font-black text-app-xl active:scale-[0.98] transition-all"
            style={{ background: 'linear-gradient(135deg, #34d399, #10b981)', color: 'black' }}
          >
            Start Using Pro
          </button>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════
  // STEP: error
  // ════════════════════════════════════════════════════════════
  if (step === 'error') {
    const mailtoHref = SUPPORT_EMAIL
      ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Payment Verification Failed')}&body=${encodeURIComponent(`Hi,\n\nMy payment could not be verified.\n\nError: ${errorMsg}\nPlan: ${targetPlanId}\n\nPlease help me activate my subscription.\n\nThank you.`)}`
      : '';

    return (
      <div style={modalStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="payment-modal-sheet" style={sheetStyle}>
          <div className="flex flex-col items-center py-8 gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: 'var(--col-danger-12)' }}>
              <AlertTriangle size={26} style={{ color: "var(--col-danger)" }} />
            </div>
            <div className="text-center">
              <p className="font-black text-app-2xl text-white mb-1">Activation failed</p>
              <p className="text-app-md px-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {errorMsg || 'Something went wrong. Please try again or contact support.'}
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full mt-1">
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setStep('method-select')}
                  className="flex-1 py-3 rounded-[14px] font-black text-app-lg active:scale-[0.98] transition-all"
                  style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                >
                  Try Again
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-[14px] font-black text-app-lg active:scale-[0.98] transition-all"
                  style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)', color: "var(--col-danger)" }}
                >
                  Close
                </button>
              </div>
              {mailtoHref && (
                <a
                  href={mailtoHref}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-[14px] font-black text-app-lg active:scale-[0.98] transition-all"
                  style={{ background: 'var(--col-accent-15)', border: '1px solid var(--col-accent-25)', color: "var(--col-violet)", textDecoration: 'none' }}
                >
                  <Mail size={13} />
                  Contact Support
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
