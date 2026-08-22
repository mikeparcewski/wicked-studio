import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { composeLede, ledeCounts, NarrativeBand, type LedeCounts } from '../src/components/NarrativeBand.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import type { Project } from '../src/api/types.js';
import { useDocThreadStore } from '../src/store/docThread.js';
import { useGateStore } from '../src/store/gates.js';
import { useRuntimeStore, type LoggedEvent } from '../src/store/runtime.js';
import { makeView } from './factories.js';

/**
 * The narrative band's lede (DES-FEEDBACK-003 §7.3, slice Q / EC29): one
 * sentence COMPOSED from store data — every number derives, every zero-count
 * segment drops out, the quiet phrase renders on quiet systems, and every
 * number is a real link.
 */

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const text = (c: Partial<LedeCounts>): string =>
  composeLede({ finished: 0, passed: 0, failed: 0, gates: 0, live: 0, projects: 5, ...c })
    .segments.map((s) => s.text).join('');

describe('composeLede — §7.3 grammar, every drop-out case', () => {
  it('the full sentence: finished with both outcomes, and gates', () => {
    expect(text({ finished: 4, passed: 3, failed: 1, gates: 2 })).toBe(
      'While you were away: 4 runs finished — 3 passed, 1 failed — and 2 gates are waiting on you.',
    );
  });

  it('zero failed drops the failed half', () => {
    expect(text({ finished: 4, passed: 4, gates: 2 })).toBe(
      'While you were away: 4 runs finished — 4 passed — and 2 gates are waiting on you.',
    );
  });

  it('zero passed drops the passed half', () => {
    expect(text({ finished: 2, failed: 2, gates: 1 })).toBe(
      'While you were away: 2 runs finished — 2 failed — and 1 gate is waiting on you.',
    );
  });

  it('zero gates drops the whole gates clause', () => {
    expect(text({ finished: 4, passed: 3, failed: 1 })).toBe(
      'While you were away: 4 runs finished — 3 passed, 1 failed.',
    );
  });

  it('zero finished keeps the gates clause, un-conjoined', () => {
    expect(text({ gates: 2, live: 1 })).toBe(
      'While you were away: 2 gates are waiting on you.',
    );
  });

  it('nothing finished, nothing waiting, something moving — the number still derives', () => {
    expect(text({ live: 3 })).toBe(
      'While you were away: nothing finished — 3 runs still moving.',
    );
  });

  it('singular grammar throughout', () => {
    expect(text({ finished: 1, passed: 1, gates: 1 })).toBe(
      'While you were away: 1 run finished — 1 passed — and 1 gate is waiting on you.',
    );
    expect(text({ live: 1 })).toBe('While you were away: nothing finished — 1 run still moving.');
  });

  it('the all-quiet system reads the quiet phrase — no zero-count segment renders', () => {
    const quiet = composeLede({ finished: 0, passed: 0, failed: 0, gates: 0, live: 0, projects: 28 });
    expect(quiet.quiet).toBe(true);
    expect(quiet.segments.map((s) => s.text).join('')).toBe(
      'All quiet. 28 projects, nothing running, nothing waiting.',
    );
    expect(text({})).not.toContain('0 ');
  });

  it('each numeric segment names a real destination (§7.3 links)', () => {
    const full = composeLede({ finished: 4, passed: 3, failed: 1, gates: 2, live: 0, projects: 5 });
    const hrefs = full.segments.filter((s) => s.href !== null).map((s) => s.href);
    expect(hrefs).toEqual(['/runs', '#needs-you']);
  });
});

describe('ledeCounts — honest clocks only (EC29: no invented clock)', () => {
  const log = (ts: number, type = 'cliUsage'): LoggedEvent => ({ seq: 1, type, ts, detail: type });

  it('counts a run finished only when its LAST observed clock is in-window', () => {
    const runs = [
      makeView({ id: 'r-in', status: 'completed' }),
      makeView({ id: 'r-out', status: 'failed' }),      // clock 30h ago — out
      makeView({ id: 'r-clockless', status: 'completed' }), // no clock — never counted
      makeView({ id: 'r-gate', status: 'awaiting_human' }),
      makeView({ id: 'r-live', status: 'executing' }),
      makeView({ id: 'r-archived', status: 'completed', archived_at: 1 }),
    ];
    const c = ledeCounts(
      runs,
      { 'r-in': NOW - 5 * HOUR, 'r-out': NOW - 30 * HOUR, 'r-archived': NOW - HOUR },
      {}, {}, 7, NOW,
    );
    expect(c).toEqual({ finished: 1, passed: 1, failed: 0, gates: 1, live: 1, projects: 7 });
  });

  it('the failure tail and arrival-stamped frames extend a run into the window', () => {
    const runs = [makeView({ id: 'r-f', status: 'failed' }), makeView({ id: 'r-d', status: 'completed' })];
    const c = ledeCounts(
      runs,
      { 'r-f': NOW - 30 * HOUR, 'r-d': NOW - 30 * HOUR },
      { 'r-d': [log(NOW - 2 * HOUR)] },
      { 'r-f': NOW - 3 * HOUR },
      2, NOW,
    );
    expect(c.finished).toBe(2);
    expect(c.failed).toBe(1);
    expect(c.passed).toBe(1);
  });
});

