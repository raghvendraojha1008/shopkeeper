import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { errorLogger } from './utils/errorLogger';
import { crashReporter } from './services/crashReporter';
import { checkAndMigrateSchema } from './utils/cacheGuard';
import { lifecycleManager } from './services/lifecycleManager';
import { initPerformanceObserver } from './hooks/usePerformanceObserver';
import { Capacitor } from '@capacitor/core';
import './index.css';

// ── Schema migration (Module 4) ───────────────────────────────────────────────
checkAndMigrateSchema();

// ── Lifecycle manager (Module 1) ──────────────────────────────────────────────
lifecycleManager.init();

// ── Performance observer (dev-only) ──────────────────────────────────────────
initPerformanceObserver();

// ── Bootstrap crash reporter ──────────────────────────────────────────────────
crashReporter.init({
  getUid   : () => {
    try { return (window as any).__crashReporterUid__ ?? null; } catch { return null; }
  },
  getScreen: () => {
    try { return (window as any).__crashReporterScreen__ ?? 'unknown'; } catch { return 'unknown'; }
  },
});

// ── Android GPU fix: completely disable all GPU-heavy CSS effects ─────────────
if (Capacitor.getPlatform() === 'android') {
  document.documentElement.classList.add('android-no-backdrop');

  // Inject a global style sheet that kills backdrop-filter, filter, and heavy shadows
  const style = document.createElement('style');
  style.textContent = `
    /* Disable all backdrop and filter effects */
    * {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      filter: none !important;
    }
    /* Replace expensive radial gradients with a solid light background */
    [style*="radial-gradient"] {
      background: rgba(0,0,0,0.05) !important;
      background-image: none !important;
    }
    /* Reduce heavy box-shadows to a simple subtle shadow */
    [style*="box-shadow"],
    [class*="shadow"] {
      box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important;
    }
  `;
  document.head.appendChild(style);

  // Also remove any inline backdrop-filter styles that may have been added before this runs
  const allElements = document.querySelectorAll('[style]');
  for (const el of allElements) {
    const styleAttr = el.getAttribute('style');
    if (styleAttr && /backdrop[-]?filter/i.test(styleAttr)) {
      const newStyle = styleAttr.replace(/backdrop[-]?filter:\s*[^;]+;?/gi, '');
      if (newStyle.trim()) {
        el.setAttribute('style', newStyle);
      } else {
        el.removeAttribute('style');
      }
    }
  }
}

// ── Global error handlers ────────────────────────────────────────────────────

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? 'Unknown rejection'));
  const msg = err.message.toLowerCase();

  if (msg.includes('auth/network-request-failed') || msg.includes('auth/too-many-requests')) return;

  if (
    msg.includes('dynamically imported module') ||
    msg.includes('loading chunk') ||
    (msg.includes('failed to fetch') && (msg.includes('.js') || msg.includes('chunk')))
  ) {
    errorLogger.log('chunk', err, {}, 'window.unhandledrejection');
    return;
  }

  errorLogger.log('async', err, {}, 'window.unhandledrejection');
});

window.addEventListener('error', (event: ErrorEvent) => {
  if (!event.error) return;
  errorLogger.log(
    'render',
    event.error instanceof Error ? event.error : new Error(event.message),
    { filename: event.filename, lineno: event.lineno },
    'window.error',
  );
});

// ── Root mount ────────────────────────────────────────────────────────────────

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);