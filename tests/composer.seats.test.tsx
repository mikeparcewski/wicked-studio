/**
 * studio#631: the Desk / session composer shows which seats a send uses and lets the operator drop
 * some — a `/workflow-<key>` launch sends only those in `clisJson`, and the choice persists per viewer.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry, RosterSeat, WorkflowDef } from '../src/api/types.js';
import { Composer, type ComposerSend } from '../src/components/session/Composer.js';
import { addAboutChip, useComposerChips } from '../src/store/composerChips.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { chosenSeats, resetComposerSeats, useComposerSeats } from '../src/store/composerSeats.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';

const seat = (key: string): RosterSeat =>
  ({ key, display_name: key, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true }) as RosterSeat;
const ROSTER = [seat('claude'), seat('codex'), seat('pi'), seat('copilot')];
const WF = [{ id: 'mcp-server', phases: [{ id: 'build', executes_code: true }] }] as unknown as WorkflowDef[];
const REPO = { id: 'repo-1', name: 'svc', root_path: '/srv/svc', default_branch: 'main', registered_at: 0 } as RepoEntry;

let posts: Array<{ path: string; body: Record<string, unknown> }> = [];
function stubWire(): void {
  posts = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown> });
      return Promise.resolve(new Response(JSON.stringify({ runId: 'r-new' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    const body = path === '/roster' ? { roster: ROSTER } : path === '/repos' ? { repos: [REPO] } : path === '/workflows' ? { workflows: WF } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

function Harness({ started = false, onSend }: { started?: boolean; onSend: (m: string, o: ComposerSend) => void }): React.ReactElement {
  const [text, setText] = useState('');
  return <Composer composerKey="desk" text={text} setText={setText} onSend={onSend} started={started} placeholder="p" ariaLabel="a" variant="desk" navigate={() => {}} />;
}
function type(text: string): void {
  const box = screen.getByTestId('desk-composer-input') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
  box.setSelectionRange(text.length, text.length);
  fireEvent.select(box);
}
const key = (k: string): void => { fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: k }); };
const seatButton = (k: string): HTMLElement => screen.getAllByTestId('composer-seat').find((b) => b.dataset.key === k)!;

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
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetComposerSeats(); });

describe('studio#631: the composer helpers row', () => {
  it('shows every seat this send would use, all on by default — once there is something to send', () => {
    render(<Harness onSend={() => {}} />);
    expect(screen.queryByTestId('composer-seats')).toBeNull(); // an idle composer keeps the Desk's fold
    type('what changed?');
    const row = screen.getByTestId('composer-seats');
    expect([...row.querySelectorAll('[data-testid="composer-seat"]')].map((b) => (b as HTMLElement).dataset.key)).toEqual(['claude', 'codex', 'pi', 'copilot']);
    expect(screen.getAllByTestId('composer-seat').every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true);
  });

  it('a /workflow launch sends only the seats left on', async () => {
    render(<Harness onSend={() => {}} />);
    type('x');
    fireEvent.click(seatButton('codex'));
    fireEvent.click(seatButton('copilot'));
    expect(seatButton('codex').getAttribute('aria-pressed')).toBe('false');
    type('/workflow-mcp-server');
    key('Enter'); // names the workflow (the menu row or the typed whole line)
    await waitFor(() => expect(screen.getByTestId('composer-launch-row')).toBeInTheDocument());
    type('build an MCP server for the ledger');
    await waitFor(() => expect((screen.getByTestId('launch-row-repo') as HTMLSelectElement).value).toBe('repo-1'));
    key('Enter');
    await waitFor(() => expect(posts.some((p) => p.path === '/runs')).toBe(true));
    const seats = (JSON.parse(String(posts.find((p) => p.path === '/runs')!.body.clisJson)) as Array<{ key: string }>).map((s) => s.key);
    expect(seats).toEqual(['claude', 'pi']);
  });

  it('dropping every seat refuses the send and says why — never a silent fall back to all', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    type('what changed in the ledger?');
    for (const k of ['claude', 'codex', 'pi', 'copilot']) fireEvent.click(seatButton(k));
    expect(screen.getByTestId('composer-seats-refused').textContent).toMatch(/No helper is picked/);
    key('Enter');
    expect(onSend).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it('the choice persists per viewer, and the Ask reads the same choice', () => {
    render(<Harness onSend={() => {}} />);
    type('x');
    fireEvent.click(seatButton('copilot'));
    expect(JSON.parse(localStorage.getItem('wicked_composer_dropped_seats') ?? '[]')).toEqual(['copilot']);
    expect(chosenSeats(['claude', 'codex', 'copilot'], useComposerSeats.getState().dropped)).toEqual(['claude', 'codex']);
  });

  it('a helper named to answer but turned off is refused by name, not silently dropped as primary', () => {
    useCapabilities.setState({ askPath: true });
    try {
      const onSend = vi.fn();
      addAboutChip('desk', { kind: 'about', key: 'h:codex', label: 'Codex' });
      render(<Harness onSend={onSend} />);
      type('what changed?');
      fireEvent.click(seatButton('codex'));
      expect(screen.getByTestId('composer-seats-refused').textContent).toMatch(/Codex is named to answer but is left out/);
      key('Enter');
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      useCapabilities.setState({ askPath: false });
    }
  });

  it('an @project chip in a started session opens a fresh chat — the row is offered for it', () => {
    render(<Harness started onSend={() => {}} />);
    addAboutChip('desk', { kind: 'project', key: 'p:kes', label: 'Kestrel', projectId: 'kes' } as never);
    type('a new question there');
    expect(screen.getByTestId('composer-seats')).toBeInTheDocument();
  });

  it('a toggle applies to the stored choice another tab made, and a storage event syncs this tab', () => {
    render(<Harness onSend={() => {}} />);
    type('x');
    localStorage.setItem('wicked_composer_dropped_seats', JSON.stringify(['pi']));
    fireEvent.click(seatButton('codex'));
    expect(JSON.parse(localStorage.getItem('wicked_composer_dropped_seats') ?? '[]')).toEqual(['pi', 'codex']);
    localStorage.setItem('wicked_composer_dropped_seats', JSON.stringify(['claude']));
    window.dispatchEvent(new StorageEvent('storage', { key: 'wicked_composer_dropped_seats' }));
    expect(useComposerSeats.getState().dropped).toEqual(['claude']);
  });

  it('an @helper chip picks who answers without rewriting the question (studio#631)', () => {
    useCapabilities.setState({ askPath: true });
    try {
      const onSend = vi.fn();
      addAboutChip('desk', { kind: 'about', key: 'h:claude', label: 'Claude Code' });
      render(<Harness onSend={onSend} />);
      type('why is the ledger slow?');
      key('Enter');
      expect(onSend).toHaveBeenCalledWith('why is the ledger slow?', expect.objectContaining({ primary: 'claude' }));
    } finally {
      useCapabilities.setState({ askPath: false });
    }
  });

  it('a reply into a started chat keeps that chat\'s seats — no row', () => {
    render(<Harness started onSend={() => {}} />);
    type('a follow-up');
    expect(screen.queryByTestId('composer-seats')).toBeNull();
  });
});
