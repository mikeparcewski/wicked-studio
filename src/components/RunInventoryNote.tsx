import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { InventoryClaim, RunInventoryResponse } from '../api/types.js';

/**
 * wicked-crew#721: a step that lists things a later step acts on (issues, PRs, files) ends its reply
 * with a `wicked-inventory` block, and crew serves whether each list is complete
 * (`GET /runs/:id/inventory`). crew#648 is why: two triage runs reported success, one inventory
 * was six items short, and nothing on the run said so. The run's record now does — one line per
 * claim that is not `full` ("partial: 6 of 10 PRs · unread: PRs: API 403"), and one for a finished
 * unit whose output could not be read (it may have held the partial claim). Nothing when every
 * claim is full, when no step claimed an inventory, or on a daemon without the route.
 */

/** The refetch key for a run view: how many units have finished, and the run's status. Pure. */
export function inventoryProgress(status: string, units: readonly { status: string }[]): string {
  const settled = units.filter((u) => u.status === 'done' || u.status === 'rejected' || u.status === 'failed').length;
  return `${status}:${settled}`;
}

export interface InventoryLine {
  key: string;
  ord: number | null;
  words: string;
}

/** "partial: 6 of 10 from gh issue list · unread: PRs: API 403". Pure. */
export function claimWords(c: InventoryClaim): string {
  const of = c.listed !== null && c.expected !== null
    ? `${c.listed} of ${c.expected}`
    : c.listed !== null ? `${c.listed} listed` : null;
  const parts = [c.answered === 'unknown' ? 'unreadable claim' : c.answered];
  if (of !== null) parts[0] += `: ${of}`;
  if (c.source !== null) parts.push(`from ${c.source}`);
  const head = parts.join(' ');
  return c.unread.length > 0 ? `${head} · unread: ${c.unread.join('; ')}` : head;
}

/** The lines the record shows: every claim that is not `full`, then each unreadable unit. Pure. */
export function inventoryLines(inv: RunInventoryResponse): InventoryLine[] {
  if (!inv.readable) return [];
  const out: InventoryLine[] = [];
  for (const u of inv.units) {
    u.claims.forEach((c, i) => {
      if (c.answered === 'full') return;
      out.push({ key: `${u.unitId}#${i}`, ord: u.ord, words: claimWords(c) });
    });
  }
  for (const id of inv.unreadUnits) {
    out.push({ key: `unread:${id}`, ord: null, words: `${id.split(':').pop() ?? id}: output could not be read, so its inventory is unknown` });
  }
  return out;
}

/**
 * `progress` is a key that changes whenever a unit finishes or the run's status moves (the caller
 * folds it from the run view), so a run opened while live re-reads its inventory as each step
 * settles and once more when it stops (codex r1). A response is shown only for the run it was
 * fetched for, so switching runs never shows the previous run's warnings.
 */
export function RunInventoryNote({ runId, progress }: { runId: string; progress: string }): React.ReactElement | null {
  const [inv, setInv] = useState<RunInventoryResponse | null>(null);
  useEffect(() => {
    let live = true;
    api.getRunInventory(runId).then((r) => { if (live) setInv(r); }, () => { if (live) setInv(null); });
    return () => { live = false; };
  }, [runId, progress]);
  if (inv === null || inv.runId !== runId) return null;
  const lines = inventoryLines(inv);
  if (lines.length === 0) return null;
  return (
    <div data-testid="run-inventory" className="wk-session-grey">
      {lines.map((l) => (
        <p key={l.key} data-testid="run-inventory-line" className="wk-run-pool-short">
          Inventory {l.words}
        </p>
      ))}
    </div>
  );
}
