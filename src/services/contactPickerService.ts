/**
 * ContactPickerService
 * ─────────────────────────────────────────────────────────────────────────────
 * Two distinct capabilities:
 *
 *  getAllContactsNative()  — loads the full contacts list silently in background.
 *                            Only works on Capacitor (Android native) where
 *                            we have permission-based bulk access.
 *
 *  pickContactFromDevice() — opens the OS contact picker and lets the user
 *                            choose exactly one contact. Works on:
 *                            • Chrome Android ≥ 80 (Web Contact Picker API)
 *
 *  searchContacts()        — fuzzy-filter a contacts array, returns top 8.
 *  isNativeContacts()      — true if we can bulk-load (Capacitor).
 *  isPickerAvailable()     — true if one-shot picker is available (web only).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Capacitor } from '@capacitor/core';

export interface AppContact {
  name:  string;
  phone: string;
}

let _cachedContacts: AppContact[] | null = null;

/* ── Bulk load — Capacitor native only ──────────────────────────────────── */
export async function getAllContactsNative(): Promise<AppContact[]> {
  if (_cachedContacts !== null) return _cachedContacts;
  if (!Capacitor.isNativePlatform()) return [];

  try {
    const { Contacts } = await import('@capacitor-community/contacts' as any);

    // Check existing permission state first — avoids redundant prompts.
    // Accept both 'granted' (Android) and 'authorized' (iOS legacy) as positive states.
    const GRANTED = ['granted', 'authorized'];
    let alreadyGranted = false;
    try {
      const currentPerm = await Contacts.checkPermissions();
      const state: string = currentPerm?.contacts ?? '';
      alreadyGranted = GRANTED.includes(state);
      // 'denied' / 'restricted' — no point asking again, bail out silently
      if (!alreadyGranted && (state === 'denied' || state === 'restricted')) return [];
    } catch (_) { /* checkPermissions may not exist in older plugin builds */ }

    if (!alreadyGranted) {
      const perm = await Contacts.requestPermissions();
      const grantedState: string = perm?.contacts ?? '';
      if (!GRANTED.includes(grantedState)) return [];
    }

    const result = await Contacts.getContacts({
      projection: { name: true, phones: true },
    });

    const contacts = (result?.contacts ?? []).flatMap((c: any) => {
      const name = c.name?.display || c.name?.given || c.name?.family || '';
      // Handle API differences across plugin versions: phones vs phoneNumbers, number vs value
      const rawPhones: any[] = c.phones ?? c.phoneNumbers ?? [];
      const phones = rawPhones
        .map((p: any) => ((p.number ?? p.value ?? '')).trim())
        .filter(Boolean);
      if (!name) return [];
      return phones.length > 0
        ? phones.map((ph: string) => ({ name, phone: ph }))
        : [{ name, phone: '' }];
    });

    _cachedContacts = contacts;
    return _cachedContacts;
  } catch (e) {
    console.warn('Capacitor Contacts error:', e);
    // Do not cache on error — allow a retry on next form open
    return [];
  }
}

/* ── One-shot picker — Web Contact Picker API only ──────────────────────── */
export async function pickContactFromDevice(): Promise<AppContact | null> {
  // Web Contact Picker API (Chrome Android ≥ 80)
  if ('contacts' in navigator && 'ContactsManager' in window) {
    try {
      const results = await (navigator as any).contacts.select(['name', 'tel'], { multiple: false });
      if (!results || results.length === 0) return null;
      const c     = results[0];
      const name  = (c.name ?? [])[0] ?? '';
      const phone = ((c.tel ?? [])[0] ?? '').trim();
      if (!name) return null;
      return { name, phone };
    } catch (e) {
      console.warn('Web Contact Picker error:', e);
      return null;
    }
  }

  return null;
}

/* ── Availability checks ─────────────────────────────────────────────────── */
/** True if we can bulk-load contacts in background (Capacitor native only) */
export function isNativeContacts(): boolean {
  return Capacitor.isNativePlatform();
}

/** True if the one-shot web picker is available */
export function isPickerAvailable(): boolean {
  if ('contacts' in navigator && 'ContactsManager' in window) return true;
  return false;
}

/* ── Legacy aliases ──────────────────────────────────────────────────────── */
export const getAllContacts       = getAllContactsNative;
export const isContactsAvailable = isPickerAvailable;

/* ── Search — up to 8 suggestions, startsWith ranked first ──────────────── */
export function searchContacts(contacts: AppContact[], query: string): AppContact[] {
  if (!query || !query.trim()) return [];
  const q       = query.toLowerCase().trim();
  const qDigits = q.replace(/\D/g, ''); // digits only for phone matching

  const startsWith = contacts.filter(c => c.name.toLowerCase().startsWith(q));
  const includes   = contacts.filter(c => {
    if (c.name.toLowerCase().startsWith(q)) return false;
    if (c.name.toLowerCase().includes(q)) return true;
    // Phone matching: strip non-digits from both sides so spaces / dashes / country codes don't matter
    if (qDigits.length >= 3) {
      const phoneDigits = c.phone.replace(/\D/g, '');
      if (phoneDigits.includes(qDigits)) return true;
    }
    return false;
  });

  return [...startsWith, ...includes].slice(0, 8);
}

/** Clear cache — call when app resumes or permissions change */
export function clearContactCache(): void {
  _cachedContacts = null;
}
