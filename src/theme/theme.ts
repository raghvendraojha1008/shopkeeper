import type { AppSettings } from '../types';

export type CustomHsl = { h: number; s: number; l: number };

export type ThemePresetId =
  | 'warm-saffron'
  | 'rose-gulab'
  | 'marigold'
  | 'coral'
  | 'terracotta'
  | 'mango'
  | 'pomegranate'
  | 'cinnamon'
  | 'sunset'
  | 'peach'
  | 'chai'
  | 'berry'
  | 'plum'
  | 'mint-tea'
  | 'custom';

export const DEFAULT_THEME_ID: ThemePresetId = 'warm-saffron';

export const THEME_PRESETS: Array<{ id: Exclude<ThemePresetId, 'custom'>; label: string; cssVar: string }> = [
  { id: 'warm-saffron', label: 'Saffron', cssVar: '--preset-warm-saffron' },
  { id: 'rose-gulab', label: 'Gulab', cssVar: '--preset-rose-gulab' },
  { id: 'marigold', label: 'Marigold', cssVar: '--preset-marigold' },
  { id: 'coral', label: 'Coral', cssVar: '--preset-coral' },
  { id: 'terracotta', label: 'Terracotta', cssVar: '--preset-terracotta' },
  { id: 'mango', label: 'Mango', cssVar: '--preset-mango' },
  { id: 'pomegranate', label: 'Anar', cssVar: '--preset-pomegranate' },
  { id: 'cinnamon', label: 'Cinnamon', cssVar: '--preset-cinnamon' },
  { id: 'sunset', label: 'Sunset', cssVar: '--preset-sunset' },
  { id: 'peach', label: 'Peach', cssVar: '--preset-peach' },
  { id: 'chai', label: 'Chai', cssVar: '--preset-chai' },
  { id: 'berry', label: 'Berry', cssVar: '--preset-berry' },
  { id: 'plum', label: 'Plum', cssVar: '--preset-plum' },
  { id: 'mint-tea', label: 'Mint', cssVar: '--preset-mint-tea' },
];

export function normalizeThemeId(input: unknown): ThemePresetId {
  if (typeof input !== 'string') return DEFAULT_THEME_ID;
  const id = input.trim().toLowerCase();
  const known = new Set<string>([...THEME_PRESETS.map((p) => p.id), 'custom']);
  return (known.has(id) ? (id as ThemePresetId) : DEFAULT_THEME_ID);
}

export function normalizeAppSettings(raw: any, defaults: AppSettings): AppSettings {
  const safeRaw = raw || {};

  const merged: any = {
    ...defaults,
    ...safeRaw,
    profile: {
      ...defaults.profile,
      ...(safeRaw.profile || {}),
    },
    preferences: {
      ...defaults.preferences,
      ...(safeRaw.preferences || {}),
    },
    automation: {
      ...defaults.automation,
      ...(safeRaw.automation || {}),
    },
    field_visibility: {
      ...defaults.field_visibility,
      ...(safeRaw.field_visibility || {}),
    },
    custom_lists: {
      ...defaults.custom_lists,
      ...(safeRaw.custom_lists || {}),
    },
  };

  // Legacy compatibility (some older data stored these at root)
  if (safeRaw.dark_mode != null && merged.preferences.dark_mode == null) {
    merged.preferences.dark_mode = !!safeRaw.dark_mode;
  }
  if (safeRaw.currency_symbol && !merged.profile.currency_symbol) {
    merged.profile.currency_symbol = safeRaw.currency_symbol;
  }

  // Security normalization: canonical is { enabled, pin }
  const rawSecurity = safeRaw.security || {};
  const enabled =
    rawSecurity.enabled ?? rawSecurity.app_lock_enabled ?? rawSecurity.appLockEnabled ?? defaults.security?.enabled ?? false;
  const pin = typeof rawSecurity.pin === 'string' ? rawSecurity.pin : defaults.security?.pin || '';
  const enable_biometrics = rawSecurity.enable_biometrics ?? defaults.security?.enable_biometrics ?? false;
  merged.security = {
    enabled: !!enabled,
    pin,
    enable_biometrics: !!enable_biometrics,
    auto_lock_minutes: rawSecurity.auto_lock_minutes ?? defaults.security?.auto_lock_minutes,
  };

  merged.preferences.theme = normalizeThemeId(merged.preferences.theme);

  return merged as AppSettings;
}

export function applyThemeToDocument(settings: AppSettings) {
  const root = document.documentElement;
  const theme = normalizeThemeId(settings?.preferences?.theme);
  const custom = settings?.preferences?.custom_primary_hsl;
  const isDark = settings?.preferences?.dark_mode ?? false;

  root.dataset.themeMode = isDark ? 'dark' : 'light';
  // Force native system pickers (date, time, color) to match the app theme.
  // This controls the color-scheme used by browser-native UI elements like
  // the Android date picker popup.
  root.style.setProperty('color-scheme', isDark ? 'dark' : 'light');

  if (theme === 'custom' && custom) {
    root.dataset.theme = 'custom';
    root.style.setProperty('--primary', `${clamp(custom.h, 0, 360)} ${clamp(custom.s, 0, 100)}% ${clamp(custom.l, 0, 100)}%`);
    return;
  }

  root.dataset.theme = theme;
  root.style.removeProperty('--primary');
}

function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}







