import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * The universal command palette (DES-FEEDBACK-002 §1, slice G): prefix grammar
 * over an already-loaded corpus (zero store fetches on open — only the repo
 * list, once, cached for the session), grouped keyboard-navigable rows, the
 * §1.3 verb table, Escape/focus-restore behavior.
 */

const listRepos = vi.fn();
const confirmGate = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: new Proxy(
    {},
    {
      // EVERY api surface is a spy: the zero-fetch assertion below is "nothing
      // but listRepos was called", not a hand-picked subset.
      get: (_t, prop) => {
        const name = String(prop);
        if (name === 'listRepos') return listRepos;
        if (name === 'confirmGate') return confirmGate;
        return calls(name);
      },
    },
  ),
}));

const otherCalls = new Map<string, ReturnType<typeof vi.fn>>();
function calls(prop: string): ReturnType<typeof vi.fn> {
  let fn = otherCalls.get(prop);
  if (fn === undefined) {
    fn = vi.fn(() => Promise.resolve({}));
    otherCalls.set(prop, fn);
  }
  return fn;
}

const { CommandPalette, clearPaletteRepoCache } = await import('../src/components/CommandPalette.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useAppearanceStore } = await import('../src/theming/appearance.js');

function proj(id: string, name: string, updated_at: number): Project {
  return { id, name, description: null, status: 'active', scope: `project:${id}`, created_at: 1, updated_at };
}

const RUNS = [
  makeView({ id: 'r-gate', problem: 'migrate the auth tables', status: 'awaiting_human' }),
  makeView({ id: 'r-live', problem: 'add rate-limiting', status: 'executing' }),
  makeView({ id: 'r-done', problem: 'smoke the login flow', status: 'completed' }),
];

function renderPalette(over: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const navigate = vi.fn();
  const onKill = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <CommandPalette
      open
      onClose={onClose}
      runs={RUNS}
      navigate={navigate}
      runPath={(id) => `/runs/${id}`}
      projectId={null}
      selectedRun={null}
      onKill={onKill}
      {...over}
    />,
  );
  return { navigate, onKill, onClose, ...utils };
}

beforeEach(() => {
  clearPaletteRepoCache();
  listRepos.mockReset();
  confirmGate.mockReset();
  otherCalls.clear();
  listRepos.mockResolvedValue({
    repos: [{ id: 'studio-api', name: 'studio-api', root_path: '/x', default_branch: 'main', registered_at: 1 }],
  });
  useProjectsStore.setState({
    projects: [proj('default', 'Unfiled', 9), proj('q3-review-deck', 'q3-review-deck', 5), proj('api-migration', 'api-migration', 7)],
  });
  useGateStore.setState({ gates: {} });
});
afterEach(cleanup);

function rows(): HTMLElement[] {
  return screen.queryAllByTestId('palette-row');
}
function groupsOf(list: HTMLElement[]): string[] {
  return list.map((r) => r.dataset.group ?? '');
}

describe('corpus & prefixes (§1.3/§1.4)', () => {
  it('opens with mixed groups: gates first in runs, then projects (recency), repos, verbs — never Unfiled', async () => {
    renderPalette();
    await waitFor(() => expect(rows().some((r) => r.dataset.group === 'repos')).toBe(true));
    const gs = groupsOf(rows());
    // Grouped in §1.3 order, each group contiguous.
    expect([...new Set(gs)]).toEqual(['runs', 'projects', 'repos', 'verbs']);
    // Gates lead the runs group; terminal runs trail it.
    const runRows = rows().filter((r) => r.dataset.group === 'runs');
    expect(runRows[0]?.textContent).toContain('migrate the auth tables');
    expect(runRows[0]?.textContent).toContain('gate');
    expect(runRows[2]?.textContent).toContain('smoke the login flow');
    // Projects are recency-ordered and the synthesized default never renders (F5).
    const projRows = rows().filter((r) => r.dataset.group === 'projects');
    expect(projRows.map((r) => r.textContent?.includes('Unfiled'))).toEqual([false, false]);
    expect(projRows[0]?.textContent).toContain('api-migration');
  });

  it('the gated run row deep-links to #gate; a plain run links to its run path', () => {
    renderPalette();
    const runRows = rows().filter((r) => r.dataset.group === 'runs');
    expect(runRows[0]?.getAttribute('href')).toBe('/runs/r-gate#gate');
    expect(runRows[1]?.getAttribute('href')).toBe('/runs/r-live');
  });

  it('p: / run: / repo: / > scope to exactly one group', async () => {
    renderPalette();
    const input = screen.getByTestId('palette-input');
    fireEvent.change(input, { target: { value: 'p:' } });
    expect(new Set(groupsOf(rows()))).toEqual(new Set(['projects']));
    expect(rows()).toHaveLength(2);

    fireEvent.change(input, { target: { value: 'run:' } });
    expect(new Set(groupsOf(rows()))).toEqual(new Set(['runs']));
    expect(rows()).toHaveLength(3);

    fireEvent.change(input, { target: { value: 'repo:' } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(new Set(groupsOf(rows()))).toEqual(new Set(['repos']));

    fireEvent.change(input, { target: { value: '>' } });
    expect(new Set(groupsOf(rows()))).toEqual(new Set(['verbs']));
  });

  it('fuzzy-filters within a scope: "p: q3" keeps only q3-review-deck', () => {
    renderPalette();
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'p: q3' } });
    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0]?.textContent).toContain('q3-review-deck');
    expect(r[0]?.getAttribute('href')).toBe('/p/q3-review-deck');
  });
});

