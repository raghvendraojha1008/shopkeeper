import { Subscription, SubscriptionPlan } from '../context/SubscriptionContext';

export type FeatureKey =
  | 'basic'
  | 'waste_tracking'
  | 'analytics'
  | 'advanced_analytics'
  | 'reports'
  | 'pos_billing'
  | 'bulk_import'
  | 'stock_valuation'
  | 'game_timeline'
  | 'whatsapp_reminders'
  | 'multi_user'
  | 'daily_snapshot';

// ── Feature metadata registry ─────────────────────────────────────────────────
// Single source of truth used by FeatureGate, upgrade prompts, and analytics.

export interface FeatureMetadata {
  label: string;
  description: string;
  benefits: string[];
  /** Lucide icon name (string) for dynamic rendering */
  icon: string;
}

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureMetadata> = {
  basic: {
    label: 'Core Billing',
    description: 'Create invoices, manage GST, track sales & purchases',
    benefits: ['GST-ready invoices', 'Customer ledger', 'Party management'],
    icon: 'FileText',
  },
  waste_tracking: {
    label: 'Waste Log',
    description: 'Track inventory losses and spoilage',
    benefits: ['Record waste per item', 'Track loss amounts', 'Date-wise history'],
    icon: 'Trash2',
  },
  analytics: {
    label: 'Sales & Purchase Dashboards',
    description: 'Visual charts for your sales and purchase trends',
    benefits: ['Sales trend charts', 'Purchase analysis', 'Monthly comparisons'],
    icon: 'BarChart2',
  },
  advanced_analytics: {
    label: 'Advanced Analytics',
    description: 'Deep profit, revenue, and expense analysis',
    benefits: ['Profit & loss breakdown', 'Revenue trends', 'Expense analysis', 'GST summary'],
    icon: 'TrendingUp',
  },
  reports: {
    label: 'GST Reports',
    description: 'GSTR-1 export and GST compliance reports',
    benefits: ['GSTR-1 CSV export', 'Tax summary by period', 'HSN-wise breakdown'],
    icon: 'FileBarChart',
  },
  pos_billing: {
    label: 'POS Quick Billing',
    description: 'Point-of-sale billing terminal for fast counter sales',
    benefits: ['One-tap billing', 'Cart & quantity management', 'Instant GST calculation'],
    icon: 'Zap',
  },
  bulk_import: {
    label: 'Bulk CSV Import',
    description: 'Import inventory, parties, and transactions from CSV',
    benefits: ['Import thousands of records at once', 'Supports inventory, parties & transactions', 'Built-in validation & error report'],
    icon: 'Upload',
  },
  stock_valuation: {
    label: 'Stock Valuation',
    description: 'Real-time inventory valuation and stock report',
    benefits: ['Current stock value by item', 'Cost & selling price breakdown', 'Reorder level alerts'],
    icon: 'Package',
  },
  game_timeline: {
    label: 'Activity Timeline',
    description: 'Visual history of all business activity',
    benefits: ['Full audit trail', 'Activity grouped by date', 'Quick jump to any record'],
    icon: 'Activity',
  },
  whatsapp_reminders: {
    label: 'WhatsApp Reminders',
    description: 'Automated payment reminder notifications for overdue parties',
    benefits: ['Auto-schedule daily reminders', 'Overdue party alerts', 'WhatsApp deep-link integration'],
    icon: 'MessageCircle',
  },
  multi_user: {
    label: 'Staff Accounts',
    description: 'Invite and manage staff with role-based access control',
    benefits: ['Unlimited staff members', 'Role-based permissions', 'Activity tracking per user'],
    icon: 'Users',
  },
  daily_snapshot: {
    label: 'Daily Snapshots',
    description: 'Automatic daily CSV archive of all your business data',
    benefits: ['7-day rolling archive', 'CSV export per collection', 'Off-device backup'],
    icon: 'Archive',
  },
};

// ── Plan feature lists ────────────────────────────────────────────────────────

export const PLAN_FEATURES: Record<SubscriptionPlan, FeatureKey[]> = {
  free: [
    'basic',
    'waste_tracking',
  ],
  pro: [
    'basic',
    'waste_tracking',
    'analytics',
    'advanced_analytics',
    'reports',
    'pos_billing',
    'bulk_import',
    'stock_valuation',
    'game_timeline',
    'whatsapp_reminders',
    'multi_user',
    'daily_snapshot',
  ],
  enterprise: [
    'basic',
    'waste_tracking',
    'analytics',
    'advanced_analytics',
    'reports',
    'pos_billing',
    'bulk_import',
    'stock_valuation',
    'game_timeline',
    'whatsapp_reminders',
    'multi_user',
    'daily_snapshot',
  ],
};

