/**
 * asyncError — Centralized async error utilities
 *
 * Provides:
 * • AppError — typed, categorized error class
 * • categorizeError(e) — classify any thrown value
 * • toUserMessage(e) — human-readable, jargon-free message
 * • withRetry(fn, opts) — exponential backoff retry
 * • safeAsync(fn, fallback) — wrapper that never throws
 * • withTimeout(promise, ms) — race a promise against a timeout
 */

import { errorLogger, type ErrorCategory } from './errorLogger';

// ── Typed error class ─────────────────────────────────────────────────────────

export type AppErrorCode =
  | 'NETWORK_OFFLINE'
  | 'NETWORK_TIMEOUT'
  | 'AUTH_EXPIRED'
  | 'AUTH_DENIED'
  | 'STORAGE_FULL'
  | 'STORAGE_CORRUPT'
  | 'SYNC_FAILED'
  | 'VALIDATION_INVALID'
  | 'NATIVE_UNAVAIL'
  | 'CHUNK_FAILED'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code       : AppErrorCode;
  readonly category   : ErrorCategory;
  readonly recoverable: boolean;
  readonly original  ?: Error;

  constructor(
    message     : string,
    code        : AppErrorCode  = 'UNKNOWN',
    category    : ErrorCategory = 'unknown',
    recoverable : boolean       = true,
    original   ?: Error,
  ) {
    super(message);
    this.name        = 'AppError';
    this.code        = code;
    this.category    = category;
    this.recoverable = recoverable;
    this.original    = original;
  }
}

// ── Error classification ──────────────────────────────────────────────────────

export function categorizeError(e: unknown): AppError {
  if (e instanceof AppError) return e;

  const err  = e instanceof Error ? e : new Error(String(e));
  const msg  = err.message.toLowerCase();
  const name = (err.name ?? '').toLowerCase();

  // Chunk / dynamic import failures
  if (
    name === 'chunkloaderror' ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('dynamically imported module') ||
    (msg.includes('failed to fetch') && (msg.includes('.js') || msg.includes('chunk')))
  ) {
    return new AppError(
      'App bundle failed to load — a newer version may be available',
      'CHUNK_FAILED', 'chunk', true, err,
    );
  }

  // Network
  if (
    !navigator.onLine ||
    msg.includes('network') ||
    msg.includes('net::err') ||
    (msg.includes('failed to fetch') && !msg.includes('chunk'))
  ) {
    return new AppError('No internet connection', 'NETWORK_OFFLINE', 'network', true, err);
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return new AppError('Request timed out', 'NETWORK_TIMEOUT', 'network', true, err);
  }

  // Auth
  if (
    msg.includes('permission-denied') ||
    msg.includes('unauthorized') ||
    msg.includes('unauthenticated') ||
    msg.includes('auth/')
  ) {
    return new AppError('Authentication required', 'AUTH_EXPIRED', 'auth', false, err);
  }

  // Storage
  if (msg.includes('quota') || msg.includes('indexeddb') || msg.includes('storage')) {
    return new AppError('Storage limit reached', 'STORAGE_FULL', 'storage', true, err);
  }

  // Validation
  if (msg.includes('invalid') || msg.includes('required') || msg.includes('missing')) {
    return new AppError(err.message, 'VALIDATION_INVALID', 'validation', true, err);
  }

  return new AppError(err.message || 'Unknown error', 'UNKNOWN', 'unknown', true, err);
}

// ── Human-readable user messages (no jargon, no stack traces) ────────────────

const USER_MSGS: Record<AppErrorCode, string> = {
  NETWORK_OFFLINE    : "You're offline. Your data is safe and will sync when you reconnect.",
  NETWORK_TIMEOUT    : 'Request took too long. Please check your connection and try again.',
  AUTH_EXPIRED       : 'Your session has expired. Please sign in again.',
  AUTH_DENIED        : "You don't have permission to do that.",
  STORAGE_FULL       : 'Your device storage is full. Please free up some space.',
  STORAGE_CORRUPT    : 'Some cached data was cleared. Please try again.',
  SYNC_FAILED        : 'Unable to sync right now. Your data is safely stored offline.',
  VALIDATION_INVALID : 'Some information is missing or invalid. Please check and try again.',
  NATIVE_UNAVAIL     : "This feature isn't available on your device.",
  CHUNK_FAILED       : 'The app has been updated. Please reload to get the latest version.',
  UNKNOWN            : 'Something went wrong. Please try again.',
};

export function toUserMessage(e: unknown): string {
  const appErr = categorizeError(e);
  return USER_MSGS[appErr.code] ?? USER_MSGS.UNKNOWN;
}

// ── Retry with exponential backoff ────────────────────────────────────────────

export async function withRetry<T>(
  fn   : () => Promise<T>,
  opts : {
    attempts ?: number;
    delayMs  ?: number;
    backoff  ?: number;
    onRetry  ?: (attempt: number, err: unknown) => void;
  } = {},
): Promise<T> {
  const { attempts = 3, delayMs = 800, backoff = 2, onRetry } = opts;
  let last: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const ae = categorizeError(err);
      // Non-recoverable or auth errors: fail immediately, no retry
      if (!ae.recoverable || ae.code === 'AUTH_EXPIRED' || ae.code === 'AUTH_DENIED') throw err;
      onRetry?.(i + 1, err);
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs * Math.pow(backoff, i)));
      }
    }
  }
  throw last;
}

// ── Safe async — never throws ─────────────────────────────────────────────────

export async function safeAsync<T>(
  fn       : () => Promise<T>,
  fallback : T,
  category : ErrorCategory = 'async',
  source  ?: string,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    errorLogger.log(category, e, undefined, source);
    return fallback;
  }
}

// ── Timeout wrapper ───────────────────────────────────────────────────────────

export function withTimeout<T>(
  promise : Promise<T>,
  ms      : number,
  label   = 'operation',
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, rej) =>
      setTimeout(
        () => rej(new AppError(`${label} timed out after ${ms}ms`, 'NETWORK_TIMEOUT', 'network')),
        ms,
      ),
    ),
  ]);
}
