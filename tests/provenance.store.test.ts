import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';
import type { AuditEntry } from '../src/api/types.js';
import { deriveProvenance, useProvenanceStore } from '../src/store/provenance.js';

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
