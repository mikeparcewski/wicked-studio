import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';
import type { AuditEntry } from '../src/api/types.js';
import { cancelStoryOf, deriveProvenance, ENGINE_TIMEOUT_AUDIT, rejectNoteOf, sendBackNoteOf, useProvenanceStore } from '../src/store/provenance.js';

/**
 * DES-UX-001 §3 — provenance derivation over the REAL audit wire shape
 * (`AuditEntry {ts, action, actor{id,kind,trust}, runId, detail}`), and the
 * store's one-fetch-per-run-id contract (§3.3's sanctioned exception).
 */

function launched(runId: string, over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: 1_700_000_000_000,
    action: 'run.launched',
    actor: { id: 'mika', kind: 'human', trust: 'operator' },
    runId,
    detail: { workflow: 'feature' },
    ...over,
  };
}

describe('deriveProvenance (§3.3)', () => {
  it('derives actor + kind from the newest run.launched entry', () => {
    const p = deriveProvenance([launched('r-1')], 'r-1', false);
    expect(p).toEqual({ state: 'known', actorId: 'mika', actorKind: 'human', channel: 'unrecorded' });
  });

  it('a launch this studio session witnessed derives channel "studio"', () => {
    const p = deriveProvenance([launched('r-1')], 'r-1', true);
    expect(p.state === 'known' && p.channel).toBe('studio');
  });

  it('detail.channel === "studio" yields studio regardless of launchedHere (forward-compat daemon field)', () => {
    const p = deriveProvenance([launched('r-1', { detail: { channel: 'studio' } })], 'r-1', false);
    expect(p.state === 'known' && p.channel).toBe('studio');
  });

  it('detail.channel === "API" overrides launchedHere (daemon wins)', () => {
    const p = deriveProvenance([launched('r-1', { detail: { channel: 'API' } })], 'r-1', true);
    expect(p.state === 'known' && p.channel).toBe('API');
  });

  it('carries retryOf from the audit detail (CREW-UX-3)', () => {
    const p = deriveProvenance(
      [launched('r-2', { detail: { retryOf: 'r-1' } })], 'r-2', false);
    expect(p.state === 'known' && p.retryOf).toBe('r-1');
  });

  it('no matching entry degrades to unknown — never a fabricated actor', () => {
    expect(deriveProvenance([], 'r-1', false)).toEqual({ state: 'unknown' });
    // Other actions and other runs never match.
    expect(deriveProvenance(
      [launched('r-1', { action: 'gate.decided' }), launched('r-other')],
      'r-1', false)).toEqual({ state: 'unknown' });
  });

  it('a malformed actor degrades rather than half-rendering', () => {
    const bad = launched('r-1');
    (bad as Record<string, unknown>)['actor'] = { id: 42 };
    expect(deriveProvenance([bad], 'r-1', false)).toEqual({ state: 'unknown' });
  });

  // R6: no channel + no witness → 'unrecorded'; no channel + witness → 'studio';
  // detail.channel: 'API' + witness → 'API' (daemon wins over witness)
  it('R6a: no detail.channel + no witness → channel is unrecorded, never API', () => {
    const p = deriveProvenance([launched('r-1')], 'r-1', false);
    expect(p.state === 'known' && p.channel).toBe('unrecorded');
  });

  it('R6b: no detail.channel + witness → channel is studio', () => {
    const p = deriveProvenance([launched('r-1')], 'r-1', true);
    expect(p.state === 'known' && p.channel).toBe('studio');
  });

  it('R6c: detail.channel "API" + witness → channel is API (daemon wins)', () => {
    const p = deriveProvenance([launched('r-1', { detail: { channel: 'API' } })], 'r-1', true);
    expect(p.state === 'known' && p.channel).toBe('API');
  });

  // crew#632 — the daemon emits lower-case channel tokens; case-insensitive compare (AC4 follow-through)
  it('AC4: lower-case "studio" from daemon → channel is studio', () => {
    const p = deriveProvenance([launched('r-1', { detail: { channel: 'studio' } })], 'r-1', false);
    expect(p.state === 'known' && p.channel).toBe('studio');
  });

  it('AC4: lower-case "api" from daemon → channel is API (label keeps upper-case)', () => {
    const p = deriveProvenance([launched('r-1', { detail: { channel: 'api' } })], 'r-1', false);
    expect(p.state === 'known' && p.channel).toBe('API');
  });

  it('AC4: "cli" from daemon → channel is CLI (rendered "via CLI")', () => {
    const p = deriveProvenance([launched('r-1', { detail: { channel: 'cli' } })], 'r-1', false);
    expect(p.state === 'known' && p.channel).toBe('CLI');
  });

  it('AC4: upper-case "CLI" from daemon → channel is CLI (case-insensitive)', () => {
    const p = deriveProvenance([launched('r-1', { detail: { channel: 'CLI' } })], 'r-1', false);
    expect(p.state === 'known' && p.channel).toBe('CLI');
  });

  it('AC4: unknown channel token → falls through to launchedHere / unrecorded', () => {
    const p = deriveProvenance([launched('r-1', { detail: { channel: 'unknown' } })], 'r-1', false);
    expect(p.state === 'known' && p.channel).toBe('unrecorded');
  });
});

