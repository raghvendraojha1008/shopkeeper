/**
 * partySync.ts
 *
 * When a party record is edited (name, address, GSTIN, site, etc.), every
 * denormalized copy of that data across related Firestore collections must be
 * updated so PartyDetailView still finds the records under the new name.
 *
 * Collections updated:
 *   ledger_entries      — party_name, address, site
 *   transactions        — party_name
 *   misc_charges        — party_name, party_id
 *   recurring_templates — party_name
 *
 * The update runs as a background operation after the party doc itself is
 * saved.  Firestore batches are limited to 500 ops; we chunk in groups of 400.
 */

import {
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  doc as fsDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { queryClient } from '../context/DataContext';
import { TelemetryService } from './telemetryService';

const BATCH_CHUNK = 400;

interface UpdatedPartyFields {
  name: string;
  address?: string;
  site?: string;
  gstin?: string;
  contact?: string;
  state?: string;
}

/** Commit an array of [docRef, partialUpdate] in chunked batches. */
async function flushUpdates(updates: Array<[any, Record<string, any>]>): Promise<void> {
  for (let i = 0; i < updates.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    updates.slice(i, i + BATCH_CHUNK).forEach(([ref, data]) => batch.update(ref, data));
    await batch.commit();
  }
}

/**
 * Cascade a party edit to all denormalized copies in related collections.
 *
 * @param uid          Firebase user UID
 * @param partyId      Firestore document ID of the party
 * @param oldName      The party name BEFORE the edit (used to query existing records)
 * @param updated      The new field values from the edited party form
 * @returns            Total number of sub-documents updated
 */
export async function syncPartyToRecords(
  uid: string,
  partyId: string,
  oldName: string,
  updated: UpdatedPartyFields,
): Promise<number> {
  const newName = updated.name;
  let totalUpdated = 0;

  // ── 1. ledger_entries ────────────────────────────────────────────────────
  // Query by BOTH party_id (preferred, stable) AND party_name (legacy/fallback)
  // so records without party_id are still updated by name.
  // Each updated record also gets party_id stamped, so future cascades
  // can use the ID-based path reliably.
  try {
    const col = collection(db, `users/${uid}/ledger_entries`);
    const [byNameSnap, byIdSnap] = await Promise.all([
      getDocs(query(col, where('party_name', '==', oldName))),
      getDocs(query(col, where('party_id', '==', partyId))),
    ]);
    const seen = new Set<string>();
    const allDocs = [...byNameSnap.docs, ...byIdSnap.docs].filter(d => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
    if (allDocs.length > 0) {
      const updatedIds = new Set(allDocs.map(d => d.id));
      const updates: Array<[any, Record<string, any>]> = allDocs.map(d => {
        const fields: Record<string, any> = { party_name: newName, party_id: partyId };
        if (updated.address !== undefined) fields.address = updated.address;
        if (updated.site    !== undefined) fields.site    = updated.site;
        return [fsDoc(db, `users/${uid}/ledger_entries`, d.id), fields];
      });
      await flushUpdates(updates);
      totalUpdated += updates.length;

      // Immediately patch the React Query ledger cache so UI reflects the new
      // name without waiting for the background refetch to complete.
      // The subsequent invalidateQueries (step 5) will reconcile with Firestore.
      queryClient.setQueryData(['ledger', uid], (old: any[] = []) =>
        old.map(entry => {
          if (!updatedIds.has(entry.id)) return entry;
          const patched: any = { ...entry, party_name: newName, party_id: partyId };
          if (updated.address !== undefined) patched.address = updated.address;
          if (updated.site    !== undefined) patched.site    = updated.site;
          return patched;
        })
      );
    }
  } catch (e) {
    console.error('[partySync] ledger_entries update failed:', e);
    TelemetryService.logError(uid, 'partySync', 'ledger_entries cascade failed', { error: String(e) }).catch(() => {});
  }

  // ── 2. transactions ──────────────────────────────────────────────────────
  try {
    const col = collection(db, `users/${uid}/transactions`);
    const [byNameSnap, byIdSnap] = await Promise.all([
      getDocs(query(col, where('party_name', '==', oldName))),
      getDocs(query(col, where('party_id', '==', partyId))),
    ]);
    const seen = new Set<string>();
    const allDocs = [...byNameSnap.docs, ...byIdSnap.docs].filter(d => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
    if (allDocs.length > 0) {
      const updatedIds = new Set(allDocs.map(d => d.id));
      const updates: Array<[any, Record<string, any>]> = allDocs.map(d => [
        fsDoc(db, `users/${uid}/transactions`, d.id),
        { party_name: newName, party_id: partyId },
      ]);
      await flushUpdates(updates);
      totalUpdated += updates.length;

      // Immediately patch the transactions cache.
      queryClient.setQueryData(['transactions', uid], (old: any[] = []) =>
        old.map(entry => {
          if (!updatedIds.has(entry.id)) return entry;
          return { ...entry, party_name: newName, party_id: partyId };
        })
      );
    }
  } catch (e) {
    console.error('[partySync] transactions update failed:', e);
    TelemetryService.logError(uid, 'partySync', 'transactions cascade failed', { error: String(e) }).catch(() => {});
  }

  // ── 3. misc_charges ──────────────────────────────────────────────────────
  // Misc charges are linked by party_id OR party_name — update both fields
  // so future lookups by either key still find the record.
  try {
    const col = collection(db, `users/${uid}/misc_charges`);
    // No composite index available → fetch all, filter in JS
    const snap = await getDocs(col);
    const toUpdate = snap.docs.filter(d => {
      const data = d.data() as any;
      return data.party_id === partyId || data.party_name === oldName;
    });
    if (toUpdate.length > 0) {
      const updates: Array<[any, Record<string, any>]> = toUpdate.map(d => [
        fsDoc(db, `users/${uid}/misc_charges`, d.id),
        { party_name: newName, party_id: partyId },
      ]);
      await flushUpdates(updates);
      totalUpdated += updates.length;
    }
  } catch (e) {
    console.error('[partySync] misc_charges update failed:', e);
    TelemetryService.logError(uid, 'partySync', 'misc_charges cascade failed', { error: String(e) }).catch(() => {});
  }

  // ── 4. recurring_templates ───────────────────────────────────────────────
  try {
    const col = collection(db, `users/${uid}/recurring_templates`);
    const [byNameSnap, byIdSnap] = await Promise.all([
      getDocs(query(col, where('party_name', '==', oldName))),
      getDocs(query(col, where('party_id', '==', partyId))),
    ]);
    const seen = new Set<string>();
    const allDocs = [...byNameSnap.docs, ...byIdSnap.docs].filter(d => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
    if (allDocs.length > 0) {
      const updates: Array<[any, Record<string, any>]> = allDocs.map(d => [
        fsDoc(db, `users/${uid}/recurring_templates`, d.id),
        { party_name: newName, party_id: partyId },
      ]);
      await flushUpdates(updates);
      totalUpdated += updates.length;
    }
  } catch (e) {
    console.error('[partySync] recurring_templates update failed:', e);
    TelemetryService.logError(uid, 'partySync', 'recurring_templates cascade failed', { error: String(e) }).catch(() => {});
  }

  // ── 5. Invalidate TanStack Query caches ──────────────────────────────────
  // The setQueryData calls above patch the in-memory cache immediately so the
  // UI is already consistent. invalidateQueries triggers background refetches
  // from Firestore local cache (IndexedDB) to confirm the writes landed and
  // reconcile any edge-cases (e.g. records the queries above missed).
  //
  // Also invalidate 'parties' so any aggregate computed from the parties list
  // (e.g. party_code or other derived fields) reflects the updated doc.
  try {
    queryClient.invalidateQueries({ queryKey: ['parties', uid], exact: true });
    queryClient.invalidateQueries({ queryKey: ['ledger', uid], exact: true });
    queryClient.invalidateQueries({ queryKey: ['transactions', uid], exact: true });
  } catch (_) {}

  return totalUpdated;
}
