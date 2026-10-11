import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveCount, selfOpens, SELF_OPEN_MS, WatchPill, watchSentence } from '../src/components/desk/WatchPill.js';
import { ago, foldAlike, plainWatchLine, WatchtowerPage } from '../src/components/watch/WatchtowerPage.js';
import { absTime } from '../src/board/relTime.js';
import { foldFeed, EMPTY_WATCH, useWatchStore } from '../src/store/watch.js';
import { parseRoute } from '../src/hooks/useRoute.js';
import { makeView } from './factories.js';
import type { NeedRow } from '../src/board/needsYou.js';

/** S14 (DES-STUDIO-REBUILD-001 §11): the Watchtower placed — `/watch` and the pill. */

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

  it('the pill counts needs while the page counts open feed items', () => {
    const navigate = vi.fn();
    const runs = [makeView({ id: 'r1', status: 'executing' }), makeView({ id: 'r2', status: 'awaiting_human' })];
    render(<><WatchPill needRows={[need('a', 1), need('b', 2)]} runs={runs} navigate={navigate} /><WatchtowerPage count={2} runs={runs} navigate={navigate} now={NOW} /></>);
    expect(screen.getByTestId('watch-pill').getAttribute('data-count')).toBe('2');
    expect(screen.getByTestId('watchtower-sentence').getAttribute('data-count')).toBe('0');
    expect(screen.getByTestId('watchtower-sentence').textContent).toBe('Nothing open — 1 thing is running.');
    expect(watchSentence(2, liveCount(runs))).toBe('2 things need you — 1 thing is running.');
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
    expect(screen.getByTestId('watchtower-sentence').getAttribute('data-count')).toBe('2');
    expect(screen.getByTestId('watchtower-sentence').textContent).toBe('2 open items — nothing is running.');
    fireEvent.click(screen.getAllByTestId('watchtower-kind').find((b) => b.getAttribute('data-kind') === 'problem')!);
    expect(screen.getAllByTestId('watchtower-row').map((r) => r.getAttribute('data-row-id'))).toStrictEqual(['w1']);
    expect(screen.getByTestId('watchtower-sentence').getAttribute('data-count')).toBe('2');
    expect(screen.getByRole('button', { name: 'Problems' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Problems' }).classList.contains('wk-chip')).toBe(true);
    expect(screen.getByText('4 minutes ago').getAttribute('title')).toBe(absTime(NOW - 4 * 60_000));
    expect(screen.getByTestId('watchtower-jump').className).toBe('wk-btn wk-btn--secondary wk-btn--sm');
    fireEvent.click(screen.getByTestId('watchtower-jump'));
    // S16a-1c: Jump in lands on the run's session thread, the moment in the address.
    expect(navigate).toHaveBeenCalledWith(`/s/run%3Ab1?jump=0:1:${NOW - 5 * 60_000}`);
    expect(screen.queryByTestId('watchtower-no-registry')).toBeNull();
  });

  it('says when the service has no watch list, and keeps read errors in technical details', () => {
    useWatchStore.getState().failFeed(null);
    const { rerender } = render(<WatchtowerPage count={0} runs={[]} navigate={() => {}} now={NOW} />);
    expect(screen.getByTestId('watchtower-no-registry').textContent).toBe("Studio's service doesn't keep a watch list yet, so this shows what studio sees itself: sessions gone quiet, team findings, finished and delivered work.");
    expect(screen.getByTestId('watchtower-empty').textContent).toBe('Nothing to show yet. Anything that needs you appears here.');
    act(() => useWatchStore.getState().failFeed('500 boom'));
    rerender(<WatchtowerPage count={0} runs={[]} navigate={() => {}} now={NOW} />);
    expect(screen.getByText('Couldn’t load the Watchtower feed.')).toBeTruthy();
    expect(screen.getByTestId('watchtower-error').getAttribute('data-kind')).toBe('error');
    const detail = screen.getByTestId('watchtower-error-detail');
    expect(detail.hasAttribute('open')).toBe(false);
    expect(detail.querySelector('pre')?.textContent).toBe('500 boom');
    expect(screen.getByTestId('watchtower-error-retry').textContent).toBe('Retry');
  });

  it('counts only open items even when the Desk has many needs', () => {
    const fold = foldFeed(EMPTY_WATCH, { findings: [finding('w1'), finding('w2')] } as never);
    fold.rows['w2'] = { ...fold.rows['w2']!, state: 'fixed', stateLine: 'Fixed' };
    useWatchStore.setState({ fold, registry: 'present' });
    render(<WatchtowerPage count={77} runs={[]} navigate={() => {}} now={NOW} />);
    expect(screen.getByTestId('watchtower-sentence').textContent).toBe('1 open item — nothing is running.');
    expect(screen.getByTestId('watchtower-sentence').getAttribute('data-count')).toBe('1');
  });

  it('shows a plain lead and keeps a long explanation behind technical details', () => {
    const sentence = 'The session went quiet.: No new events have arrived from the worker in several minutes: check its connection.';
    useWatchStore.getState().hydrate({ findings: [finding('w1', { sentence })] } as never);
    render(<WatchtowerPage count={0} runs={[]} navigate={() => {}} now={NOW} />);
    const row = screen.getByTestId('watchtower-row');
    expect(row.querySelector('.wk-watchtower-sentence')?.textContent).toBe('The session went quiet');
    const detail = within(row).getByTestId('watchtower-row-detail');
    expect(detail.hasAttribute('open')).toBe(false);
    expect(detail.querySelector('pre')?.textContent).toBe(sentence);
  });

  it('keeps short sentences and long sentences without a colon intact', () => {
    const short = 'A question: please answer it.';
    expect(plainWatchLine(short)).toEqual({ line: short, detail: null });
    const boundary = `Question: ${'x'.repeat(50)}`;
    expect(boundary).toHaveLength(60);
    expect(plainWatchLine(boundary)).toEqual({ line: boundary, detail: null });
    expect(plainWatchLine(`${boundary}x`)).toEqual({ line: 'Question', detail: `${boundary}x` });
    const long = 'x'.repeat(61);
    expect(plainWatchLine(long)).toEqual({ line: long, detail: null });
    // A short line whose tail is internal tokens still keeps them behind the disclosure.
    const tokens = 'The reviewer could not join on claude: team plan monitors=1.';
    expect(plainWatchLine(tokens)).toEqual({ line: 'The reviewer could not join on claude', detail: tokens });
    const paren = 'claude takes over — copilot stopped answering (quota_exhausted).';
    expect(plainWatchLine(paren)).toEqual({ line: 'claude takes over — copilot stopped answering.', detail: paren });
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

describe('foldAlike (UX gate S1)', () => {
  const base = { source: 'watch', kind: 'problem', projectId: null, at: 1, state: 'open', stateLine: null, severity: null, attach: null, anchor: null, rolledUp: 0, corroboratedBy: [], foldedInto: null, place: null, ord: null } as const;
  it('folds adjacent same-work same-line rows into the newest, counting the rest', () => {
    const rows = [
      { ...base, id: 'a', runId: 'r1', sentence: 'Nothing checked this step: no deterministic floor: no pinned validator' },
      { ...base, id: 'b', runId: 'r1', sentence: 'Nothing checked this step: no judge configured for this phase at all' },
      { ...base, id: 'c', runId: 'r2', sentence: 'Nothing checked this step: no deterministic floor: no pinned validator' },
    ] as unknown as Parameters<typeof foldAlike>[0];
    const out = foldAlike(rows);
    expect(out.map((x) => [x.row.id, x.alike])).toEqual([['a', 1], ['c', 0]]);
  });
});
