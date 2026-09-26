import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { makeView } from './factories.js';
import { bandCountLine, bandExpandsByDefault } from '../src/board/bandExpansion.js';
import { runTargetHits } from '../src/palette/runTargets.js';
import { draftOutbound, outboundKindFor, STATUS_HEAD } from '../src/api/outbound.js';
import { OUTBOUND_ACTIONS } from '../src/hooks/useOutboundDraft.js';
import { useModeMemory } from '../src/hooks/useModeMemory.js';
import { announceNavigateAway, useHistoryScroll, useHistoryState } from '../src/hooks/useHistoryState.js';
import { runEventsPath, runFilesPath, useRoute } from '../src/hooks/useRoute.js';

/**
 * Studio wave 1 — the behaviour layer under the four journeys (e2e/wave1_*_test.py).
 * Each block pins the model a skin renders, never the rendering.
 */

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('dark when healthy — band expansion', () => {
  it('only the exception band opens by default', () => {
    expect(bandExpandsByDefault('needs-you')).toBe(true);
    expect(bandExpandsByDefault('working')).toBe(false);
    expect(bandExpandsByDefault('quiet')).toBe(false);
  });

  it('a collapsed band is one count line', () => {
    expect(bandCountLine('working', 3)).toBe('Working (3)');
    expect(bandCountLine('quiet', 20)).toBe('Quiet (20)');
  });
});

describe('raw in one step — run targets', () => {
  const runs = [
    makeView({ id: 'a1', problem: 'add request tracing', status: 'executing' }),
    makeView({ id: 'r1', problem: 'tighten upload limits', status: 'executing' }),
    makeView({ id: 'r10', problem: 'rotate keys', status: 'completed' }),
  ];

  it('>events r1 resolves the exact id first, as a route', () => {
    const hits = runTargetHits('events r1', runs);
    expect(hits[0]?.run.session.id).toBe('r1');
    expect(hits[0]?.href).toBe('/runs/r1/events');
    expect(hits.every((h) => h.target.key === 'events')).toBe(true);
    // r10 is an id-prefix match — listed, after the exact one; a1 is not named.
    expect(hits.map((h) => h.run.session.id)).toEqual(['r1', 'r10']);
  });

  it('names a run by words from its intent, and aliases pick the target', () => {
    expect(runTargetHits('files upload', runs).map((h) => [h.target.key, h.run.session.id]))
      .toEqual([['files', 'r1']]);
    expect(runTargetHits('worktree a1', runs)[0]?.href).toBe('/runs/a1/files');
    expect(runTargetHits('raw a1', runs)[0]?.href).toBe('/runs/a1/events');
  });

  it('a bare verb lists every run; a non-target word yields nothing', () => {
    expect(runTargetHits('events', runs)).toHaveLength(3);
    expect(runTargetHits('config', runs)).toEqual([]);
    expect(runTargetHits('e r1', runs)).toEqual([]);
  });

  it('the targets are routes the router parses (no run-selected machinery)', () => {
    expect(runEventsPath('r 1')).toBe('/runs/r%201/events');
    window.history.replaceState(null, '', runEventsPath('r1'));
    const ev = renderHook(() => useRoute()).result.current;
    expect([ev.panel, ev.artifactId, ev.runId]).toEqual(['run-events', 'r1', null]);
    window.history.replaceState(null, '', runFilesPath('r1'));
    const fi = renderHook(() => useRoute()).result.current;
    expect([fi.panel, fi.artifactId, fi.runId]).toEqual(['run-files', 'r1', null]);
  });
});

describe('Back restores where you were — history-entry state', () => {
  it('useHistoryState reads and writes the current entry', () => {
    window.history.replaceState({ 'k.open': true }, '', '/');
    const { result } = renderHook(() => useHistoryState('k.open', false));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect((window.history.state as Record<string, unknown>)['k.open']).toBe(false);
  });

  it('useHistoryScroll snapshots on navigate-away and restores once the content is tall enough', () => {
    const el = document.createElement('div');
    let scrollHeight = 100;
    Object.defineProperty(el, 'scrollHeight', { get: () => scrollHeight });
    Object.defineProperty(el, 'clientHeight', { get: () => 100 });
    el.scrollTop = 240;
    const ref = { current: el };
    const first = renderHook(() => useHistoryScroll(ref, 'k.scroll'));
    act(() => announceNavigateAway());
    expect((window.history.state as Record<string, unknown>)['k.scroll']).toBe(240);
    first.unmount();

    el.scrollTop = 0;
    const back = renderHook(() => useHistoryScroll(ref, 'k.scroll'));
    expect(el.scrollTop).toBe(0); // content still short — the offset waits
    scrollHeight = 600;
    back.rerender();
    expect(el.scrollTop).toBe(240);
  });

  it('a user scroll before the content is tall enough cancels the pending restore', () => {
    window.history.replaceState({ 'k.late': 240 }, '', '/');
    const el = document.createElement('div');
    let scrollHeight = 100;
    Object.defineProperty(el, 'scrollHeight', { get: () => scrollHeight });
    Object.defineProperty(el, 'clientHeight', { get: () => 100 });
    const ref = { current: el };
    const hook = renderHook(() => useHistoryScroll(ref, 'k.late'));
    el.scrollTop = 30;
    el.dispatchEvent(new Event('scroll')); // the operator moved first
    scrollHeight = 600;
    hook.rerender();
    expect(el.scrollTop).toBe(30); // no jump minutes later
  });
});

describe('outbound harness — the draft', () => {
  it('a completed run drafts a PR; anything else a status update', () => {
    expect(outboundKindFor('completed')).toBe('pr');
    expect(outboundKindFor('executing')).toBe('status');
    expect(outboundKindFor('failed')).toBe('status');
  });

  it('reads crew deliver-text verbatim for a PR, headed for a status', async () => {
    const text = 'docs: the title\n\n## Summary\n\nbody\n';
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(text, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const pr = await draftOutbound({ kind: 'pr', runId: 'c 1' });
    expect(pr.text).toBe(text);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/runs\/c%201\/deliver-text$/);
    const status = await draftOutbound({ kind: 'status', runId: 'c1' });
    expect(status.text).toBe(`${STATUS_HEAD}${text}`);
  });

  it('a daemon refusal surfaces its own sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Run not found' }), { status: 404 })));
    await expect(draftOutbound({ kind: 'pr', runId: 'nope' })).rejects.toThrow('Run not found');
  });

  it('offers exactly the actions that have a channel — Copy, today', () => {
    expect(OUTBOUND_ACTIONS).toEqual(['copy']);
  });
});

describe('project-scoped mode memory', () => {
  it('a mode never reopens the previous project artifact; each project keeps its own', () => {
    const { result, rerender } = renderHook(
      ({ pid, artifact }: { pid: string; artifact: string | null }) => useModeMemory(pid, 'build', artifact),
      { initialProps: { pid: 'alpha', artifact: 'a1' as string | null } },
    );
    expect(result.current('build')).toBe('a1');
    rerender({ pid: 'beta', artifact: null });
    expect(result.current('build')).toBeNull();
    rerender({ pid: 'alpha', artifact: null });
    expect(result.current('build')).toBe('a1');
  });
});