// ── Labels & display names ────────────────────────────────────────────────────

export const FEATURE_LABELS: Record<FeatureKey, string> = Object.fromEntries(
  (Object.entries(FEATURE_REGISTRY) as [FeatureKey, FeatureMetadata][]).map(
    ([k, v]) => [k, v.label]
  )
) as Record<FeatureKey, string>;

export const PLAN_DISPLAY_NAMES: Record<SubscriptionPlan, string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

// ── Grace period constant ─────────────────────────────────────────────────────
// Static fallback used by isInGracePeriod when graceEndDate is not stored on the doc.
// The dynamic value lives in SubscriptionContext.gracePeriodMsRef (updated via onSnapshot).

export const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// ── Access helpers ────────────────────────────────────────────────────────────

/**
 * Returns true if the subscription is expired but still within the grace window.
 *
 * Priority:
 *  1. Use stored `graceEndDate` (written by SubscriptionService/admin with config's gracePeriodDays).
 *  2. Fall back to endDate + static GRACE_PERIOD_MS constant.
 */
export function isInGracePeriod(subscription: Subscription | null): boolean {
  if (!subscription || subscription.status !== 'expired') return false;
  const now = Date.now();
  // Prefer the pre-computed graceEndDate written by the service
  if (subscription.graceEndDate) return now <= subscription.graceEndDate.toMillis();
  if (!subscription.endDate) return false;
  return (now - subscription.endDate.toMillis()) <= GRACE_PERIOD_MS;
}

/**
 * Central multi-layer access gate. ALWAYS call this — never hardcode checks inline.
 *
 * Evaluation order:
 * 1. No subscription object → deny (user must pay or wait for admin grant).
 * 2. appMode === 'free' → grant all Pro features (global admin override — development mode only).
 * 3. Active / trial / grace → check plan features (live Firestore features preferred over static map).
 * 4. Expired past grace → only Free features, regardless of stored plan.
 *
 * @param subscription  - current user subscription from SubscriptionContext
 * @param feature       - feature key to check
 * @param appMode       - optional global app mode from config/global ('free' | 'paid' | 'hybrid')
 * @param liveFeatures  - optional live plan.features[] from Firestore; overrides static PLAN_FEATURES
 *                        when provided. Pass from SubscriptionContext.plans for data-driven gating.
 */
export function hasAccess(
  subscription: Subscription | null,
  feature: FeatureKey,
  appMode?: string,
  liveFeatures?: string[],
): boolean {
  // appMode: 'free' — entire app is open access (global admin override)
  // Check BEFORE the null-subscription guard so the kill switch works even during
  // first-login when the Firestore subscription doc hasn't loaded yet.
  if (appMode === 'free') return PLAN_FEATURES.pro.includes(feature);

  // subscription is null only during initial load (no cache yet for this user).
  // Fall back to free-plan access rather than blocking everything — the real
  // subscription will arrive within milliseconds and update the UI.
  if (!subscription) return PLAN_FEATURES.free.includes(feature);

  // Resolve the feature list: prefer live Firestore data, fall back to static map
  const planFeatures: string[] =
    liveFeatures ?? PLAN_FEATURES[subscription.plan] ?? PLAN_FEATURES.free;
  const freeFeatures: string[] = PLAN_FEATURES.free;

  if (subscription.status === 'expired') {
    if (isInGracePeriod(subscription)) {
      return planFeatures.includes(feature);
    }
    return freeFeatures.includes(feature);
  }

  // 'grace' status: subscription is in grace window — retain full plan access
  if (subscription.status === 'grace') {
    return planFeatures.includes(feature);
  }

  return planFeatures.includes(feature);
}

export function getPlanFeatures(plan: SubscriptionPlan): FeatureKey[] {
  return PLAN_FEATURES[plan] ?? PLAN_FEATURES.free;
}

/**
 * Returns the minimum plan that grants access to a given feature.
 */
export function requiredPlanForFeature(feature: FeatureKey): SubscriptionPlan {
  if (PLAN_FEATURES.free.includes(feature)) return 'free';
  if (PLAN_FEATURES.pro.includes(feature)) return 'pro';
  return 'enterprise';
}

// ── Navigation guard map ──────────────────────────────────────────────────────
// Maps tab names (used in setActiveTab) → FeatureKey they require.
// Used by safeNavigate in App.tsx to gate tab access before rendering.

export const TAB_FEATURE_GATE: Record<string, FeatureKey> = {
  'bulk-import':     'bulk_import',
  'analytics':       'advanced_analytics',
  'pos-billing':     'pos_billing',
  'stock-valuation': 'stock_valuation',
  'game-timeline':   'game_timeline',
  'daily-snapshots': 'daily_snapshot',
  'reports':         'reports',
};
