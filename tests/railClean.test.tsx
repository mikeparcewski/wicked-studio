import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';

/**
 * The calm rail (studio-rail-clean): one-line titles with the full words in the hover title, a fold
 * per group that this viewer's browser remembers (and that survives storage failing), the folded
 * group's needs-you count, and "Show N more" for the rest of a group.
 */

const RUNS: SessionView[] = Array.from({ length: 8 }, (_, i) => ({
  session: { id: `u${i}`, status: i === 0 ? 'failed' : 'completed', title: i < 2 ? 'Twin job' : `Job ${i}`, problem: `Job ${i} and all the long words after it`, created_at: 1_789_000_000 - i * 86_400, unit_ix: 0 },
  units: [],
} as unknown as SessionView));

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: RUNS, loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { RAIL_COLLAPSED_KEY, readRailCollapsed } = await import('../src/hooks/useRailCollapsed.js');

const NEED = [{ key: 'fail:u0', kind: 'failed-run', severity: 100, stakes: 1, subject: 'x', text: 'Run failed', tone: 'fail', at: 1, subjectPath: '/', action: { kind: 'open', path: '/', label: 'Open' } }];

function rail(): ReturnType<typeof render> {
  return render(<SessionRail runs={RUNS} needRows={NEED as never} navigate={() => {}} pathname="/" />);
}
const group = (): HTMLElement => screen.getByTestId('rail-group');

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('rows', () => {
  it('show the short title on one line, the full words in the hover title, and a tag on twins', () => {
    rail();
    const rows = within(group()).getAllByTestId('rail-session');
    const first = rows.find((r) => r.dataset.runId === 'u0')!;
    expect(first.querySelector('.wk-rail-session-title')).toHaveTextContent(/^Twin job$/);
    expect(first.getAttribute('title')).toContain('Job 0 and all the long words after it');
    expect(first.getAttribute('aria-label')).toMatch(/Failed · .*1 thing needs you/);
    expect(first.dataset.status).toBe('Failed');
    expect(within(first).getByTestId('rail-session-dot').dataset.tone).toBe('fail');
    const tags = rows.filter((r) => r.querySelector('.wk-rail-session-title')!.textContent === 'Twin job')
      .map((r) => within(r).getByTestId('rail-session-tag').textContent);
    expect(new Set(tags).size).toBe(2);
    expect(rows.filter((r) => r.querySelector('[data-testid="rail-session-tag"]') === null)).toHaveLength(rows.length - 2);
  });
});

describe('Show N more', () => {
  it('shows the first five, then all, then the first five again', () => {
    rail();
    expect(within(group()).getAllByTestId('rail-session')).toHaveLength(5);
    const more = screen.getByTestId('rail-group-more');
    expect(more).toHaveTextContent('Show 3 more');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(within(group()).getAllByTestId('rail-session')).toHaveLength(8);
    expect(more).toHaveTextContent('Show fewer');
    fireEvent.click(more);
    expect(within(group()).getAllByTestId('rail-session')).toHaveLength(5);
  });
});

describe('folding a group', () => {
  it('hides its rows, keeps its needs-you count on the header, and is remembered for this viewer', () => {
    const { unmount } = rail();
    const toggle = screen.getByTestId('rail-group-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', expect.stringMatching(/^rail-group-list-/));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(group()).queryAllByTestId('rail-session')).toHaveLength(0);
    expect(within(toggle).getByTestId('rail-group-needs')).toHaveTextContent('1');
    expect(within(toggle).getByTestId('rail-group-needs')).toHaveAttribute('aria-label', '1 thing needs you');
    expect(JSON.parse(window.localStorage.getItem(RAIL_COLLAPSED_KEY)!)).toEqual(['']);
    unmount();
    rail();
    expect(screen.getByTestId('rail-group-toggle')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByTestId('rail-group-toggle'));
    expect(within(group()).getAllByTestId('rail-session')).toHaveLength(5);
    expect(JSON.parse(window.localStorage.getItem(RAIL_COLLAPSED_KEY)!)).toEqual([]);
  });

  it('storage that throws or holds junk means nothing folded, and folding still works for the page', () => {
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, '{not json');
    expect(readRailCollapsed().size).toBe(0);
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, JSON.stringify(['a', 3, null]));
    expect([...readRailCollapsed()]).toEqual(['a']);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    rail();
    const toggle = screen.getByTestId('rail-group-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    act(() => { fireEvent.click(toggle); });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
