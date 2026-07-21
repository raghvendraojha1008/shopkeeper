/**
 * Error Boundaries — production-grade failure containment
 *
 * Exports:
 * • AppErrorBoundary    — root-level, full-screen fallback, chunk-aware
 * • ErrorBoundary       — alias for AppErrorBoundary (backwards compat)
 * • ScreenErrorBoundary — per-screen, in-place fallback, nav-safe
 * • InlineErrorFallback — static inline widget fallback
 * • ShellErrorBoundary  — silent per-shell-component boundary; renders null on error
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, RotateCcw, Trash2 } from 'lucide-react';
import { errorLogger } from '../../utils/errorLogger';
import { clearAllCaches } from '../../utils/cacheGuard';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isChunkError(error: Error): boolean {
  const msg  = error.message?.toLowerCase() ?? '';
  const name = error.name?.toLowerCase()    ?? '';
  return (
    name === 'chunkloaderror' ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('dynamically imported module') ||
    (msg.includes('failed to fetch') && (msg.includes('.js') || msg.includes('chunk')))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT ERROR BOUNDARY  (Module 1)
// Full-screen fallback, chunk detection, safe recovery actions
// ─────────────────────────────────────────────────────────────────────────────

interface RootProps {
  children : ReactNode;
  fallback?: ReactNode;
}
interface RootState {
  hasError  : boolean;
  isChunk   : boolean;
  error    ?: Error;
}

export class AppErrorBoundary extends Component<RootProps, RootState> {
  public state: RootState = { hasError: false, isChunk: false };

  public static getDerivedStateFromError(error: Error): RootState {
    return {
      hasError : true,
      isChunk  : isChunkError(error),
      error,
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    errorLogger.log('render', error, { componentStack: info.componentStack?.slice(0, 400) }, 'AppErrorBoundary');
  }

  private handleRetry = () => {
    this.setState({ hasError: false, isChunk: false, error: undefined });
  };

  private handleDashboard = () => {
    window.location.hash = '#/';
    window.location.reload();
  };

  private handleFullReset = () => {
    try { clearAllCaches(); } catch {}
    window.location.hash = '#/';
    window.location.reload();
  };

  public render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback)  return this.props.fallback;

    const { isChunk } = this.state;

    return (
      <div
        className="flex h-screen items-center justify-center flex-col p-6 text-center"
        style={{ background: 'var(--app-bg)' }}
      >
        <div className="max-w-xs w-full">

          {/* Icon */}
          <div
            className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
            style={{ background: isChunk ? 'var(--col-accent-15)' : 'var(--col-danger-12)', border: `1px solid ${isChunk ? 'var(--col-accent-35)' : 'var(--col-danger-25)'}` }}
          >
            <AlertTriangle
              className="w-10 h-10"
              style={{ color: isChunk ? "var(--col-indigo)" : "var(--col-danger)" }}
            />
          </div>

          {/* Heading */}
          <h1 className="text-xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
            {isChunk ? 'Update Available' : 'Something went wrong'}
          </h1>

          {/* Body */}
          <p className="text-sm mb-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {isChunk
              ? "A newer version of the app is ready. Reload to get the latest updates."
              : "An unexpected error occurred. Your data is safe — please try one of the options below."}
          </p>

          {/* Error detail — visible only for non-chunk crashes to aid diagnosis */}
          {!isChunk && this.state.error?.message && (
            <p className="text-app-sm mb-6 font-mono px-3 py-2 rounded-xl break-all text-left leading-snug"
              style={{ background: 'var(--col-danger-07)', color: 'rgba(248,113,113,0.65)', border: '1px solid var(--col-danger-12)' }}>
              {this.state.error.message.slice(0, 200)}
            </p>
          )}
          {isChunk && <div className="mb-8" />}

          {/* Actions */}
          <div className="flex flex-col gap-3">
            {isChunk ? (
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3.5 px-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
                style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white', boxShadow: '0 4px 20px var(--col-accent-40)' }}
              >
                <RefreshCw size={16} />
                Reload App
              </button>
            ) : (
              <>
                <button
                  onClick={this.handleRetry}
                  className="w-full py-3.5 px-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white', boxShadow: '0 4px 20px var(--col-accent-35)' }}
                >
                  <RotateCcw size={16} />
                  Try Again
                </button>

                <button
                  onClick={this.handleDashboard}
                  className="w-full py-3.5 px-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                >
                  <Home size={16} />
                  Go to Dashboard
                </button>

                <button
                  onClick={this.handleFullReset}
                  className="w-full py-3 px-4 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  style={{ background: 'var(--col-danger-08)', border: '1px solid var(--col-danger-15)', color: 'rgba(248,113,113,0.7)' }}
                >
                  <Trash2 size={13} />
                  Clear Cache &amp; Restart
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
}

/** Backwards-compatible alias — main.tsx uses `<ErrorBoundary>` */
export const ErrorBoundary = AppErrorBoundary;

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN ERROR BOUNDARY  (Module 2)
// Per-screen, in-place fallback.  Keyed by activeTab so it auto-resets on
// navigation.  Bottom nav and global shell remain fully functional.
// ─────────────────────────────────────────────────────────────────────────────

interface ScreenProps {
  children               : ReactNode;
  /** Called when user taps "Go to Dashboard" */
  onNavigateToDashboard ?: () => void;
  /** Optional screen name shown in the fallback */
  screenName            ?: string;
}
interface ScreenState {
  hasError : boolean;
  isChunk  : boolean;
  error   ?: Error;
}

export class ScreenErrorBoundary extends Component<ScreenProps, ScreenState> {
  public state: ScreenState = { hasError: false, isChunk: false };

  public static getDerivedStateFromError(error: Error): ScreenState {
    return { hasError: true, isChunk: isChunkError(error), error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    errorLogger.log(
      'render', error,
      { screen: this.props.screenName, componentStack: info.componentStack?.slice(0, 300) },
      'ScreenErrorBoundary',
    );
    // Surface full error to console so it's visible in Android logcat / DevTools
    console.error('[ScreenErrorBoundary] Render error on screen:', this.props.screenName);
    console.error('[ScreenErrorBoundary] Error:', error?.message);
    console.error('[ScreenErrorBoundary] Stack:', error?.stack?.slice(0, 800));
  }

  /** Clear stale Virtuoso scroll state from Capacitor WebView sessionStorage */
  private static clearScrollState(): void {
    try {
      ['scroll_parties_v1','scroll_parties_v2',
       'scroll_inv_v1','scroll_inv_v2',
       'scroll_ledger_v1','scroll_ledger_v2'].forEach(k => sessionStorage.removeItem(k));
    } catch {}
  }

  private handleRetry = () => {
    ScreenErrorBoundary.clearScrollState();
    this.setState({ hasError: false, isChunk: false, error: undefined });
  };

  private handleDashboard = () => {
    ScreenErrorBoundary.clearScrollState();
    this.setState({ hasError: false, isChunk: false, error: undefined });
    this.props.onNavigateToDashboard?.();
  };

  private handleFullReset = () => {
    ScreenErrorBoundary.clearScrollState();
    try { clearAllCaches(); } catch {}
    window.location.hash = '#/';
    window.location.reload();
  };

  public render() {
    if (!this.state.hasError) return this.props.children;

    const { isChunk, error } = this.state;
    const screen = this.props.screenName ?? 'this screen';

    // Chunk error: prompt reload
    if (isChunk) {
      return (
        <div className="flex flex-col h-full items-center justify-center p-8 text-center" style={{ background: 'var(--app-bg)' }}>
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'var(--col-accent-15)', border: '1px solid var(--col-accent-35)' }}
          >
            <RefreshCw className="w-7 h-7" style={{ color: "var(--col-indigo)" }} />
          </div>
          <p className="font-black text-base mb-1" style={{ color: 'var(--text-primary)' }}>Update Available</p>
          <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>
            A newer version of this screen is ready.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-2xl font-black text-sm active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white' }}
          >
            Reload App
          </button>
        </div>
      );
    }

    // Normal render error
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center" style={{ background: 'var(--app-bg)' }}>
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)' }}
        >
          <AlertTriangle className="w-7 h-7" style={{ color: "var(--col-danger)" }} />
        </div>

        <p className="font-black text-base mb-1" style={{ color: 'var(--text-primary)' }}>
          {screen.charAt(0).toUpperCase() + screen.slice(1)} couldn't load
        </p>
        <p className="text-xs mb-2 max-w-[240px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Something went wrong on this screen. Your data is safe.
        </p>
        {error?.message && (
          <p className="text-app-sm mb-5 max-w-[240px] font-mono px-3 py-2 rounded-xl break-all text-center leading-snug"
            style={{ background: 'var(--col-danger-07)', color: 'rgba(248,113,113,0.65)', border: '1px solid var(--col-danger-12)' }}>
            {error.message.slice(0, 120)}
          </p>
        )}

        <div className="flex flex-col gap-3 w-full max-w-[220px]">
          <button
            onClick={this.handleRetry}
            className="py-3 px-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'white' }}
          >
            <RotateCcw size={15} />
            Try Again
          </button>

          {this.props.onNavigateToDashboard && (
            <button
              onClick={this.handleDashboard}
              className="py-3 px-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
              style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
            >
              <Home size={15} />
              Dashboard
            </button>
          )}

          <button
            onClick={this.handleFullReset}
            className="py-2.5 px-4 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 active:scale-95 transition-transform"
            style={{ background: 'var(--col-danger-07)', border: '1px solid var(--col-danger-13)', color: 'rgba(248,113,113,0.65)' }}
          >
            <Trash2 size={12} />
            Clear Cache &amp; Restart
          </button>
        </div>
      </div>
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INLINE FALLBACK  — small widget-level placeholder
// ─────────────────────────────────────────────────────────────────────────────

export const InlineErrorFallback = ({ message = 'Failed to load' }: { message?: string }) => (
  <div
    className="flex items-center justify-center p-8 rounded-2xl"
    style={{ background: 'var(--col-danger-05)', border: '1px solid var(--col-danger-12)' }}
  >
    <div className="text-center">
      <AlertTriangle className="w-7 h-7 mx-auto mb-2" style={{ color: 'rgba(248,113,113,0.6)' }} />
      <p className="text-sm font-bold" style={{ color: 'rgba(248,113,113,0.8)' }}>{message}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 text-xs font-bold"
        style={{ color: "var(--col-indigo)" }}
      >
        Try Again
      </button>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SHELL ERROR BOUNDARY — silent per-component containment for shell widgets
//
// Wraps components that live outside ScreenErrorBoundary (banners, snackbars,
// LockScreen, etc.) so a crash in one does NOT trigger the global full-screen
// AppErrorBoundary. On error it renders nothing and logs via errorLogger.
// ─────────────────────────────────────────────────────────────────────────────

interface ShellProps { children: ReactNode; name: string; }
interface ShellState { hasError: boolean; }

export class ShellErrorBoundary extends Component<ShellProps, ShellState> {
  public state: ShellState = { hasError: false };

  public static getDerivedStateFromError(): ShellState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    errorLogger.log(
      'render',
      error,
      { component: this.props.name, componentStack: info.componentStack?.slice(0, 300) },
      `ShellErrorBoundary(${this.props.name})`,
    );
  }

  public render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