describe('useProvenanceStore.load (§3.5: one fetch per run id, cached)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useProvenanceStore.setState({ byRun: {}, launchedHere: {} });
    sessionStorage.clear();
  });

  it('fetches once, caches, and never re-fires on revisit', async () => {
    const spy = vi.spyOn(client.api, 'getAudit')
      .mockResolvedValue({ entries: [launched('r-1')] });
    useProvenanceStore.getState().load('r-1');
    useProvenanceStore.getState().load('r-1'); // in-flight dedup
    await waitFor(() =>
      expect(useProvenanceStore.getState().byRun['r-1']?.state).toBe('known'));
    useProvenanceStore.getState().load('r-1'); // cached revisit
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('an unreachable audit trail caches the degraded answer', async () => {
    const spy = vi.spyOn(client.api, 'getAudit').mockRejectedValue(new Error('API 500: down'));
    useProvenanceStore.getState().load('r-1');
    await waitFor(() =>
      expect(useProvenanceStore.getState().byRun['r-1']).toEqual({ state: 'unknown' }));
    useProvenanceStore.getState().load('r-1');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('markLaunchedHere before the load yields the studio channel', async () => {
    vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [launched('r-9')] });
    useProvenanceStore.getState().markLaunchedHere('r-9');
    useProvenanceStore.getState().load('r-9');
    await waitFor(() => {
      const p = useProvenanceStore.getState().byRun['r-9'];
      expect(p?.state === 'known' && p.channel).toBe('studio');
    });
  });

  it('studio channel survives page reload — sessionStorage witness persists across Zustand resets', async () => {
    // Simulate: run was launched in a prior page load (sessionStorage persists; Zustand does not)
    vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [launched('r-reload')] });
    useProvenanceStore.getState().markLaunchedHere('r-reload');
    // Simulate reload: reset Zustand (no markLaunchedHere call in the new session)
    useProvenanceStore.setState({ byRun: {}, launchedHere: {} });
    // sessionStorage still holds the witness from the prior session
    useProvenanceStore.getState().load('r-reload');
    await waitFor(() => {
      const p = useProvenanceStore.getState().byRun['r-reload'];
      expect(p?.state === 'known' && p.channel).toBe('studio');
    });
  });
});

