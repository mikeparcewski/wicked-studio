/**
 * UX section S3 (studio#686, UX audit rows 12, 23, 32, 71, 72): the composer names each helper once
 * (`seatLabel`), offers only addressable helpers (no judge seat, no non-CLI entry) in BOTH the `@`
 * menu and the helpers row, groups the `@` menu under one header per kind, and says a project pick
 * once (the chip), with a placeholder that names the next thing to type after a workflow pick.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, RepoEntry, RosterSeat, SessionView, WorkflowDef } from '../src/api/types.js';
import { Composer, shortPlaceholder } from '../src/components/session/Composer.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { useProjectsStore } from '../src/store/projects.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';

const seat = (key: string, display_name: string, extra: Partial<RosterSeat> = {}): RosterSeat =>
  ({ key, display_name, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true, ...extra }) as RosterSeat;
const ROSTER = [
  seat('claude', 'Claude Code'),
  seat('codex', 'Codex'),
  seat('pi', 'Pi CLI'),
  seat('claude-judge', 'Claude Code (judge)', { category: 'judge' }),
  seat('wicked-estate', 'wicked-estate', { binary: '' }),
];
const WF = [{ id: 'feature', phases: [{ id: 'build', executes_code: true }] }] as unknown as WorkflowDef[];
const REPOS = [
  { id: 'repo-a', name: 'alpha', root_path: '/srv/a', default_branch: 'main', registered_at: 0 },
  { id: 'repo-b', name: 'beta', root_path: '/srv/b', default_branch: 'main', registered_at: 0 },
] as RepoEntry[];
const RUN = { session: { id: 'r-1', status: 'completed', problem: 'p', repo_ref: 'repo-b' }, units: [] } as unknown as SessionView;
const PROJECT = { id: 'proj_1', name: 'Recipes', description: 'The recipe cards app', status: 'active', scope: 'project:proj_1', created_at: 0, updated_at: 0 } as unknown as Project;

function stubWire(): void {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST' && path === '/runs') {
      return Promise.resolve(new Response(JSON.stringify({ error: "Repo checkout /root/src/beta is not a git repository" }), { status: 400, headers: { 'content-type': 'application/json' } }));
    }
    const body = path === '/roster' ? { roster: ROSTER } : path === '/workflows' ? { workflows: WF } : path === '/repos' ? { repos: REPOS } : path === '/projects' ? { projects: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

function Harness({ runs }: { runs?: SessionView[] }): React.ReactElement {
  const [text, setText] = useState('');
  return <Composer composerKey="desk" text={text} setText={setText} onSend={() => {}} placeholder="Ask anything" ariaLabel="a" variant="desk" navigate={() => {}} {...(runs !== undefined ? { runs, started: true } : {})} />;
}
function type(text: string): void {
  const box = screen.getByTestId('desk-composer-input') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
  box.setSelectionRange(text.length, text.length);
  fireEvent.select(box);
}

beforeEach(() => {
  stubWire();
  clearCachedRoster();
  setCachedRoster(ROSTER);
  resetComposerSeats();
  resetPlanCatalog();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  clearRepoCache();
  useComposerChips.setState({ byComposer: {} });
  useProjectsStore.setState({ projects: [PROJECT] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetComposerSeats(); });

describe('S3: one name per helper, the same list in @ and the helpers row', () => {
  it('the helpers row names each helper by its display name and drops the judge and non-CLI entries', () => {
    render(<Harness />);
    type('what changed?');
    const chips = screen.getAllByTestId('composer-seat');
    expect(chips.map((b) => b.dataset.key)).toEqual(['claude', 'codex', 'pi']);
    expect(chips.map((b) => b.textContent)).toEqual(['Claude Code', 'Codex', 'Pi CLI']);
    expect(screen.getByTestId('composer-seats').textContent).toContain('Helpers');
  });

  it('the @ menu offers the same helpers under the same names, grouped under one header per kind', () => {
    render(<Harness />);
    type('@');
    const items = screen.getAllByTestId('composer-menu-item');
    const helpers = items.filter((b) => b.dataset.kind === 'helper');
    expect(helpers.map((b) => b.dataset.id)).toEqual(['claude', 'codex', 'pi']);
    expect(helpers.map((b) => b.querySelector('b')?.textContent)).toEqual(['Claude Code', 'Codex', 'Pi CLI']);
    expect(screen.getByTestId('composer-menu').textContent).not.toMatch(/judge/i);
    const groups = screen.getAllByTestId('composer-menu-group').map((g) => g.dataset.group);
    expect(groups).toEqual(['project', 'helper']);
    // No boilerplate line repeated on every row: a project shows its own description, a helper none.
    expect(items.find((b) => b.dataset.kind === 'project')?.textContent).toContain('The recipe cards app');
    expect(helpers.every((b) => b.querySelector('small') === null)).toBe(true);
  });

  it('a project pick is said once — by its chip — before the first send', () => {
    render(<Harness />);
    type('@Rec');
    fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: 'Enter' });
    expect(screen.getAllByTestId('composer-chip').map((c) => c.textContent)).toEqual(['in: Recipes×']);
    expect(screen.queryByTestId('composer-note')).toBeNull();
  });

  it('after a workflow pick the placeholder names what to type next', () => {
    render(<Harness />);
    const box = screen.getByTestId('desk-composer-input');
    expect(box.getAttribute('placeholder')).toBe('Ask anything');
    type('/workflow-feature');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.getAttribute('placeholder')).toBe('Describe the work to launch');
  });

  it('row 24: a workflow launched in a session defaults to the repository its work already names', async () => {
    render(<Harness runs={[RUN]} />);
    type('/workflow-feature');
    fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: 'Enter' });
    await waitFor(() => expect((screen.getByTestId('launch-row-repo') as HTMLSelectElement).value).toBe('repo-b'));
  });

  it('row 24: on the Desk (no session repo) and several repositories, nothing is guessed', async () => {
    render(<Harness />);
    type('/workflow-feature');
    fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('launch-row-repo').querySelectorAll('option').length).toBe(3));
    expect((screen.getByTestId('launch-row-repo') as HTMLSelectElement).value).toBe('');
  });

  it('row 24 (codex r1): clearing the repository is the user speaking — the session default is not re-applied', async () => {
    render(<Harness runs={[RUN]} />);
    type('/workflow-feature');
    fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: 'Enter' });
    const select = screen.getByTestId('launch-row-repo') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('repo-b'));
    fireEvent.change(select, { target: { value: '' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(select.value).toBe('');
  });

  it('a refused launch says so plainly; the daemon text sits in Technical details, home path as ~', async () => {
    render(<Harness runs={[RUN]} />);
    type('/workflow-feature');
    fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: 'Enter' });
    await waitFor(() => expect((screen.getByTestId('launch-row-repo') as HTMLSelectElement).value).toBe('repo-b'));
    type('add a dark mode');
    fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: 'Enter' });
    const err = await screen.findByTestId('composer-launch-error');
    expect(err.textContent).toMatch(/^Couldn’t launch this\./);
    const detail = screen.getByTestId('composer-launch-error-detail');
    expect(detail.tagName).toBe('DETAILS');
    expect(detail.textContent).toContain('~/src/beta');
    expect(err.textContent).not.toContain('/root/');
  });

  it('the 390 px placeholder is the first clause with an ellipsis, never a cut sentence', () => {
    expect(shortPlaceholder('Ask anything across your projects, or tell one what to do')).toBe('Ask anything…');
    expect(shortPlaceholder('Ask about this, or tell studio what to do next — / adds a step')).toBe('Ask about this…');
    expect(shortPlaceholder('Describe the work')).toBe('Describe the work');
  });

  it('while the @ menu is open the helpers row steps aside (one list on screen)', () => {
    render(<Harness />);
    type('hello @');
    expect(screen.getByTestId('composer-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-seats')).toBeNull();
    type('hello');
    expect(screen.getByTestId('composer-seats')).toBeInTheDocument();
  });

  it('an @ menu whose lists are still being read says so, not "Nothing matches."', () => {
    clearCachedRoster();
    useProjectsStore.setState({ projects: [] });
    render(<Harness />);
    type('@');
    expect(screen.getByTestId('composer-menu-empty').textContent).toBe('Reading your helpers and projects…');
  });

  it('codex r2: an open @ menu never lets a send past the seat refusals', () => {
    render(<Harness />);
    type('hi');
    for (const b of screen.getAllByTestId('composer-seat')) fireEvent.click(b);
    type('hi @zzz');
    expect(screen.queryByTestId('composer-seats')).toBeNull();
    expect((screen.getByTestId('desk-composer-send') as HTMLButtonElement).disabled).toBe(true);
  });
});
