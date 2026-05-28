/**
 * App version — single source of truth.
 *
 * APP_VERSION   — what's currently shipped to the user. Bump on every release.
 * LATEST_VERSION — what the user should be on. When this is greater than
 *                  APP_VERSION, the UpdateBanner surfaces a "New update
 *                  available" prompt. Per the spec ("manual trigger for now")
 *                  this is a hand-bumped constant rather than a remote-config
 *                  fetch — keeps everything offline-safe and dependency-free.
 *
 * Version is also stamped onto every feedback / analytics / error-log row by
 * telemetryService so we can debug "this only happens on 1.0.x" issues.
 */
export const APP_VERSION    = '1.0.0';
export const LATEST_VERSION = '1.0.0';

/**
 * Semver-ish comparator (a vs b).
 * Returns -1 if a < b, 0 if equal, 1 if a > b. Tolerates missing segments
 * (treats them as 0) and ignores anything after a hyphen (pre-release tag).
 */
export const compareVersions = (a: string, b: string): -1 | 0 | 1 => {
  const norm = (v: string) => v.split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const av = norm(a);
  const bv = norm(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
};

/** True when a newer version is available than the user is currently running. */
export const hasNewerVersion = (): boolean =>
  compareVersions(APP_VERSION, LATEST_VERSION) < 0;

/**
 * Store listings for the native builds. Used by UpdateBanner to send the user
 * to the right place when they tap "Update" on iOS / Android — `window.location
 * .reload()` is meaningless inside a Capacitor WebView because the JS bundle is
 * shipped INSIDE the native binary, so reloading just re-runs the same code
 * that's already on disk. Real updates land via the App Store / Play Store.
 *
 * Android: `appId` from capacitor.config.ts. The market:// scheme opens the
 * Play Store app directly; if it's missing we fall back to the https URL via
 * the `_system` window.open target which Capacitor routes to the system browser.
 *
 * iOS: leave empty until the app is published and we have a numeric App Store
 * ID (e.g. id1234567890). Until then the iOS path opens a search URL.
 */
export const ANDROID_PACKAGE_ID = 'com.shopledger.india';
export const IOS_APP_ID         = '';   // TODO: fill in after App Store submission

export const getStoreUrl = (platform: 'ios' | 'android'): string => {
  if (platform === 'android') {
    return `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_ID}`;
  }
  // iOS: numeric App Store ID required for a deep link; until we have it,
  // fall back to a search URL so the user can still find the app.
  return IOS_APP_ID
    ? `https://apps.apple.com/app/id${IOS_APP_ID}`
    : 'https://apps.apple.com/search?term=Shopkeeper%20Ledger';
};
