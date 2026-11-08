/**
 * SLICE B — cross-model review fixes on the integrated branch (fr/fold-fb).
 *  1. a failed chat OPEN keeps its reason (sanitized) under the drawer disclosure (AskDock).
 *  2. the phone FAB rule is scoped to the Understand CHAT pane only (desk.css).
 *  3. a FAILED estate index / annotate step reads as failed, not as success (RunConversation).
 *  4. per-helper reasons that reach the DOM are sanitized (home paths) — AskDock + Composer builders.
 *  5. a seat that is signed IN but failed a live check, or whose auth is 'unknown', is not "signed out".
 *  6. the helper-free exception covers only a plain reply — a new conversation keeps its helper checks.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliOption } from '../src/board/chatCli.js';
import type { RepoEntry, RosterSeat, SessionView } from '../src/api/types.js';
import { noHelperNotice, startFailureReasons } from '../src/components/AskDock.js';
import { estateStepSummary } from '../src/components/session/RunConversation.js';
import { composerSendRefusal, NO_HELPER_AVAILABLE, NO_HELPER_SIGNED_IN } from '../src/board/launchModel.js';
import { Composer, type ComposerSend } from '../src/components/session/Composer.js';
import { addAboutChip, useComposerChips } from '../src/store/composerChips.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { resetComposerSeats } from '../src/store/composerSeats.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearRepoCache } from '../src/store/repoCache.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';

afterEach(cleanup);

// A home path, built so no literal home-path string appears in this file (worker rule).
const HOME = ['', 'Users', 'alice', '.config', 'secret'].join('/'); // /Users/alice/.config/secret
// A JSON-escaped Windows path (doubled backslashes), also built.
const WIN_ESCAPED = 'C:' + '\\\\' + 'Users' + '\\\\' + 'alice' + '\\\\' + 'x';

describe('B-1: a failed chat open keeps its reason (sanitized) for the disclosure', () => {
  it('startFailureReasons preserves each refused seat’s reason with the home path masked', () => {
    const rows = startFailureReasons(
      [{ cliKey: 'claude', ok: false, error: `could not seat under ${HOME}` }],
      undefined,
      (k) => (k === 'claude' ? 'Claude Code' : k),
    );
    expect(rows).toEqual(['Claude Code: could not seat under ~/.config/secret']);
  });
  it('picks up the response refused[] rows and dedupes by seat key (outcome wins)', () => {
    const rows = startFailureReasons(
      [{ cliKey: 'claude', ok: false, error: 'the open refused it' }],
      [{ cliKey: 'claude', reason: 'duplicate' }, { cliKey: 'codex', reason: 'out of quota' }],
      (k) => k,
    );
    expect(rows).toEqual(['claude: the open refused it', 'codex: out of quota']);
  });
});

describe('B-3: a failed estate step reads as failed, not as success', () => {
  it('a rejected Index step says "Mapping the code failed"; a rejected Annotate "Annotating the code map failed"', () => {
    expect(estateStepSummary('wicked-estate', 'Index', 'indexed 42 members', 'rejected')).toBe('Mapping the code failed');
    expect(estateStepSummary('wicked-estate', 'Annotate', 'annotated 6 member(s)', 'rejected')).toBe('Annotating the code map failed');
    // A successful step still reads with success words (default outcome unchanged).
    expect(estateStepSummary('wicked-estate', 'Index', 'indexed 42 members')).toBe('Mapped the code');
    expect(estateStepSummary('wicked-estate', 'Annotate', 'annotated 6 member(s)', 'done')).toBe('Annotated the code map');
  });
});

describe('B-4: per-helper reasons are sanitized before they reach the DOM', () => {
  const opt = (over: Partial<CliOption>): CliOption => ({ key: 'k', label: 'K', ok: true, reason: null, signInPath: null, optIn: false, ...over });
  it('noHelperNotice masks a home path (incl. a JSON-escaped Windows path) in every reason', () => {
    const n = noHelperNotice([
      opt({ key: 'a', label: 'Claude', ok: false, reason: `no credential at ${HOME}` }),
      opt({ key: 'b', label: 'Codex', ok: false, reason: `saved under ${WIN_ESCAPED}` }),
    ]);
    expect(n?.reasons[0]).toBe('Claude: no credential at ~/.config/secret');
    expect(n?.reasons[1]).toBe('Codex: saved under ~\\x');
    expect(n?.reasons.join(' ')).not.toContain('/Users/');
    expect(n?.reasons.join(' ')).not.toContain('\\Users\\');
  });
  it('composerSendRefusal masks a home path in every reason', () => {
    const refused = (reason: string) => ({ ok: false, reason });
    const seat = (key: string, name: string, reason: string): RosterSeat => ({
      key, display_name: name, binary: key, enabled_for_council: true, auth: 'signed_out', signed_in: false,
      chat_admission: { unscoped: refused(reason), scoped: refused(reason) },
    } as unknown as RosterSeat);
    const r = composerSendRefusal([seat('claude', 'Claude Code', `no credential at ${HOME}`)], false);
    expect(r?.reasons).toEqual(['Claude Code: no credential at ~/.config/secret']);
    expect(r?.reasons.join(' ')).not.toContain('/Users/');
  });
});

describe('B-5: structured auth decides signed-out, never the word "signed in" in the reason', () => {
  const refused = (reason: string) => ({ ok: false, reason });
  const seat = (over: Partial<RosterSeat> & { reason: string }): RosterSeat => ({
    key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true,
    chat_admission: { unscoped: refused(over.reason), scoped: refused(over.reason) },
    ...over,
  } as unknown as RosterSeat);
  it('a seat signed IN whose live check failed is not "signed out" → No helper can answer right now', () => {
    const s = seat({ auth: 'signed_in', signed_in: true, reason: 'status command says signed in, but its one live request did not answer' });
    expect(composerSendRefusal([s], false)?.line).toBe(NO_HELPER_AVAILABLE);
  });
  it('auth "unknown" (container runtime down) is not "signed out" → No helper can answer right now', () => {
    const s = seat({ auth: 'unknown', reason: "Docker isn't running" });
    expect(composerSendRefusal([s], false)?.line).toBe(NO_HELPER_AVAILABLE);
  });
  it('a genuinely signed-out seat still reads as signed in needed', () => {
    const s = seat({ auth: 'signed_out', signed_in: false, reason: 'signed out' });
    expect(composerSendRefusal([s], false)?.line).toBe(NO_HELPER_SIGNED_IN);
    // An older daemon with no `auth`, only `signed_in: false`.
    const old = seat({ signed_in: false, reason: 'no session' });
    delete (old as Record<string, unknown>).auth;
    expect(composerSendRefusal([old], false)?.line).toBe(NO_HELPER_SIGNED_IN);
  });
});

// ── B-6: the helper-free exception is only a plain reply to the existing helper-free run ──
const SIGNED_OUT = (key: string): RosterSeat => ({
  key, display_name: key, binary: key, enabled_for_council: true, auth: 'signed_out', signed_in: false,
  chat_admission: { unscoped: { ok: false, reason: 'signed out' }, scoped: { ok: false, reason: 'signed out' } },
} as unknown as RosterSeat);
const ROSTER = [SIGNED_OUT('claude'), SIGNED_OUT('codex')];
const REPO = { id: 'repo-1', name: 'svc', root_path: '/srv/svc', default_branch: 'main', registered_at: 0 } as RepoEntry;
// A live run whose only unit is estate's own tool — a helper-free job.
const ESTATE_RUN: SessionView = makeView(
  { id: 'r-estate', status: 'executing' },
  [makeUnit({ id: 'r-estate:idx', session_id: 'r-estate', ord: 0, status: 'distributed', assigned_cli: 'wicked-estate', stage: 'build' })],
);

function stubWire(): void {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const body = path === '/roster' ? { roster: ROSTER } : path === '/repos' ? { repos: [REPO] } : path === '/workflows' ? { workflows: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

function Harness({ onSend }: { onSend: (m: string, o: ComposerSend) => void }): React.ReactElement {
  const [text, setText] = useState('');
  return <Composer composerKey="desk" text={text} setText={setText} onSend={onSend} runs={[ESTATE_RUN]} started placeholder="p" ariaLabel="a" variant="desk" navigate={() => {}} />;
}
function key(k: string): void {
  fireEvent.keyDown(screen.getByTestId('desk-composer-input'), { key: k });
}
function type(text: string): void {
  const box = screen.getByTestId('desk-composer-input') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
  box.setSelectionRange(text.length, text.length);
  fireEvent.select(box);
}

describe('B-6: an estate-only run waves through a plain reply, never a new conversation', () => {
  beforeEach(() => {
    useCapabilities.setState({ loaded: true, chatJobProposals: false, workflowCatalogV2: false } as never);
    stubWire();
    clearCachedRoster();
    setCachedRoster(ROSTER);
    resetComposerSeats();
    resetPlanCatalog();
    clearCachedWorkflows();
    setCachedWorkflows([]);
    clearRepoCache();
    useComposerChips.setState({ byComposer: {} });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); useComposerChips.setState({ byComposer: {} }); });

  it('a plain message under the helper-free run says the job is fine and asking needs a helper; Send stays gated (review r2)', () => {
    const sent = vi.fn();
    render(<Harness onSend={sent} />);
    type('what did it map?');
    expect(screen.getByTestId('composer-refused')).toHaveTextContent('This job runs without a helper. Asking about it needs one.');
    expect(screen.getByTestId('composer-refused')).not.toHaveTextContent('No helper can take this');
    key('Enter');
    expect(sent).not.toHaveBeenCalled();
  });

  it('a new conversation (an @project chip) keeps its helper checks — the refusal stands', () => {
    render(<Harness onSend={() => {}} />);
    addAboutChip('desk', { kind: 'project', key: 'p:x', label: 'Ledger', projectId: 'x' });
    type('what changed in the ledger?');
    expect(screen.getByTestId('composer-refused')).toBeTruthy();
  });
});
