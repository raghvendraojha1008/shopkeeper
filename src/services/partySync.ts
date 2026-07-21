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
 * Write-quota protection (three layers):
 *   L1 — ManualEntryModal only calls this when ≥1 field actually changed.
 *   L2 — Individual docs are skipped if their stored values already match (alreadyCurrent).
 *   L3 — If the total pending write count exceeds MAX_SYNC_WRITES (300), the
 *         function throws SyncBudgetExceededError instead of flushing, so the
 *         caller can display a warning. The reads still happen (to count docs),
 *         but zero writes occur for that party save.
 *
 * Firestore batches cap at 500 ops; we chunk writes in groups of 400.
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

/** Maximum number of Firestore writes one party-sync is allowed to perform. */
const MAX_SYNC_WRITES = 300;
const BATCH_CHUNK = 400;

export interface UpdatedPartyFields {
  name: string;
  address?: string;
  site?: string;
  gstin?: string;
  contact?: string;
  state?: string;
}

/** Thrown when a party rename would exceed MAX_SYNC_WRITES. */
export class SyncBudgetExceededError extends Error {
  constructor(public readonly pendingWrites: number) {
    super(
      `Party sync aborted: ${pendingWrites} documents would be rewritten, ` +
      `which exceeds the safe daily write budget (${MAX_SYNC_WRITES}). ` +
      `The party itself was saved; sub-records still reference the old name.`
    );
    this.name = 'SyncBudgetExceededError';
  }
}

/** Commit an array of [docRef, partialUpdate] in chunked batches. */
async function flushUpdates(updates: Array<[any, Record<string, any>]>): Promise<void> {
  for (let i = 0; i < updates.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    updates.slice(i, i + BATCH_CHUNK).forEach(([ref, data]) => batch.update(ref, data));
    await batch.commit();
  }
}

/** True if every key in `fields` already matches the stored doc data. */
function alreadyCurrent(docData: Record<string, any>, fields: Record<string, any>): boolean {
  return Object.entries(fields).every(([k, v]) => docData[k] === v);
}

