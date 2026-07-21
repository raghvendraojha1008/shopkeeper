import { useMemo } from 'react';
import { useSubscription } from '../context/SubscriptionContext';

export interface SubscriptionStatus {
  isPro:     boolean;
  isTrial:   boolean;
  isExpired: boolean;
  isGrace:   boolean;
  isFree:    boolean;
  daysLeft:  number | null;
  hoursLeft: number | null;
  plan:      string;
  status:    string;
  loading:   boolean;
}

/**
 * Lightweight derived hook — returns a flat, memoised status object.
 *
 * Usage:
 *   const { isPro, isTrial, daysLeft } = useSubscriptionStatus();
 *
 * Rules:
 *   isPro      — plan is pro/enterprise AND not expired (includes trial & grace)
 *   isTrial    — status === 'trial' (still within trial window)
 *   isExpired  — status === 'expired' AND grace period has also elapsed
 *   isGrace    — status === 'expired' BUT still within grace window
 *   isFree     — plan is free OR expired with no grace remaining
 *   daysLeft   — whole days until endDate; 0 when past; null when no endDate
 *   hoursLeft  — hours until endDate when daysLeft <= 1; null otherwise
 */
export function useSubscriptionStatus(): SubscriptionStatus {
  const { subscription, loading, isInGracePeriod } = useSubscription();

  return useMemo((): SubscriptionStatus => {
    if (loading || !subscription) {
      return {
        isPro: false, isTrial: false, isExpired: false,
        isGrace: false, isFree: true,
        daysLeft: null, hoursLeft: null,
        plan: 'free', status: 'active', loading: true,
      };
    }

    const { plan, status, endDate } = subscription;

    const isTrial   = status === 'trial';
    const isGrace   = status === 'expired' && isInGracePeriod;
    const isExpired = status === 'expired' && !isInGracePeriod;
    const isPro     = (plan !== 'free') && (status === 'active' || isTrial || isGrace);
    const isFree    = !isPro;

    let daysLeft:  number | null = null;
    let hoursLeft: number | null = null;

    if (endDate) {
      const msLeft = endDate.toMillis() - Date.now();
      if (msLeft > 0) {
        daysLeft  = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
        hoursLeft = daysLeft <= 1 ? Math.ceil(msLeft / (60 * 60 * 1000)) : null;
      } else {
        daysLeft  = 0;
        hoursLeft = 0;
      }
    }

    return { isPro, isTrial, isExpired, isGrace, isFree, daysLeft, hoursLeft, plan, status, loading: false };
  }, [subscription, loading, isInGracePeriod]);
}
