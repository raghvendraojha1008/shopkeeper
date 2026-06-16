/**
 * nativeSafe — Safe Capacitor API wrappers
 *
 * Every exported function:
 * • Catches ALL errors (plugin not installed, permission denied, user cancelled…)
 * • Returns { ok, result } | { ok: false, error } — never throws
 * • Logs real failures via errorLogger (skips user-cancelled events)
 * • Degrades gracefully on web / unsupported devices
 */

import { Capacitor } from '@capacitor/core';
import { errorLogger } from './errorLogger';

export type NativeResult<T = void> =
  | { ok: true;  result: T    }
  | { ok: false; error: Error };

function asErr(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

function isUserCancel(err: Error): boolean {
  const m = err.message.toLowerCase();
  return m.includes('cancel') || m.includes('abort') || m.includes('dismiss');
}

// ── Share ─────────────────────────────────────────────────────────────────────

export async function safeShare(opts: {
  title?      : string;
  text?       : string;
  url?        : string;
  files?      : string[];
  dialogTitle?: string;
}): Promise<NativeResult> {
  try {
    const { Share } = await import('@capacitor/share');
    const check = await Share.canShare().catch(() => ({ value: false }));
    if (!check.value) {
      // Web fallback via navigator.share
      if (navigator.share && (opts.url || opts.text)) {
        await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
        return { ok: true, result: undefined };
      }
      return { ok: false, error: new Error('Share not supported on this device') };
    }
    await Share.share(opts);
    return { ok: true, result: undefined };
  } catch (e) {
    const err = asErr(e);
    if (!isUserCancel(err)) {
      errorLogger.log('native', err, { action: 'share' }, 'nativeSafe');
    }
    return { ok: false, error: err };
  }
}

// ── Haptics ───────────────────────────────────────────────────────────────────

export async function safeHaptic(
  style: 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'SUCCESS' | 'WARNING' | 'ERROR' = 'LIGHT',
): Promise<void> {
  // Respect user preference
  if (localStorage.getItem('haptics_enabled') === 'false') return;
  try {
    if (Capacitor.isNativePlatform()) {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
      if (style === 'SUCCESS' || style === 'WARNING' || style === 'ERROR') {
        await Haptics.notification({
          type: style === 'SUCCESS' ? NotificationType.Success
              : style === 'WARNING' ? NotificationType.Warning
              : NotificationType.Error,
        });
      } else {
        await Haptics.impact({
          style: style === 'HEAVY'  ? ImpactStyle.Heavy
               : style === 'MEDIUM' ? ImpactStyle.Medium
               : ImpactStyle.Light,
        });
      }
    } else if (navigator.vibrate) {
      navigator.vibrate(style === 'HEAVY' ? 80 : style === 'MEDIUM' ? 40 : 15);
    }
  } catch {
    // Haptic failure is never user-visible; swallow silently
  }
}

// ── Status bar ────────────────────────────────────────────────────────────────

export async function safeStatusBar(color: string, darkContent = false): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setBackgroundColor({ color });
    await StatusBar.setStyle({ style: darkContent ? Style.Light : Style.Dark });
  } catch (e) {
    errorLogger.log('native', e, { action: 'statusBar', color }, 'nativeSafe');
  }
}

// ── Camera permission ─────────────────────────────────────────────────────────

export async function safeRequestCamera(): Promise<NativeResult<boolean>> {
  if (!Capacitor.isNativePlatform()) return { ok: true, result: false };
  try {
    const { Camera } = await import(/* @vite-ignore */ '@capacitor/camera');
    const p = await Camera.requestPermissions({ permissions: ['camera'] });
    return { ok: true, result: p.camera === 'granted' || p.camera === 'limited' };
  } catch (e) {
    errorLogger.log('native', e, { action: 'cameraPermission' }, 'nativeSafe');
    return { ok: false, error: asErr(e) };
  }
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

export async function safeKeyboardHide(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    await Keyboard.hide();
  } catch {
    // Not critical; swallow
  }
}

/**
 * safeKeyboardInit — called once at app startup on native platforms.
 * Configures Android keyboard behaviour:
 *  • Disable the WebView's own scroll assist (we handle scrolling ourselves)
 *  • Hide the accessory input bar (no extra chrome above the keyboard)
 * Safe no-op on web and if the plugin is unavailable.
 */
export async function safeKeyboardInit(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    await Keyboard.setScroll({ isDisabled: true }).catch(() => {});
    await Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
  } catch {
    // Plugin not available — safe to ignore
  }
}

// ── Generic safe Capacitor call ───────────────────────────────────────────────

/**
 * Wrap any Capacitor call in a safe envelope.
 * Usage: safeNative(() => StatusBar.hide(), 'StatusBar.hide')
 */
export async function safeNative<T>(
  fn    : () => Promise<T>,
  label : string,
): Promise<NativeResult<T>> {
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (e) {
    const err = asErr(e);
    if (!isUserCancel(err)) {
      errorLogger.log('native', err, { action: label }, 'nativeSafe');
    }
    return { ok: false, error: err };
  }
}
