/**
 * useKeyboard — Centralized keyboard state management
 *
 * Single source of truth for keyboard open/closed state and height.
 * Uses the `visualViewport` resize API which works on both web and native
 * Android WebView (Capacitor sets windowSoftInputMode="adjustResize" in the
 * manifest, so the viewport genuinely shrinks when the keyboard opens).
 *
 * For keyboard dismissal we reuse the existing safeKeyboardHide() helper
 * from nativeSafe.ts which already handles the Capacitor Keyboard plugin.
 *
 * No new dynamic imports — avoids the Vite mid-session re-optimisation that
 * would otherwise invalidate React chunk hashes and crash the app.
 *
 * Side effects managed here:
 *  • body.keyboard-open class  — consumed by CSS for nav / modal adjustments
 *  • --keyboard-height CSS var — read by keyboard-aware layout rules
 *  • focused-input auto-scroll — ensures active field stays visible
 *
 * Performance: the visualViewport "resize" and "scroll" events fire on every
 * animation frame during the keyboard slide-in (~60fps). A rAF gate collapses
 * all mid-frame calls into at most one handler execution per frame, preventing
 * forced layout thrashing and cascading React re-renders.
 */

import { useEffect, useState } from 'react';
import { safeKeyboardHide } from '../utils/nativeSafe';

// ─── Module-level singleton ───────────────────────────────────────────────────
// All hook instances share one listener set → one set of DOM event bindings.

let _isOpen   = false;
let _height   = 0;
let _inited   = false;

type Listener = () => void;
const _subs = new Set<Listener>();

function _notify() {
  _subs.forEach(fn => fn());
}

// ─── CSS sync ────────────────────────────────────────────────────────────────

function _applyOpen(height: number) {
  _isOpen  = true;
  _height  = height;
  document.body.classList.add('keyboard-open');
  document.documentElement.style.setProperty('--keyboard-height', `${height}px`);
}

function _applyClose() {
  _isOpen  = false;
  _height  = 0;
  document.body.classList.remove('keyboard-open');
  document.documentElement.style.setProperty('--keyboard-height', '0px');
}

// ─── Input auto-scroll ────────────────────────────────────────────────────────

function _scrollFocusedInputIntoView() {
  // One frame defer lets the keyboard animation start so layout is stable
  requestAnimationFrame(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return;
    const tag = el.tagName.toLowerCase();
    const isInput =
      tag === 'input'    ||
      tag === 'textarea' ||
      tag === 'select'   ||
      el.contentEditable === 'true';
    if (!isInput) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      el.scrollIntoView(false);
    }
  });
}

// ─── visualViewport listener ──────────────────────────────────────────────────
// On Android WebView (Capacitor), windowSoftInputMode=adjustResize causes
// the visual viewport to shrink when the keyboard opens — this is the
// reliable cross-platform signal we use instead of Capacitor Keyboard events.
//
// RAF gate: visualViewport fires "resize" and "scroll" on EVERY pixel of
// keyboard animation (~60 events/second). Without throttling this causes
// 60 React state updates per second and 60 forced reflows per second.
// The rAF gate collapses all mid-frame calls into at most one per frame.

function _init() {
  if (_inited) return;
  _inited = true;

  document.documentElement.style.setProperty('--keyboard-height', '0px');

  if (typeof window === 'undefined' || !window.visualViewport) return;

  let _rafId: number | null = null;

  const handle = () => {
    // Already have a frame scheduled — skip this event, the rAF will run.
    if (_rafId !== null) return;

    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      const windowH  = window.innerHeight;
      const vpHeight = window.visualViewport!.height;
      const diff     = windowH - vpHeight;
      // >150 px shrinkage = keyboard open. Smaller deltas = browser chrome / URL bar.
      const nowOpen  = diff > 150;

      if (nowOpen && (!_isOpen || diff !== _height)) {
        _applyOpen(diff);
        _scrollFocusedInputIntoView();
        _notify();
      } else if (!nowOpen && _isOpen) {
        _applyClose();
        _notify();
      }
    });
  };

  window.visualViewport.addEventListener('resize', handle, { passive: true });
  window.visualViewport.addEventListener('scroll', handle, { passive: true });
}

// ─── Public exports ───────────────────────────────────────────────────────────

export interface KeyboardState {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
}

/**
 * React hook — returns live keyboard state.
 * Multiple callers share one listener set; no duplicate event registrations.
 */
export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    isKeyboardOpen: _isOpen,
    keyboardHeight : _height,
  });

  useEffect(() => {
    _init();
    const update: Listener = () =>
      setState({ isKeyboardOpen: _isOpen, keyboardHeight: _height });
    _subs.add(update);
    return () => { _subs.delete(update); };
  }, []);

  return state;
}

/**
 * Synchronous read — for use inside event handlers that can't await React state.
 */
export function isKeyboardCurrentlyOpen(): boolean {
  return _isOpen;
}

/**
 * Dismiss the on-screen keyboard.
 * Blurs the active element (works everywhere) and additionally calls
 * safeKeyboardHide() which wraps Capacitor Keyboard.hide() on native.
 */
export async function dismissKeyboard(): Promise<void> {
  const active = document.activeElement as HTMLElement | null;
  if (active && typeof active.blur === 'function') active.blur();
  await safeKeyboardHide();
}
