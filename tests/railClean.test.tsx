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
// The badge's settle timing is useSettledNeeds' own suite; here it has settled on the rows given.
let settledPhase: 'complete' | 'partial' = 'complete';
vi.mock('../src/hooks/useNeedsRows.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/hooks/useNeedsRows.js')>()),
  useSettledNeeds: (rows: readonly unknown[]) => ({ phase: settledPhase, count: rows.length, missing: [] }),
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
const { useSearchModal } = await import('../src/store/searchModal.js');
const { useAskDock } = await import('../src/store/askDock.js');
const { resetLaunchWizard, useLaunchWizard } = await import('../src/store/launchWizard.js');
const { useProjectsStore } = await import('../src/store/projects.js');

beforeEach(() => { window.localStorage.clear(); settledPhase = 'complete'; });
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

describe('the top of the rail (operator IA 2026-10-13)', () => {
  it('the wordmark is the one link to the Desk; its name carries the needs-you badge', () => {
    rail();
    const home = screen.getByTestId('desk-rail-home');
    expect(home.tagName).toBe('A');
    expect(home).toHaveAttribute('href', '/');
    expect(home).toHaveAccessibleName('wicked studio — Desk, 1 needs you');
    expect(within(home).getByTestId('desk-rail-badge')).toHaveTextContent('1');
    expect(within(home).getByTestId('desk-rail-brand')).toHaveTextContent('wicked studio');
    // No separate "Desk" item.
    expect(screen.getByTestId('session-rail').querySelectorAll('a[href="/"]')).toHaveLength(1);
  });

  it('a partial count says so: "Desk, 2+ need you"', () => {
    settledPhase = 'partial';
    render(<SessionRail runs={RUNS} needRows={[...NEED, { ...NEED[0]!, key: 'fail:u1' }] as never} navigate={() => {}} pathname="/" />);
    expect(screen.getByTestId('desk-rail-home')).toHaveAccessibleName('wicked studio — Desk, 2+ need you');
  });

  it('with nothing waiting the link is just "Desk" and carries no badge', () => {
    render(<SessionRail runs={RUNS} needRows={[]} navigate={() => {}} pathname="/" />);
    expect(screen.getByTestId('desk-rail-home')).toHaveAccessibleName('wicked studio — Desk');
    expect(screen.queryByTestId('desk-rail-badge')).toBeNull();
  });

  it('the action row sits where the Desk item was: four equal icons, New project · New job · Chat · Search — each named (DES-SYSTEM-CHAT §1)', () => {
    rail();
    const row = screen.getByTestId('desk-rail-actions');
    expect(row.previousElementSibling).toBe(screen.getByTestId('desk-rail-home'));
    const buttons = [...row.querySelectorAll('button')];
    expect(buttons.map((b) => b.dataset.testid)).toEqual(['desk-rail-new-project', 'desk-rail-new-job', 'desk-rail-chat', 'desk-rail-search']);
    // Icons only: no visible words, every one the same class (equal width), each with a tooltip.
    expect(buttons.every((b) => b.className === 'wk-rail-action' && (b.textContent ?? '').trim() === '' && b.title !== '')).toBe(true);
    expect(screen.getByTestId('desk-rail-new-job')).toHaveAccessibleName('New job');
    expect(screen.getByTestId('desk-rail-search')).toHaveAccessibleName('Search');
    expect(screen.getByTestId('desk-rail-search').title).toMatch(/K\)$/);
    expect(screen.getByTestId('desk-rail-chat')).toHaveAccessibleName('New chat');
    const btn = screen.getByTestId('desk-rail-new-project');
    expect(btn).toHaveAccessibleName('New project');
    fireEvent.click(btn);
    const modal = screen.getByTestId('new-project-modal');
    expect(screen.getByTestId('session-rail').contains(modal)).toBe(false);
    fireEvent.click(screen.getByTestId('new-project-close'));
    expect(screen.queryByTestId('new-project-modal')).toBeNull();
  });
});

describe('the action row works from any page, in the project on screen', () => {
  it('Search opens the one search modal; New job and Chat start in the project on screen and say so', () => {
    useProjectsStore.setState({ projects: [{ id: 'p-up', name: 'upload-endpoint', description: null, status: 'active', scope: 'project:p-up', created_at: 1, updated_at: 1 }] });
    resetLaunchWizard();
    render(<SessionRail runs={RUNS} needRows={NEED as never} navigate={() => {}} pathname="/projects/p-up" ambientProject="p-up" />);
    const before = useSearchModal.getState().request?.nonce ?? 0;
    fireEvent.click(screen.getByTestId('desk-rail-search'));
    expect(useSearchModal.getState().request).toEqual({ nonce: before + 1, seed: '' });
    expect(screen.getByTestId('desk-rail-new-job')).toHaveAccessibleName('New job in upload-endpoint');
    fireEvent.click(screen.getByTestId('desk-rail-new-job'));
    expect(useLaunchWizard.getState()).toMatchObject({ open: true, draft: { projectId: 'p-up', composerKey: 'desk' } });
    expect(screen.getByTestId('desk-rail-chat')).toHaveAccessibleName('New chat in upload-endpoint');
    fireEvent.click(screen.getByTestId('desk-rail-chat'));
    expect(useAskDock.getState().request).toMatchObject({ projectId: 'p-up', fresh: true });
  });

  it('Chat restores a minimized chat and leaves an open one as it is; only a closed chat starts a new one', async () => {
    const { useChatWindow, resetChatWindow } = await import('../src/store/chatWindow.js');
    resetChatWindow();
    render(<SessionRail runs={RUNS} needRows={NEED as never} navigate={() => {}} pathname="/" />);
    const before = useAskDock.getState().request?.nonce ?? 0;
    act(() => { useChatWindow.setState({ mode: 'minimized', restoreTo: 'full' }); });
    expect(screen.getByTestId('desk-rail-chat')).toHaveAccessibleName('Show the chat');
    fireEvent.click(screen.getByTestId('desk-rail-chat'));
    expect(useChatWindow.getState().mode).toBe('full');
    expect(screen.getByTestId('desk-rail-chat')).toHaveAccessibleName('Chat');
    fireEvent.click(screen.getByTestId('desk-rail-chat'));
    expect(useChatWindow.getState().mode).toBe('full');
    expect(useAskDock.getState().request?.nonce ?? 0).toBe(before);
    act(() => { useChatWindow.getState().close(); });
    fireEvent.click(screen.getByTestId('desk-rail-chat'));
    expect(useAskDock.getState().request).toMatchObject({ nonce: before + 1, fresh: true });
    resetChatWindow();
  });

  it('the Unfiled bucket is not a project to start in', () => {
    resetLaunchWizard();
    render(<SessionRail runs={RUNS} needRows={NEED as never} navigate={() => {}} pathname="/projects/default" ambientProject="default" />);
    expect(screen.getByTestId('desk-rail-new-job')).toHaveAccessibleName('New job');
    fireEvent.click(screen.getByTestId('desk-rail-new-job'));
    expect(useLaunchWizard.getState()).toMatchObject({ open: true, draft: { projectId: null } });
  });
});