describe('<NarrativeBand> — composition on screen', () => {
  beforeEach(() => {
    useGateStore.setState({ gates: {} });
    useRuntimeStore.setState({ logs: {} });
    useDocThreadStore.setState({ landings: [] });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function project(id: string): Project {
    return { id, name: id, description: null, status: 'active', scope: `project:${id}`, created_at: 1, updated_at: 1 };
  }
  function item(id: string, runs: ReturnType<typeof makeView>[], attachedAt: Record<string, number>): BoardProject {
    return { project: project(id), repo: null, runs, docs: [], attachedAt, attention: 'quiet', score: 0, band: 'quiet', signal: null };
  }

  it('renders the lede with its EC19 question, links as <a>, and the margin notes', () => {
    const runs = [
      makeView({ id: 'r-done', status: 'completed' }),
      makeView({ id: 'r-gate', status: 'awaiting_human' }),
    ];
    const attached = { 'r-done': NOW - 2 * HOUR, 'r-gate': NOW - HOUR };
    render(
      <NarrativeBand
        items={[item('p', runs, attached)]}
        runs={runs} attachedAt={attached} failedAt={{}} navigate={() => {}} now={NOW}
      />,
    );
    const lede = screen.getByTestId('landing-lede');
    expect(lede.getAttribute('data-question')).toBe('What happened and what needs me?');
    expect(lede.textContent).toBe(
      'While you were away: 1 run finished — 1 passed — and 1 gate is waiting on you.',
    );
    const links = [...lede.querySelectorAll('a[data-testid="lede-segment"]')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/runs', '#needs-you']);
    // §8.5: the two surviving slice-E tiles live on as margin notes.
    const margin = screen.getByTestId('river-margin');
    expect(margin.querySelector('[data-testid="run-outcome-bar"]')).not.toBeNull();
    expect(margin.querySelector('[data-testid="token-burn-sparkline"]')).not.toBeNull();
    // No spend observed → the spend note drops out rather than inventing $0.00.
    expect(screen.queryByTestId('lede-spend')).toBeNull();
  });

  it('shows observed spend as a /make link only when a real costUsd was observed', () => {
    useRuntimeStore.setState({
      logs: { 'r-x': [
        { seq: 1, type: 'cliUsage', ts: NOW - HOUR, costUsd: 0.3, detail: 'usage' },
        { seq: 2, type: 'cliUsage', ts: NOW - HOUR / 2, costUsd: 0.12, detail: 'usage' },
      ] },
    });
    render(
      <NarrativeBand items={[]} runs={[]} attachedAt={{}} failedAt={{}} navigate={() => {}} now={NOW} />,
    );
    const spend = screen.getByTestId('lede-spend');
    expect(spend.textContent).toBe('$0.42 observed');
    expect(spend.getAttribute('href')).toBe('/make');
  });

  it('the gates link lands on the needs-you band anchor', () => {
    const runs = [makeView({ id: 'r-gate', status: 'awaiting_human' })];
    const attached = { 'r-gate': NOW - HOUR };
    const target = document.createElement('section');
    target.setAttribute('data-testid', 'band-needs-you');
    const scrolled = vi.fn();
    target.scrollIntoView = scrolled;
    document.body.appendChild(target);
    const navigate = vi.fn();
    render(
      <NarrativeBand items={[item('p', runs, attached)]} runs={runs} attachedAt={attached}
                     failedAt={{}} navigate={navigate} now={NOW} />,
    );
    screen.getByText('1 gate is waiting on you').click();
    expect(scrolled).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled(); // an anchor scroll, not a route change
    target.remove();
  });

  it('renders the quiet phrase on an all-quiet system', () => {
    render(
      <NarrativeBand
        items={[item('p-1', [], {}), item('p-2', [], {})]}
        runs={[]} attachedAt={{}} failedAt={{}} navigate={() => {}} now={NOW}
      />,
    );
    expect(screen.getByTestId('landing-lede').textContent).toBe(
      'All quiet. 2 projects, nothing running, nothing waiting.',
    );
  });
});