describe('zero fetching on open (§1.4)', () => {
  it('calls NOTHING but listRepos on first open — and not even that on reopen (session cache)', async () => {
    const first = renderPalette();
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(1));
    expect([...otherCalls.entries()].filter(([, fn]) => fn.mock.calls.length > 0)).toEqual([]);
    first.unmount();

    renderPalette();
    await waitFor(() => expect(rows().some((r) => r.dataset.group === 'repos')).toBe(true));
    expect(listRepos).toHaveBeenCalledTimes(1); // warm cache: nothing at all
    expect([...otherCalls.entries()].filter(([, fn]) => fn.mock.calls.length > 0)).toEqual([]);
  });
});

describe('keyboard navigation & activation (§1.7)', () => {
  it('ArrowDown/ArrowUp move data-selected; Enter navigates the selected row', () => {
    const { navigate } = renderPalette();
    const input = screen.getByTestId('palette-input');
    expect(rows()[0]?.dataset.selected).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(rows()[0]?.dataset.selected).toBe('false');
    expect(rows()[1]?.dataset.selected).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(rows()[0]?.dataset.selected).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/runs/r-gate#gate');
  });

  it('Escape closes and returns focus to the previously focused element', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    const { onClose } = renderPalette();
    expect(document.activeElement).toBe(screen.getByTestId('palette-input'));
    fireEvent.keyDown(screen.getByTestId('palette-input'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('the toggle chords close from inside the input (the §1.2 typing-context seam)', () => {
    const { onClose } = renderPalette();
    fireEvent.keyDown(screen.getByTestId('palette-input'), { key: 'k', ctrlKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the verb table (§1.3)', () => {
  it('"> " lists the always-verbs; Cancel run and gate verbs need an eligible selected run', () => {
    renderPalette();
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: '> ' } });
    const names = rows().map((r) => r.textContent ?? '');
    for (const v of ['New Build', 'New Chat', 'New Project', 'Toggle Theme', 'Open Terminal']) {
      expect(names.some((n) => n.includes(v))).toBe(true);
    }
    expect(names.some((n) => n.includes('Cancel run'))).toBe(false);
    expect(names.some((n) => n.includes('Approve gate'))).toBe(false);
  });

  it('Cancel run shows for a non-terminal selected run and dispatches onKill; terminal hides it', () => {
    const { onKill } = renderPalette({ selectedRun: RUNS[1] ?? null });
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: '> cancel' } });
    const row = rows().find((r) => r.textContent?.includes('Cancel run'));
    expect(row).toBeDefined();
    fireEvent.click(row!);
    expect(onKill).toHaveBeenCalledWith('r-live');

    cleanup();
    renderPalette({ selectedRun: RUNS[2] ?? null });
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: '> cancel' } });
    expect(rows().find((r) => r.textContent?.includes('Cancel run'))).toBeUndefined();
  });

  it('Approve/Reject gate show only for awaiting_human and fire the chip wire (POST gate)', () => {
    renderPalette({ selectedRun: RUNS[0] ?? null });
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: '> approve' } });
    const row = rows().find((r) => r.textContent?.includes('Approve gate'));
    expect(row).toBeDefined();
    fireEvent.click(row!);
    expect(confirmGate).toHaveBeenCalledWith('r-gate', { approve: true });
  });

  it('Toggle Theme flips the appearance store instance (the §2.14 mechanism)', () => {
    renderPalette();
    const before = useAppearanceStore.getState().appearance.theme;
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: '> toggle' } });
    const row = rows().find((r) => r.textContent?.includes('Toggle Theme'));
    fireEvent.click(row!);
    expect(useAppearanceStore.getState().appearance.theme).not.toBe(before);
  });

  it('New Build navigates to the flat launch route when unscoped, the pre-bound one inside a project', () => {
    const { navigate } = renderPalette();
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: '> new build' } });
    fireEvent.click(rows().find((r) => r.textContent?.includes('New Build'))!);
    expect(navigate).toHaveBeenCalledWith('/runs/new');

    cleanup();
    const scoped = renderPalette({ projectId: 'q3-review-deck' });
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: '> new build' } });
    fireEvent.click(rows().find((r) => r.textContent?.includes('New Build'))!);
    expect(scoped.navigate).toHaveBeenCalledWith('/p/q3-review-deck/build/new');
  });
});