/** studio#478: the reject note the operator typed, off crew's `gate.decided` audit (`detail.amend`). */
describe('rejectNoteOf', () => {
  const decided = (runId: string, detail: Record<string, unknown>, ts = 1_700_000_001_000): AuditEntry => ({
    ts, action: 'gate.decided', actor: { id: 'mika', kind: 'human', trust: 'operator' }, runId, detail,
  });
  it('the newest rejection with a note for this run (the page is newest-first)', () => {
    const entries = [
      decided('r-1', { approve: false, amend: 'the venue is booked; plan around the hall' }, 3),
      decided('r-1', { approve: false, amend: 'older note' }, 2),
      launched('r-1'),
    ];
    expect(rejectNoteOf(entries, 'r-1')).toBe('the venue is booked; plan around the hall');
  });
  it('null for an approval, a rejection without a note, another run, or no decision', () => {
    expect(rejectNoteOf([decided('r-1', { approve: true, amend: 'steer' })], 'r-1')).toBeNull();
    expect(rejectNoteOf([decided('r-1', { approve: false })], 'r-1')).toBeNull();
    expect(rejectNoteOf([decided('r-1', { approve: false, amend: '  ' })], 'r-1')).toBeNull();
    expect(rejectNoteOf([decided('r-2', { approve: false, amend: 'x' })], 'r-1')).toBeNull();
    expect(rejectNoteOf([launched('r-1')], 'r-1')).toBeNull();
  });
  // studio#537: the operator's last gate answer was "Send back to the creator" (`approve:false,
  // action:'request_changes', amend`); 2 h 45 m later the engine timed the creator out and cancelled.
  // That send-back is NOT a rejection — the run page must never caption the cancel "You rejected it".
  it('a send-back (approve:false + action:request_changes) is NOT a rejection; the reject arm is', () => {
    const sendBack = decided('r-1', { approve: false, action: 'request_changes', amend: 'Fix the reviewer\'s failing items' }, 3);
    expect(rejectNoteOf([sendBack, launched('r-1')], 'r-1')).toBeNull();
    expect(sendBackNoteOf([sendBack, launched('r-1')], 'r-1')).toBe('Fix the reviewer\'s failing items');
    // The explicit reject arm and the legacy two-arm wire both ARE rejections.
    expect(rejectNoteOf([decided('r-1', { approve: false, action: 'reject', amend: 'no' })], 'r-1')).toBe('no');
    expect(rejectNoteOf([decided('r-1', { approve: false, amend: 'no' })], 'r-1')).toBe('no');
    // A send-back newer than a real rejection does not shadow it, and an approve never reads as a send-back.
    expect(rejectNoteOf([sendBack, decided('r-1', { approve: false, amend: 'older real reject' }, 2)], 'r-1')).toBe('older real reject');
    expect(sendBackNoteOf([decided('r-1', { approve: true, action: 'approve', amend: 'steer' })], 'r-1')).toBeNull();
  });

  it('cancelStoryOf: send-back then an engine timeout ⇒ no reject note, the send-back kept as such, engineTimedOut', () => {
    const timedOut: AuditEntry = {
      ts: 4, action: ENGINE_TIMEOUT_AUDIT, actor: { id: 'crew.daemon', kind: 'system', trust: 'admin' }, runId: 'r-1', detail: { ord: 6 },
    };
    const entries = [timedOut, decided('r-1', { approve: false, action: 'request_changes', amend: 'Fix the reviewer\'s failing items' }, 3), launched('r-1')];
    expect(cancelStoryOf(entries, 'r-1')).toEqual({ rejectNote: null, sendBackNote: 'Fix the reviewer\'s failing items', engineTimedOut: true });
    // Another run's timeout is not this run's; a plain rejection reads as one.
    expect(cancelStoryOf([{ ...timedOut, runId: 'r-2' }], 'r-1')).toEqual({ rejectNote: null, sendBackNote: null, engineTimedOut: false });
    expect(cancelStoryOf([decided('r-1', { approve: false, amend: 'not this week' })], 'r-1')).toEqual({ rejectNote: 'not this week', sendBackNote: null, engineTimedOut: false });
  });

  it('the store keeps the cancel story beside the reject note, from the same one fetch', async () => {
    const spy = vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [
      { ts: 5, action: ENGINE_TIMEOUT_AUDIT, actor: { id: 'crew.daemon', kind: 'system', trust: 'admin' }, runId: 'r-537', detail: { ord: 6 } },
      decided('r-537', { approve: false, action: 'request_changes', amend: 'step 4 is the whole of e2e/' }),
      launched('r-537'),
    ] });
    useProvenanceStore.getState().load('r-537');
    await waitFor(() => expect(useProvenanceStore.getState().cancelStories['r-537']).toEqual({ rejectNote: null, sendBackNote: 'step 4 is the whole of e2e/', engineTimedOut: true }));
    expect(useProvenanceStore.getState().rejectNotes['r-537']).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('the store keeps it beside the provenance, from the same one fetch', async () => {
    const spy = vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [decided('r-478', { approve: false, amend: 'not this week' }), launched('r-478')] });
    useProvenanceStore.getState().load('r-478');
    await waitFor(() => expect(useProvenanceStore.getState().rejectNotes['r-478']).toBe('not this week'));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
