/**
 * UpdateBanner — surfaces "New update available" when LATEST_VERSION (the
 * hand-bumped constant in src/constants/appVersion.ts) is ahead of the user's
 * APP_VERSION. Per the spec ("manual trigger for now"), this is a constant-vs-
 * constant comparison — no remote-config fetch — keeping it offline-safe and
 * adding zero new dependencies.
 *
 * Behaviour:
 *   - Hidden when versions match.
 *   - Dismissible per session (the dismissal is keyed by LATEST_VERSION so a
 *     later release will re-prompt even if the user dismissed an earlier one).
 *   - "Reload" calls window.location.reload() — relies on the service worker /
 *     bundler to pick up the new chunks.
 */

import React, { useState } from 'react';
import { Sparkles, X, RefreshCw, Download } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { APP_VERSION, LATEST_VERSION, hasNewerVersion, getStoreUrl } from '../../constants/appVersion';

const DISMISS_KEY = 'update_banner_dismissed_for';

/**
 * On Capacitor (iOS / Android) the JS bundle is shipped inside the native
 * binary, so window.location.reload() just reloads the same code that's
 * already on disk — it cannot fetch a newer version. Real updates have to
 * come through the App Store / Play Store. So on native we swap the Reload
 * button for "Update" + open the store listing.
 */
const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();

const safeReadDismissed = (): string | null => {
  try { return localStorage.getItem(DISMISS_KEY); }
  catch { return null; }
};

const safeWriteDismissed = (version: string): void => {
  try { localStorage.setItem(DISMISS_KEY, version); }
  catch { /* private mode etc — silent fallback, banner just re-shows next session */ }
};

export const UpdateBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState<boolean>(
    () => safeReadDismissed() === LATEST_VERSION,
  );

  if (!hasNewerVersion()) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    safeWriteDismissed(LATEST_VERSION);
    setDismissed(true);
  };

  const handleAction = () => {
    // Clear the dismissal so a future bump can re-prompt cleanly.
    try { localStorage.removeItem(DISMISS_KEY); } catch { /* noop */ }
    if (isNative) {
      // Native: send to the store. _system tells Capacitor to open in the
      // platform's external browser / store app rather than inside the WebView.
      const url = getStoreUrl(platform === 'ios' ? 'ios' : 'android');
      try { window.open(url, '_system'); }
      catch { /* extremely defensive — store open is best-effort */ }
    } else {
      // Web: a real reload re-fetches the new chunks from the server.
      window.location.reload();
    }
  };

  return (
    <div
      className="px-4 py-2.5 flex items-center gap-3 shrink-0"
      role="status"
      aria-live="polite"
      style={{
        background: 'linear-gradient(90deg, var(--col-accent-18), var(--col-violet-18))',
        borderBottom: '1px solid var(--col-violet-35)',
      }}
    >
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'var(--col-violet-25)' }}>
        <Sparkles size={14} style={{ color: "var(--col-violet-light)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-app-lg font-bold text-white truncate">
          New update available
        </p>
        <p className="text-app-sm" style={{ color: 'rgba(196,181,253,0.7)' }}>
          v{APP_VERSION} → v{LATEST_VERSION}
        </p>
      </div>
      <button
        onClick={handleAction}
        className="px-3 py-2 rounded-lg text-app-md font-bold text-white flex items-center gap-1.5 active:scale-95 transition-transform"
        style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', minHeight: 36 }}
      >
        {isNative
          ? <><Download size={11} /> Update</>
          : <><RefreshCw size={11} /> Reload</>}
      </button>
      <button
        onClick={handleDismiss}
        className="w-9 h-9 rounded-lg flex items-center justify-center active:scale-95 transition-transform"
        style={{ background: 'var(--rgba-white-06)' }}
        aria-label="Dismiss"
      >
        <X size={14} style={{ color: 'rgba(196,181,253,0.7)' }} />
      </button>
    </div>
  );
};

export default UpdateBanner;
