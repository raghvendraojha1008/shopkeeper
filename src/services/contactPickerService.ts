/**
 * ContactPickerService
 * ─────────────────────────────────────────────────────────────────────────────
 *  getAllContactsNative()      — bulk-loads ALL contacts silently on Capacitor.
 *  loadContactsFromWebPicker() — web Chrome: opens picker w/ multiple:true,
 *                                user selects contacts → stored for suggestions.
 *  pickContactFromDevice()    — opens OS picker, user picks one contact.
 *  searchContacts()           — fuzzy-filter, returns top 4.
 *  isNativeContacts()         — true if Capacitor native.
 *  isPickerAvailable()        — true if Web Contact Picker API available.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Capacitor } from '@capacitor/core';
// Static import — dynamic import is unreliable on Android because the Capacitor
// bridge may not be ready when a dynamic import resolves, causing silent failures.
import { Contacts } from '@capacitor-community/contacts';
import { GoogleTokenService } from './googleTokenService';

const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';

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
    const GRANTED = ['granted', 'authorized'];
    let alreadyGranted = false;
    try {
      const currentPerm = await Contacts.checkPermissions();
      const state: string = (currentPerm as any)?.contacts ?? '';
      alreadyGranted = GRANTED.includes(state);
      if (!alreadyGranted && (state === 'denied' || state === 'restricted')) return [];
    } catch (_) { /* older plugin builds may not have checkPermissions */ }

    if (!alreadyGranted) {
      const perm = await Contacts.requestPermissions();
      const grantedState: string = (perm as any)?.contacts ?? '';
      if (!GRANTED.includes(grantedState)) return [];
    }

    const result = await Contacts.getContacts({
      projection: { name: true, phones: true },
    });

    const contacts: AppContact[] = (result?.contacts ?? []).flatMap((c: any) => {
      const name =
        c.name?.display ||
        (c.name?.given || '') + (c.name?.family ? ' ' + c.name.family : '') ||
        '';
      const trimmedName = name.trim();
      if (!trimmedName) return [];

      const rawPhones: any[] = c.phones ?? c.phoneNumbers ?? [];
      const phones = rawPhones
        .map((p: any) => ((p.number ?? p.value ?? '')).replace(/\s+/g, ''))
        .filter(Boolean);

      return phones.length > 0
        ? phones.map((ph: string) => ({ name: trimmedName, phone: ph }))
        : [{ name: trimmedName, phone: '' }];
    });

    _cachedContacts = contacts;
    return _cachedContacts;
  } catch (e) {
    console.warn('[ContactPickerService] getContacts error:', e);
    return [];
  }
}

/* ── Bulk load from Web Contact Picker (multiple:true) ───────────────────── */
/** Opens the OS contacts picker on Chrome Android; user selects as many
 *  contacts as they want. All selected contacts are stored in the cache
 *  and returned so the form can use them for inline suggestions. */
export async function loadContactsFromWebPicker(): Promise<AppContact[]> {
  if (!isPickerAvailable()) return [];
  try {
    const results = await (navigator as any).contacts.select(
      ['name', 'tel'],
      { multiple: true },
    );
    if (!results || results.length === 0) return [];

    const contacts: AppContact[] = results.flatMap((c: any) => {
      const name: string = (c.name ?? [])[0] ?? '';
      if (!name.trim()) return [];
      const tels: string[] = c.tel ?? [];
      return tels.length > 0
        ? tels.map((t: string) => ({ name: name.trim(), phone: t.trim() }))
        : [{ name: name.trim(), phone: '' }];
    });

    // Merge with any existing cache (e.g. from a previous bulk load)
    const existing = _cachedContacts ?? [];
    const merged   = [...existing, ...contacts];
    // Deduplicate by name+phone
    const seen  = new Set<string>();
    _cachedContacts = merged.filter(c => {
      const key = `${c.name}|${c.phone}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return _cachedContacts;
  } catch (e) {
    console.warn('[ContactPickerService] loadContactsFromWebPicker error:', e);
    return [];
  }
}

/* ── One-shot picker — picks a single contact ────────────────────────────── */
export async function pickContactFromDevice(): Promise<AppContact | null> {
  if (!isPickerAvailable()) return null;
  try {
    const results = await (navigator as any).contacts.select(
      ['name', 'tel'],
      { multiple: false },
    );
    if (!results || results.length === 0) return null;
    const c     = results[0];
    const name  = ((c.name ?? [])[0] ?? '').trim();
    const phone = ((c.tel  ?? [])[0] ?? '').trim();
    if (!name) return null;
    return { name, phone };
  } catch (e) {
    console.warn('[ContactPickerService] pickContactFromDevice error:', e);
    return null;
  }
}

/* ── Availability checks ─────────────────────────────────────────────────── */
export function isNativeContacts(): boolean {
  return Capacitor.isNativePlatform();
}

export function isPickerAvailable(): boolean {
  return 'contacts' in navigator && 'ContactsManager' in window;
}

/* ── Google People API — loads contacts using the OAuth token from login ─── */
/** Silently fetches all Google Contacts using the stored OAuth access token.
 *  Returns [] immediately if the user never signed in with Google or the token
 *  expired (caller should show the manual "Load Contacts" button as fallback). */
export async function loadContactsFromGoogle(): Promise<AppContact[]> {
  const token = GoogleTokenService.get();
  if (!token || !GoogleTokenService.hasScope(CONTACTS_SCOPE)) return [];

  try {
    const all: AppContact[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL('https://people.googleapis.com/v1/people/me/connections');
      url.searchParams.set('personFields', 'names,phoneNumbers');
      url.searchParams.set('pageSize',     '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) break;

      const data = await res.json();
      for (const c of data.connections ?? []) {
        const name = (c.names?.[0]?.displayName ?? '').trim();
        if (!name) continue;
        const phones: string[] = (c.phoneNumbers ?? [])
          .map((p: any) => (p.value ?? '').replace(/\s+/g, ''))
          .filter(Boolean);
        if (phones.length > 0) {
          phones.forEach(ph => all.push({ name, phone: ph }));
        } else {
          all.push({ name, phone: '' });
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    if (all.length > 0) _cachedContacts = all;
    return all;
  } catch (e) {
    console.warn('[ContactPickerService] Google People API error:', e);
    return [];
  }
}

/* ── Legacy aliases ──────────────────────────────────────────────────────── */
export const getAllContacts       = getAllContactsNative;
export const isContactsAvailable = isPickerAvailable;

/* ── Search — up to 4 suggestions, startsWith ranked first ─────────────── */
export function searchContacts(contacts: AppContact[], query: string): AppContact[] {
  if (!query || !query.trim()) return [];
  const q       = query.toLowerCase().trim();
  const qDigits = q.replace(/\D/g, '');

  const startsWith = contacts.filter(c => c.name.toLowerCase().startsWith(q));
  const includes   = contacts.filter(c => {
    if (c.name.toLowerCase().startsWith(q)) return false;
    if (c.name.toLowerCase().includes(q))   return true;
    if (qDigits.length >= 3) {
      const phoneDigits = c.phone.replace(/\D/g, '');
      if (phoneDigits.includes(qDigits)) return true;
    }
    return false;
  });

  return [...startsWith, ...includes].slice(0, 4);
}

/** Clear cache — call when app resumes or permissions change */
export function clearContactCache(): void {
  _cachedContacts = null;
}
