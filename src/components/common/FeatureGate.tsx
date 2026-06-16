import React, { useMemo, useEffect, useRef } from 'react';
import { Crown, Lock, ArrowRight } from 'lucide-react';
import { useSubscription } from '../../context/SubscriptionContext';
import { useAuth } from '../../context/AuthContext';
import {
  hasAccess,
  FeatureKey,
  FEATURE_REGISTRY,
  isInGracePeriod,
} from '../../utils/featureAccess';
import { TelemetryService } from '../../services/telemetryService';

interface FeatureGateProps {
  feature: FeatureKey;
  children: React.ReactNode;
  onGoToSubscription?: () => void;
  onBack?: () => void;
}

export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  children,
  onGoToSubscription,
  onBack,
}) => {
  const { subscription, isInGracePeriod: graceCtx, globalConfig, liveFeatures } = useSubscription();
  const { user } = useAuth();

  // Memoize access check — recompute when subscription, appMode, or live plan features change.
  // liveFeatures comes from Firestore plans/ via onSnapshot, so admin changes propagate instantly.
  const canAccess = useMemo(
    () => hasAccess(subscription, feature, globalConfig?.appMode, liveFeatures),
    [subscription, feature, globalConfig?.appMode, liveFeatures],
  );

  // Deduplicated telemetry: fire once per (feature, session) when gate is shown
  const trackedRef = useRef(false);
  useEffect(() => {
    if (!canAccess && !trackedRef.current && user) {
      trackedRef.current = true;
      TelemetryService.trackFeatureBlocked(user.uid, feature, subscription?.plan ?? 'free');
    }
    // Reset if access is later granted (e.g. user upgrades while app is open)
    if (canAccess) trackedRef.current = false;
  }, [canAccess, feature, user, subscription?.plan]);

  if (canAccess) return <>{children}</>;

  const isExpired   = subscription?.status === 'expired';
  const stillGrace  = graceCtx || isInGracePeriod(subscription);
  const meta        = FEATURE_REGISTRY[feature];
  const featureLabel = meta?.label ?? feature;
  const benefits     = meta?.benefits ?? [];

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>

      {/* Optional back button */}
      {onBack && (
        <div className="shrink-0 px-4 pt-5 pb-3 flex items-center gap-3 border-b"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <button onClick={onBack}
            className="p-2 rounded-xl active:scale-95 transition-all"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="rgba(240,244,255,0.95)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>
            </svg>
          </button>
          <p className="font-black text-sm truncate" style={{ color: 'rgba(240,244,255,0.7)' }}>{featureLabel}</p>
        </div>
      )}

      {/* Upgrade prompt */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-5 pb-16">

        {/* Glowing icon */}
        <div className="relative">
          <div className="absolute -inset-3 rounded-[32px] blur-xl opacity-30"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #fbbf24)' }} />
          <div className="relative w-20 h-20 rounded-[28px] flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(251,191,36,0.08))',
              border: '1px solid rgba(245,158,11,0.35)',
              boxShadow: '0 8px 32px rgba(245,158,11,0.15)',
            }}>
            {isExpired && !stillGrace
              ? <Lock size={32} style={{ color: '#fbbf24' }} />
              : <Crown size={32} style={{ color: '#fbbf24' }} />}
          </div>
        </div>

        {/* Headline + description */}
        <div className="space-y-2 max-w-xs">
          {isExpired && !stillGrace ? (
            <>
              <p className="font-black text-xl text-white">Subscription Expired</p>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(148,163,184,0.7)' }}>
                Your plan has expired. Renew to restore access to{' '}
                <span style={{ color: '#fbbf24' }}>{featureLabel}</span> and all Pro features.
              </p>
            </>
          ) : (
            <>
              <p className="font-black text-xl text-white">Pro Feature</p>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(148,163,184,0.7)' }}>
                {meta?.description ?? `${featureLabel} is available on the Pro plan.`}
              </p>
            </>
          )}
        </div>

        {/* Dynamic benefits from registry */}
        {benefits.length > 0 && (
          <div className="w-full max-w-sm rounded-[18px] p-4 text-left"
            style={{
              background: 'linear-gradient(135deg, rgba(245,158,11,0.07), rgba(251,191,36,0.03))',
              border: '1px solid rgba(245,158,11,0.18)',
            }}>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-3"
              style={{ color: 'rgba(245,158,11,0.55)' }}>What you unlock</p>
            <div className="space-y-2.5">
              {benefits.map((b, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'rgba(245,158,11,0.15)' }}>
                    <Crown size={8} style={{ color: '#fbbf24' }} />
                  </div>
                  <span className="text-[11px] font-bold leading-relaxed"
                    style={{ color: 'rgba(226,232,240,0.78)' }}>
                    {b}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="flex flex-col items-center gap-3 w-full max-w-sm">
          {onGoToSubscription ? (
            <button
              onClick={onGoToSubscription}
              className="w-full py-3.5 rounded-[18px] font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
              style={{
                background: 'linear-gradient(135deg, rgba(245,158,11,0.22), rgba(251,191,36,0.12))',
                color: '#fbbf24',
                border: '1px solid rgba(245,158,11,0.4)',
                boxShadow: '0 4px 20px rgba(245,158,11,0.12)',
              }}>
              <Crown size={15} />
              Upgrade to Pro
              <ArrowRight size={13} />
            </button>
          ) : (
            <div
              className="w-full py-3.5 rounded-[18px] font-black text-sm flex items-center justify-center gap-2"
              style={{
                background: 'rgba(245,158,11,0.1)',
                color: 'rgba(251,191,36,0.5)',
                border: '1px solid rgba(245,158,11,0.2)',
              }}>
              <Crown size={15} />
              Pro Feature
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeatureGate;