/** De-duplicate docs by ID across two query snapshots. */
function mergeDocs(a: any[], b: any[]): any[] {
  const seen = new Set<string>();
  return [...a, ...b].filter(d => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

interface PendingCollection {
  col: string;
  updates: Array<[any, Record<string, any>]>;
  updatedIds: Set<string>;
  cacheKey?: string;
  cacheUpdater?: (old: any[]) => any[];
}

/**
 * Cascade a party edit to all denormalized copies in related collections.
 *
 * @param uid          Firebase user UID (= dataUid for multi-firm support)
 * @param partyId      Firestore document ID of the party
 * @param oldFields    The party fields BEFORE the edit
 * @param updated      The new field values from the edited party form
 * @returns            Total number of sub-documents updated
 * @throws SyncBudgetExceededError if pending writes > MAX_SYNC_WRITES
 */
export async function syncPartyToRecords(
  uid: string,
  partyId: string,
  oldFields: string | UpdatedPartyFields,
  updated: UpdatedPartyFields,
): Promise<number> {
  // Back-compat shim: old callers passed a plain string oldName.
  const oldName    = typeof oldFields === 'string' ? oldFields : oldFields.name;
  const oldAddress = typeof oldFields === 'object' ? oldFields.address : undefined;
  const oldSite    = typeof oldFields === 'object' ? oldFields.site    : undefined;

  const newName        = updated.name;
  const nameChanged    = newName            !== oldName;
  const addressChanged = updated.address !== undefined && updated.address !== oldAddress;
  const siteChanged    = updated.site    !== undefined && updated.site    !== oldSite;

  // ── Gather phase: collect all pending updates across all collections ──────
  // (reads still happen, but NO writes until we confirm we're under budget)
  const pending: PendingCollection[] = [];

  // 1. ledger_entries — always run to stamp party_id on legacy records,
  //    plus update any denormalized fields that changed.
  try {
    const col = collection(db, `users/${uid}/ledger_entries`);
    const allDocs = mergeDocs(
      (await getDocs(query(col, where('party_name', '==', oldName)))).docs,
      (await getDocs(query(col, where('party_id',   '==', partyId)))).docs,
    );
    if (allDocs.length > 0) {
      // Always stamp party_id; conditionally update name/address/site if changed.
      const newFields: Record<string, any> = { party_id: partyId };
      if (nameChanged)    newFields.party_name = newName;
      if (addressChanged && updated.address !== undefined) newFields.address = updated.address;
      if (siteChanged    && updated.site    !== undefined) newFields.site    = updated.site;

      const updatedIds = new Set<string>();
      const updates: Array<[any, Record<string, any>]> = allDocs
        .filter(d => !alreadyCurrent(d.data() as Record<string, any>, newFields))
        .map(d => { updatedIds.add(d.id); return [fsDoc(db, `users/${uid}/ledger_entries`, d.id), newFields]; });

      if (updates.length > 0) {
        pending.push({
          col: 'ledger_entries', updates, updatedIds,
          cacheKey: 'ledger',
          cacheUpdater: (old) => old.map(entry => {
            if (!updatedIds.has(entry.id)) return entry;
            const patched: any = { ...entry, party_id: partyId };
            if (nameChanged)    patched.party_name = newName;
            if (addressChanged && updated.address !== undefined) patched.address = updated.address;
            if (siteChanged    && updated.site    !== undefined) patched.site    = updated.site;
            return patched;
          }),
        });
      }
    }
  } catch (e) {
    console.error('[partySync] ledger_entries gather failed:', e);
    TelemetryService.logError(uid, 'partySync', 'ledger_entries gather failed', { error: String(e) }).catch(() => {});
  }

  // 2. transactions — always run to stamp party_id on legacy records,
  //    plus update party_name if it changed.
  try {
    const col = collection(db, `users/${uid}/transactions`);
    const allDocs = mergeDocs(
      (await getDocs(query(col, where('party_name', '==', oldName)))).docs,
      (await getDocs(query(col, where('party_id',   '==', partyId)))).docs,
    );
    if (allDocs.length > 0) {
      // Always stamp party_id; conditionally update party_name if changed.
      const newFields: Record<string, any> = { party_id: partyId };
      if (nameChanged) newFields.party_name = newName;

      const updatedIds = new Set<string>();
      const updates: Array<[any, Record<string, any>]> = allDocs
        .filter(d => !alreadyCurrent(d.data() as Record<string, any>, newFields))
        .map(d => { updatedIds.add(d.id); return [fsDoc(db, `users/${uid}/transactions`, d.id), newFields]; });

      if (updates.length > 0) {
        pending.push({
          col: 'transactions', updates, updatedIds,
          cacheKey: 'transactions',
          cacheUpdater: (old) => old.map(entry => {
            if (!updatedIds.has(entry.id)) return entry;
            const patched: any = { ...entry, party_id: partyId };
            if (nameChanged) patched.party_name = newName;
            return patched;
          }),
        });
      }
    }
  } catch (e) {
    console.error('[partySync] transactions gather failed:', e);
    TelemetryService.logError(uid, 'partySync', 'transactions gather failed', { error: String(e) }).catch(() => {});
  }

  // 3. misc_charges
  if (nameChanged) {
    try {
      const col = collection(db, `users/${uid}/misc_charges`);
      const allDocs = mergeDocs(
        (await getDocs(query(col, where('party_id',   '==', partyId)))).docs,
        (await getDocs(query(col, where('party_name', '==', oldName)))).docs,
      );
      if (allDocs.length > 0) {
        const newFields = { party_name: newName, party_id: partyId };
        const updatedIds = new Set<string>();
        const updates: Array<[any, Record<string, any>]> = allDocs
          .filter(d => !alreadyCurrent(d.data() as Record<string, any>, newFields))
          .map(d => { updatedIds.add(d.id); return [fsDoc(db, `users/${uid}/misc_charges`, d.id), newFields]; });

        if (updates.length > 0) {
          pending.push({ col: 'misc_charges', updates, updatedIds });
        }
      }
    } catch (e) {
      console.error('[partySync] misc_charges gather failed:', e);
      TelemetryService.logError(uid, 'partySync', 'misc_charges gather failed', { error: String(e) }).catch(() => {});
    }
  }

  // 4. recurring_templates
  if (nameChanged) {
    try {
      const col = collection(db, `users/${uid}/recurring_templates`);
      const allDocs = mergeDocs(
        (await getDocs(query(col, where('party_name', '==', oldName)))).docs,
        (await getDocs(query(col, where('party_id',   '==', partyId)))).docs,
      );
      if (allDocs.length > 0) {
        const newFields = { party_name: newName, party_id: partyId };
        const updatedIds = new Set<string>();
        const updates: Array<[any, Record<string, any>]> = allDocs
          .filter(d => !alreadyCurrent(d.data() as Record<string, any>, newFields))
          .map(d => { updatedIds.add(d.id); return [fsDoc(db, `users/${uid}/recurring_templates`, d.id), newFields]; });

        if (updates.length > 0) {
          pending.push({ col: 'recurring_templates', updates, updatedIds });
        }
      }
    } catch (e) {
      console.error('[partySync] recurring_templates gather failed:', e);
      TelemetryService.logError(uid, 'partySync', 'recurring_templates gather failed', { error: String(e) }).catch(() => {});
    }
  }

  // ── Budget check ─────────────────────────────────────────────────────────
  const totalPending = pending.reduce((n, p) => n + p.updates.length, 0);
  if (totalPending > MAX_SYNC_WRITES) {
    console.warn(
      `[partySync] Budget exceeded: ${totalPending} writes needed for party "${newName}". ` +
      `Aborting cascade (limit=${MAX_SYNC_WRITES}). Party doc was saved successfully.`
    );
    TelemetryService.logError(uid, 'partySync', 'budget exceeded — cascade skipped', {
      pendingWrites: totalPending, partyId, oldName, newName,
    }).catch(() => {});
    throw new SyncBudgetExceededError(totalPending);
  }

  // ── Flush phase: commit all writes ────────────────────────────────────────
  let totalUpdated = 0;
  for (const p of pending) {
    try {
      await flushUpdates(p.updates);
      totalUpdated += p.updates.length;

      // Patch TanStack Query cache immediately for zero-flash UI update.
      if (p.cacheKey && p.cacheUpdater) {
        queryClient.setQueryData([p.cacheKey, uid], (old: any[] = []) => p.cacheUpdater!(old));
      }
    } catch (e) {
      console.error(`[partySync] ${p.col} flush failed:`, e);
      TelemetryService.logError(uid, 'partySync', `${p.col} flush failed`, { error: String(e) }).catch(() => {});
    }
  }

  // ── Invalidate TanStack Query caches ──────────────────────────────────────
  try {
    queryClient.invalidateQueries({ queryKey: ['parties',      uid], exact: true });
    queryClient.invalidateQueries({ queryKey: ['ledger',       uid], exact: true });
    queryClient.invalidateQueries({ queryKey: ['transactions', uid], exact: true });
  } catch (_) {}

  return totalUpdated;
}
