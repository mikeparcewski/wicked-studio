import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveCount, selfOpens, SELF_OPEN_MS, WatchPill, watchSentence } from '../src/components/desk/WatchPill.js';
import { ago, WatchtowerPage } from '../src/components/watch/WatchtowerPage.js';
import { foldFeed, EMPTY_WATCH, useWatchStore } from '../src/store/watch.js';
import { parseRoute } from '../src/hooks/useRoute.js';
import { makeView } from './factories.js';
import type { NeedRow } from '../src/board/needsYou.js';

/** S14 (DES-STUDIO-REBUILD-001 §11): the Watchtower placed — `/watch`, the pill, one count. */

const NOW = 1_800_000_000_000;
const finding = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  run_id: 'b1', ord: 0, attempt: 1, by: 'watch:x@1', at: NOW - 4 * 60_000, re: 'r', watch_id: id, entry_id: 'claim', entry_version: 1,
  check: 'deterministic:x', kind: 'finding', severity: 'medium', watch_kind: 'problem', attach: null, project_id: 'p',
  sentence: `sentence ${id}`, facts: {}, anchor: { run_id: 'b1', ord: 0, attempt: 1, at: NOW - 5 * 60_000 }, evidence: [], model: null, rolled_up: 0, ...over,
});

beforeEach(() => { useWatchStore.getState().reset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the route', () => {
  it('/watch is a real route', () => {
    expect(parseRoute('/watch').panel).toBe('watch');
  });
});

const need = (key: string, at: number | null): NeedRow => ({ key, at } as unknown as NeedRow);

describe('the pill opens itself only for something new that needs you', () => {
  it('a new row raised after the page opened opens it; a row that was already waiting does not', () => {
    expect(selfOpens(new Set(), [need('a', 100)], 50)).toBe(true);
    expect(selfOpens(new Set(), [need('a', 10)], 50)).toBe(false); // hydrated late, but old
    expect(selfOpens(new Set(['a']), [need('a', 100)], 50)).toBe(false);
    expect(selfOpens(new Set(), [need('a', null)], 50)).toBe(false); // no honest clock: not news
    expect(selfOpens(new Set(['g']), [{ ...need('g', 100), members: [need('m', 100)] } as NeedRow], 50)).toBe(true);
  });

  it('opens for SELF_OPEN_MS on a new need, and a watch finding alone never opens it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const runs = [makeView({ id: 'r1', status: 'executing' })];
    const { rerender } = render(<WatchPill needRows={[need('old', NOW - 60_000)]} runs={runs} navigate={() => {}} />);
    expect(screen.getByTestId('watch-pill-wrap').getAttribute('data-open')).toBe('false');
    act(() => useWatchStore.getState().hydrate({ findings: [finding('w1')] } as never));
    expect(screen.getByTestId('watch-pill-wrap').getAttribute('data-open')).toBe('false');
    rerender(<WatchPill needRows={[need('old', NOW - 60_000), need('new', NOW + 1000)]} runs={runs} navigate={() => {}} />);
    expect(screen.getByTestId('watch-pill-wrap').getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('watch-pill').getAttribute('data-count')).toBe('2');
    expect(screen.getByTestId('watch-pill-row').textContent).toBe('sentence w1');
    act(() => { vi.advanceTimersByTime(SELF_OPEN_MS + 1); });
    expect(screen.getByTestId('watch-pill-wrap').getAttribute('data-open')).toBe('false');
  });

  it('the pill and the page say the same count, from the needs-you fold', () => {
    const navigate = vi.fn();
    const runs = [makeView({ id: 'r1', status: 'executing' }), makeView({ id: 'r2', status: 'awaiting_human' })];
    render(<><WatchPill needRows={[need('a', 1), need('b', 2)]} runs={runs} navigate={navigate} /><WatchtowerPage count={2} runs={runs} navigate={navigate} now={NOW} /></>);
    expect(screen.getByTestId('watch-pill').getAttribute('data-count')).toBe('2');
    expect(screen.getByTestId('watchtower-sentence').textContent).toBe(watchSentence(2, liveCount(runs)));
    expect(watchSentence(2, 1)).toBe('2 things need you — 1 thing is running.');
    fireEvent.click(screen.getByTestId('watch-pill'));
    expect(navigate).toHaveBeenCalledWith('/watch');
  });
});

describe('the page', () => {
  it('lists the feed newest first, filters by kind, and jumps in at the moment', () => {
    const navigate = vi.fn();
    useWatchStore.setState({ fold: foldFeed(EMPTY_WATCH, { findings: [finding('w1'), finding('w2', { at: NOW - 60_000, watch_kind: 'decision', anchor: null }), finding('wg', { attach: 'gate' })] } as never), registry: 'present' });
    render(<WatchtowerPage count={0} runs={[]} navigate={navigate} now={NOW} />);
    const ids = screen.getAllByTestId('watchtower-row').map((r) => r.getAttribute('data-row-id'));
    expect(ids).toStrictEqual(['w2', 'w1']); // the gate-attached one is a line on its card, not a row
    fireEvent.click(screen.getAllByTestId('watchtower-kind').find((b) => b.getAttribute('data-kind') === 'problem')!);
    expect(screen.getAllByTestId('watchtower-row').map((r) => r.getAttribute('data-row-id'))).toStrictEqual(['w1']);
    fireEvent.click(screen.getByTestId('watchtower-jump'));
    // S16a-1c: Jump in lands on the run's session thread, the moment in the address.
    expect(navigate).toHaveBeenCalledWith(`/s/run%3Ab1?jump=0:1:${NOW - 5 * 60_000}`);
    expect(screen.queryByTestId('watchtower-no-registry')).toBeNull();
  });

  it('says when the daemon has no registry, and when the read failed (never an empty feed)', () => {
    useWatchStore.getState().failFeed(null);
    const { rerender } = render(<WatchtowerPage count={0} runs={[]} navigate={() => {}} now={NOW} />);
    expect(screen.getByTestId('watchtower-no-registry')).toBeTruthy();
    expect(screen.getByTestId('watchtower-empty').textContent).toMatch(/opens itself only for something that needs you/);
    act(() => useWatchStore.getState().failFeed('500 boom'));
    rerender(<WatchtowerPage count={0} runs={[]} navigate={() => {}} now={NOW} />);
    expect(screen.getByTestId('watchtower-error').textContent).toMatch('Could not read the Watchtower’s feed (500 boom)');
  });

  it('says time plainly', () => {
    expect(ago(NOW - 10_000, NOW)).toBe('just now');
    expect(ago(NOW - 4 * 60_000, NOW)).toBe('4 min ago');
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
  });
});

describe('codex on S14', () => {
  it('a failed read is never also "nothing to show"', () => {
    useWatchStore.getState().failFeed('500 boom');
    render(<WatchtowerPage count={0} runs={[]} navigate={() => {}} now={NOW} />);
    expect(screen.getByTestId('watchtower-error')).toBeTruthy();
    expect(screen.queryByTestId('watchtower-empty')).toBeNull();
  });

  it('rows present on the first render never open the card, whatever their clock says', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(<WatchPill needRows={[need('skewed', NOW + 5_000)]} runs={[]} navigate={() => {}} />);
    expect(screen.getByTestId('watch-pill-wrap').getAttribute('data-open')).toBe('false');
  });
});
