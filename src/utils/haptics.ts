/**
 * Haptics utility — Capacitor-aware
 * ─────────────────────────────────────────────────────────────────────────────
 * Android WebView does NOT support navigator.vibrate().
 * On native Capacitor → uses @capacitor/haptics (native motor).
 * On web browser     → falls back to navigator.vibrate().
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Capacitor } from '@capacitor/core';

const isHapticsEnabled = () => localStorage.getItem('haptics_enabled') !== 'false';

let _Haptics: any = null;
async function getPlugin() {
  if (_Haptics !== undefined) return _Haptics;
  if (!Capacitor.isNativePlatform()) { _Haptics = null; return null; }
  try {
    const mod = await import('@capacitor/haptics');
    _Haptics = mod.Haptics;
  } catch (_) { _Haptics = null; }
  return _Haptics;
}

function webVibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

async function nativeImpact(style: 'LIGHT' | 'MEDIUM' | 'HEAVY') {
  const H = await getPlugin();
  if (!H) return;
  try {
    const { ImpactStyle } = await import('@capacitor/haptics');
    await H.impact({ style: (ImpactStyle as any)[style] ?? style });
  } catch (_) {}
}

async function nativeNotification(type: 'SUCCESS' | 'WARNING' | 'ERROR') {
  const H = await getPlugin();
  if (!H) return;
  try {
    const { NotificationType } = await import('@capacitor/haptics');
    await H.notification({ type: (NotificationType as any)[type] ?? type });
  } catch (_) {}
}

export const haptic = {
  impact: (style: 'light' | 'medium' | 'heavy' = 'medium') => {
    if (!isHapticsEnabled()) return;
    const s = (style === 'heavy' ? 'HEAVY' : style === 'light' ? 'LIGHT' : 'MEDIUM') as any;
    if (Capacitor.isNativePlatform()) nativeImpact(s);
    else webVibrate(style === 'heavy' ? 20 : style === 'light' ? 5 : 10);
  },

  notification: (type: 'success' | 'warning' | 'error') => {
    if (!isHapticsEnabled()) return;
    const t = (type === 'error' ? 'ERROR' : type === 'warning' ? 'WARNING' : 'SUCCESS') as any;
    if (Capacitor.isNativePlatform()) nativeNotification(t);
    else {
      if (type === 'error')   webVibrate([50, 100, 50]);
      else if (type === 'success') webVibrate([10, 50, 10]);
      else webVibrate([30, 30]);
    }
  },

  selection: () => {
    if (!isHapticsEnabled()) return;
    if (Capacitor.isNativePlatform()) nativeImpact('LIGHT');
    else webVibrate(5);
  },

  // Legacy aliases
  light:   () => haptic.impact('light'),
  medium:  () => haptic.impact('medium'),
  heavy:   () => haptic.impact('heavy'),
  success: () => haptic.notification('success'),
  warning: () => haptic.notification('warning'),
  error:   () => haptic.notification('error'),
};

export const setHapticsEnabled = (enabled: boolean) => {
  localStorage.setItem('haptics_enabled', String(enabled));
};

export const vibrate = (pattern: number | number[]) => {
  if (!isHapticsEnabled()) return;
  webVibrate(pattern);
};
