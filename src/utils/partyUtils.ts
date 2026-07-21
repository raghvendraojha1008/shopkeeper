/**
 * partyUtils.ts
 *
 * Party ID-based lookup system.
 *
 * Problem: Records historically stored `party_name` as the join key.
 * When a party was renamed, every related record needed a cascade-write —
 * expensive, quota-consuming, and fragile offline.
 *
 * Solution: Records now also store `party_id` (the Firestore doc ID of the
 * party, which never changes). Display and filter layers look up the current
 * party name from a `PartyMap` derived from the TanStack Query parties cache.
 * That cache is persisted to IndexedDB, so lookups work offline.
 *
 * Backward compatibility: legacy records without `party_id` continue to work
 * via the `party_name` fallback path everywhere.
 */

import { Party } from '../types/models';

export type PartyMap = Map<string, Party>;

/** Build a Map<partyId, Party> from the parties array. */
export function buildPartyMap(parties: Party[]): PartyMap {
  const m = new Map<string, Party>();
  parties.forEach(p => { if (p.id) m.set(p.id, p); });
  return m;
}

/**
 * Resolve the current display name of a party for a given record.
 *
 * Priority:
 *  1. Look up `record.party_id` in partyMap → live name after rename
 *  2. Fall back to `record.party_name` → works for legacy records without party_id
 */
export function resolvePartyName(
  record: { party_id?: string; party_name?: string },
  partyMap: PartyMap,
): string {
  if (record.party_id) {
    const p = partyMap.get(record.party_id);
    if (p) return p.name;
  }
  return record.party_name || '';
}

/**
 * Resolve the full Party object for a given record.
 * Returns null for records whose party has been deleted or is not yet loaded.
 */
export function resolveParty(
  record: { party_id?: string; party_name?: string },
  partyMap: PartyMap,
  parties?: Party[],
): Party | null {
  if (record.party_id) {
    const p = partyMap.get(record.party_id);
    if (p) return p;
  }
  // Name-based fallback for legacy records
  if (record.party_name && parties) {
    return parties.find(p => p.name === record.party_name) || null;
  }
  return null;
}

/**
 * Returns true if a record belongs to the given party.
 *
 * Matching order:
 *  1. If both record and party have IDs → ID match (stable, survives renames)
 *  2. Otherwise → name match (backward compat for legacy records)
 */
export function recordBelongsToParty(
  record: { party_id?: string; party_name?: string },
  party: { id?: string; name: string },
): boolean {
  if (party.id && record.party_id) {
    return record.party_id === party.id;
  }
  // One or both IDs missing — fall back to name (covers legacy records)
  if (party.id && record.party_id !== undefined) {
    // Record has a party_id but it differs from party.id — not a match
    // (prevents name-collision false-positives when both IDs are present)
    if (record.party_id && record.party_id !== party.id) return false;
  }
  return record.party_name === party.name;
}
