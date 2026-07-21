/**
 * geminiKey — single source of truth for resolving the Gemini API key.
 *
 * SECURITY NOTE: This is a fully-client-side app, so any API key the browser
 * uses can be extracted from the bundle by a determined user.  The bundled
 * `GEMINI_API_KEY` (from VITE_GEMINI_API_KEY) is therefore at risk of quota
 * abuse if it ships in production builds.  To minimise that exposure we:
 *
 *   1. Prefer a user-supplied key stored in localStorage under
 *      `user_gemini_api_key` — these never leave the user's browser and are
 *      not bundled into the JS your customers download.
 *   2. Fall back to the bundled key only when the user hasn't set their own.
 *
 * Long-term the *correct* fix is a proxy server that holds the key serverside
 * and authenticates requests by Firebase user — but until that exists, BYOK
 * is the most compatible mitigation.
 */

import { GEMINI_API_KEY } from '../config/constants';

const USER_KEY_LS = 'user_gemini_api_key';

function readUserKey(): string {
  try {
    const v = localStorage.getItem(USER_KEY_LS);
    return typeof v === 'string' ? v.trim() : '';
  } catch { return ''; }
}

export function getGeminiApiKey(): string {
  const userKey = readUserKey();
  if (userKey && userKey.length > 10 && !userKey.includes('YOUR_API')) return userKey;
  return GEMINI_API_KEY || '';
}

export function setUserGeminiApiKey(key: string): void {
  try {
    const trimmed = (key || '').trim();
    if (trimmed) localStorage.setItem(USER_KEY_LS, trimmed);
    else         localStorage.removeItem(USER_KEY_LS);
  } catch { /* storage unavailable — silently no-op */ }
}

export function isGeminiConfigured(): boolean {
  const key = getGeminiApiKey();
  return !!key && key.length > 10 && !key.includes('YOUR_API');
}

export function isUsingBundledGeminiKey(): boolean {
  return !readUserKey() && !!GEMINI_API_KEY;
}
