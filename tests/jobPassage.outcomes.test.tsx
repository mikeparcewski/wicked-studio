import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pendingRecord from './fixtures/mcp-install/pending.json';
import registeredRecord from './fixtures/mcp-install/registered.json';
import noVerbRecord from './fixtures/mcp-install/noverb.json';

/**
 * How a finished job says what it came to, in the session thread (J6):
 *  - studio#1365: a domain mapping names its coverage, its business domains and the way to the requirements.
 *  - studio#1364: a Decline at the MCP install's consent reads "Delivered, not installed" with the pull request that
 *    stays; never Stopped with Try again, and the run's story never quotes an older send-back as the reason.
 *  - studio#1367: an MCP-server job says what its install registered, from the install step's own record.
 *
 * The install records are garden's own `scripts/mcp/install.py --json` output (the `out` dict printed at main(), built in
 * do_install and register()), captured by running that script through garden's test rig (tests/mcp/test_mcp_install.py:
 * the secret_missing preview, a normal save, and an installer without the mcp verb), temp paths shortened. The audit
 * lines are crew's `gate.decided` (packages/crew/src/api/routes.ts, `audit.record('gate.decided', …)`: approve, choice,
 * ord, status).
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useProvenanceStore } = await import('../src/store/provenance.js');
const { resetJobLocal } = await import('../src/hooks/useJobStream.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { jobProposal } = await import('./jobFixtures.js');
const { installRecordOf, installWords, clisWords } = await import('../src/board/installOutcome.js');
const { resetOutcomeReadsForTest } = await import('../src/components/session/JobPassage.js');

const CHAT = 'chat-j';
const RUN = 'run-1';
const T0 = 1_700_000_000_000;
const PR = 'https://github.com/acme/notes-mcp/pull/7';

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'build an MCP server for acme notes' };
const P1 = { at: T0 + 2, turnId: 't1', kind: 'proposal', proposal: jobProposal() };
const DECIDED = { at: T0 + 5, turnId: 't1', kind: 'proposal_decided', pid: `${CHAT}:t1`, decision: 'go', result: { runId: RUN, artifactRef: null, adopted: false, stub: false } };

let audit: unknown[] = [];
let auditAnswer: (() => Promise<Response>) | null = null;
let requirements: () => Response = () => ok({}, 404);
let unitOutput: () => Response | Promise<Response> = () => ok({ output: null });
let messages: unknown[] | null = null;
const reads: string[] = [];

beforeEach(() => {
  audit = [];
  messages = null;
  auditAnswer = null;
  reads.length = 0;
  resetOutcomeReadsForTest();
  resetJobLocal();
  clearRepoCache();
  useProvenanceStore.setState({ byRun: {}, rejectNotes: {}, cancelStories: {}, baseNotices: {}, endedRead: {}, endedDone: {} });
  useCapabilities.setState({ loaded: true, gateActions: false, runChatId: true, askPath: false, chatProposals: true, chatList: true, chatJobProposals: true, reshapeRun: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    const path = u.pathname.replace(/^\/api\/v1/, '');
    reads.push(`${init?.method ?? 'GET'} ${path}`);
    if (init?.method === 'POST') return Promise.resolve(ok({ view: {} }));
    if (path.startsWith('/chats/') && !path.includes('/considered')) {
      return Promise.resolve(ok({ chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages: messages ?? [USER, P1, DECIDED] }));
    }
    if (path === '/audit') return auditAnswer !== null ? auditAnswer() : Promise.resolve(ok({ entries: audit }));
    if (path === '/repos') return Promise.resolve(ok({ repos: [{ id: 'repo-crew', name: 'wicked-crew', path: '/src/wicked-crew' }] }));
    if (path.startsWith('/repos/repo-crew/requirements')) return Promise.resolve(requirements());
    if (path.startsWith(`/runs/${RUN}/units/`) && path.endsWith('/output')) return Promise.resolve(unitOutput());
    if (path.endsWith('/team')) return Promise.resolve(ok({ teamed: false, rows: [], units: [] }));
    if (path.endsWith('/events')) return Promise.resolve(ok({ events: [] }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const page = (runs: ReturnType<typeof makeView>[]) => render(<SessionPage sessionId={CHAT} runs={runs} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);

// The mcp-server workflow's last steps, as crew's builtin def declares them (crew tests/support/builtin-fixtures.ts:
// install-plan runs the dry run; install is `consent_before` and runs the real install).
const DELIVER = makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 7, status: 'done', phase_ref: 'deliver', stage: 'deliver' as never });
const PLAN = makeUnit({ id: `${RUN}:install-plan`, session_id: RUN, ord: 8, status: 'done', phase_ref: 'install-plan',
  tool_cmd: ['bash', '-c', 'exec "${WICKED_GARDEN_ROOT:?}/scripts/wicked-garden" run scripts/mcp/install.py --from-run --dry-run --json'] as never });
// A step with its own review gate before the delivery (a non-consent gate a reject can end the run at).
const REVIEW = makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 5, status: 'done', phase_ref: 'review', gate: { human_confirm: { unconditional: true } } as never });
const install = (status: 'pending' | 'done' | 'rejected') => makeUnit({ id: `${RUN}:install`, session_id: RUN, ord: 9, status, phase_ref: 'install', gate: 'consent_before' as never,
  tool_cmd: ['bash', '-c', 'exec "${WICKED_GARDEN_ROOT:?}/scripts/wicked-garden" run scripts/mcp/install.py --from-run --target "${WICKED_CONSENT_CHOICE:?}" --json'] as never });
const mcpRun = (status: 'completed' | 'cancelled', installStatus: 'pending' | 'done' | 'rejected', delivered = true) => makeView({
  id: RUN, status, workflow_id: 'mcp-server', unit_ix: 9, chat_id: CHAT, from_proposal: `${CHAT}:t1`, created_at: (T0 + 5) / 1000,
  ...(delivered ? { delivery: 'delivered', deliverUrl: PR } : { delivery: 'none' }),
} as never, [REVIEW, DELIVER, PLAN, install(installStatus)]);

const human = { id: 'operator', kind: 'human' };
const sendBack = { ts: T0 + 100, action: 'gate.decided', actor: human, runId: RUN, detail: { approve: false, choice: 'request_changes', amend: 'Rename the counter tool', action: 'request_changes', ord: 5, status: 'executing' } };
const decline = { ts: T0 + 900, action: 'gate.decided', actor: human, runId: RUN, detail: { approve: false, choice: 'reject', ord: 9, status: 'cancelled' } };

describe('studio#1364: Decline at the install consent', () => {
  it('reads Delivered, not installed, names the pull request, quotes no send-back and offers no Try again', async () => {
    audit = [decline, sendBack]; // newest first, as GET /audit serves it
    page([mcpRun('cancelled', 'pending')]);
    const declined = await screen.findByTestId('job-passage-declined');
    expect(declined.textContent).toContain('Delivered, not installed.');
    expect(declined.textContent).toContain('You declined the install, so nothing was installed.');
    expect(declined.textContent).toContain('Pull request #7 was delivered and stays as it is.');
    expect(within(declined).getByRole('link', { name: 'Pull request #7' }).getAttribute('href')).toBe(PR);
    expect(declined.textContent).not.toContain('Rename the counter tool');
    expect(screen.queryByTestId('job-passage-stopped')).toBeNull();
    expect(screen.queryByTestId('job-passage-try-again')).toBeNull();
    expect(screen.getByTestId('job-passage').className).toContain('wk-pass--ok');
  });

  it('a stop that was not a consent Decline still offers Try again', async () => {
    audit = [sendBack];
    page([mcpRun('cancelled', 'pending')]);
    expect(await screen.findByTestId('job-passage-try-again')).toBeTruthy();
    expect(screen.queryByTestId('job-passage-declined')).toBeNull();
  });

  it('a reject at a non-consent gate (the review step) is a stop, not a declined install', async () => {
    audit = [{ ...decline, detail: { ...decline.detail, ord: 5 } }, sendBack];
    page([mcpRun('cancelled', 'pending')]);
    expect(await screen.findByTestId('job-passage-try-again')).toBeTruthy();
    expect(screen.queryByTestId('job-passage-declined')).toBeNull();
  });

  it('a person’s Stop wins over a consent rejection on record', async () => {
    const stop = { ts: T0 + 950, action: 'run.cancelled', actor: human, runId: RUN, detail: { reason: 'Not this week' } };
    audit = [stop, decline];
    page([mcpRun('cancelled', 'pending')]);
    expect(await screen.findByTestId('job-passage-try-again')).toBeTruthy();
    expect(screen.queryByTestId('job-passage-declined')).toBeNull();
  });

  it('a reject after the install step ran (its own triage gate) is not a declined install', async () => {
    audit = [decline];
    page([mcpRun('cancelled', 'rejected')]);
    expect(await screen.findByTestId('job-passage-try-again')).toBeTruthy();
    expect(screen.queryByTestId('job-passage-declined')).toBeNull();
  });

  it('an earlier rejection the run went on past is not why it ended', async () => {
    const approvedLater = { ts: T0 + 950, action: 'gate.decided', actor: human, runId: RUN, detail: { approve: true, choice: 'approve', ord: 9, status: 'executing' } };
    audit = [approvedLater, decline];
    page([mcpRun('cancelled', 'pending')]);
    expect(await screen.findByTestId('job-passage-try-again')).toBeTruthy();
    expect(screen.queryByTestId('job-passage-declined')).toBeNull();
  });

  it('with no delivery on record it says Not installed, never Delivered', async () => {
    audit = [decline];
    page([mcpRun('cancelled', 'pending', false)]);
    const declined = await screen.findByTestId('job-passage-declined');
    expect(declined.textContent).toMatch(/^Not installed\. You declined the install, so nothing was installed\./);
    expect(declined.textContent).not.toContain('Delivered');
  });

  it('until the ended audit read answers, nothing says Stopped or offers Try again (no flash), even over a warm live read', async () => {
    // A live read from while the job ran is in the store, with no rejection yet (codex r1).
    useProvenanceStore.setState({ byRun: { [RUN]: { state: 'unknown' } }, cancelStories: { [RUN]: { rejectNote: null, sendBackNote: 'Rename the counter tool', rejected: null, engineTimedOut: false, stop: null } } });
    let answer: (r: Response) => void = () => {};
    auditAnswer = () => new Promise<Response>((res) => { answer = res; });
    page([mcpRun('cancelled', 'pending')]);
    await screen.findByTestId('job-passage');
    await waitFor(() => expect(reads).toContain('GET /audit'));
    expect(screen.queryByTestId('job-passage-stopped')).toBeNull();
    expect(screen.queryByTestId('job-passage-try-again')).toBeNull();
    expect(screen.getByTestId('job-passage').className).not.toContain('wk-pass--bad');
    answer(ok({ entries: [decline, sendBack] }));
    expect(await screen.findByTestId('job-passage-declined')).toBeTruthy();
    expect(screen.queryByTestId('job-passage-try-again')).toBeNull();
  });
});

describe('studio#1364: the run story', () => {
  it('says the install was declined and never offers the older send-back as why', async () => {
    const { RunStory } = await import('../src/components/session/RunRecord.js');
    audit = [decline, sendBack];
    render(<RunStory view={mcpRun('cancelled', 'pending')} />);
    const line = await screen.findByTestId('failure-declined');
    expect(line.textContent).toBe('You declined the install, so nothing was installed. Pull request #7 was delivered and stays as it is.');
    expect(screen.queryByTestId('failure-send-back-note')).toBeNull();
  });

  it('a reject with no words at another gate (the review step) is the reason; the older send-back is not quoted', async () => {
    const { RunStory } = await import('../src/components/session/RunRecord.js');
    audit = [{ ...decline, detail: { ...decline.detail, ord: 5 } }, sendBack];
    render(<RunStory view={mcpRun('cancelled', 'pending')} />);
    await waitFor(() => expect(screen.getByTestId('failure-banner').dataset['cause']).toBe('rejected'));
    expect(screen.getByTestId('failure-reject-note').textContent).toBe('You rejected it; no reason was given.');
    expect(screen.queryByTestId('failure-send-back-note')).toBeNull();
  });
  it('the header badge says Not installed (calm), not a red Cancelled; a plain stop keeps Cancelled', async () => {
    audit = [decline, sendBack];
    const first = page([mcpRun('cancelled', 'pending')]);
    await waitFor(() => expect(screen.getByTestId('session-status').textContent).toBe('Not installed'), { timeout: 4000 });
    expect(screen.getByTestId('session-status').dataset['tone']).toBe('quiet');
    first.unmount();
    useProvenanceStore.setState({ byRun: {}, rejectNotes: {}, cancelStories: {}, baseNotices: {}, endedRead: {}, endedDone: {} });
    audit = [sendBack];
    page([mcpRun('cancelled', 'pending')]);
    await screen.findByTestId('job-passage-try-again', {}, { timeout: 4000 });
    expect(screen.getByTestId('session-status').textContent).toBe('Cancelled');
    expect(screen.getByTestId('session-status').dataset['tone']).toBe('danger');
  });

  it('the run’s record offers no Start over after a declined install; a plain stop keeps it', async () => {
    const { RecoveryRow } = await import('../src/components/session/RunConversation.js');
    audit = [decline, sendBack];
    const first = render(<RecoveryRow view={mcpRun('cancelled', 'pending')} navigate={() => {}} />);
    await waitFor(() => expect(useProvenanceStore.getState().endedDone[RUN]).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('session-run-retry')).toBeNull());
    first.unmount();
    useProvenanceStore.setState({ byRun: {}, rejectNotes: {}, cancelStories: {}, baseNotices: {}, endedRead: {}, endedDone: {} });
    audit = [sendBack];
    render(<RecoveryRow view={mcpRun('cancelled', 'pending')} navigate={() => {}} />);
    await waitFor(() => expect(useProvenanceStore.getState().endedDone[RUN]).toBe(true));
    expect(screen.getByTestId('session-run-retry')).toBeTruthy();
  });
});

describe('studio#1367: a finished MCP-server job says what its install did', () => {
  const output = (record: unknown) => () => ok({ output: `staging acme-notes…\n${JSON.stringify(record)}\n` });

  it('not registered: names the missing token and the way to add it, never a plain Done', async () => {
    unitOutput = output(pendingRecord);
    page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('not-registered'), { timeout: 4000 });
    expect(screen.getByTestId('job-passage-install').textContent).toContain('Installed, but not registered in MCP tools: it needs ACME_NOTES_TOKEN, which Studio’s service can’t find.');
    expect(screen.getByTestId('job-passage-install-todo').textContent).toMatch(/^Add the server in MCP tools with Add existing/);
    expect(screen.getByTestId('job-passage-install-clis').textContent).toBe('Added to Claude Code and Codex. Not added to Pi (no MCP target).');
    expect(screen.getByTestId('job-passage-install-mcp').getAttribute('href')).toBe('/mcp');
    expect(screen.getByTestId('job-passage-delivered').textContent).toMatch(/^Delivered, but not registered · Pull request #7/);
    expect(reads).toContain(`GET /runs/${RUN}/units/install/output`);
  });

  it('reads the install record once per run: leaving and coming back reads nothing again', async () => {
    unitOutput = output(registeredRecord);
    const first = page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('registered'), { timeout: 4000 });
    first.unmount();
    page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('registered'));
    expect(reads.filter((r) => r === `GET /runs/${RUN}/units/install/output`)).toHaveLength(1);
  });

  it('a home path in the installer’s words is shown as ~', async () => {
    unitOutput = output({ ...pendingRecord, clis: [{ cli: 'codex', result: 'failed', target: '/home/alice/.codex/config.toml', detail: 'failed: cannot write /home/alice/.codex/config.toml' }] });
    page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install-clis').textContent).toContain('Not added to Codex (cannot write ~/.codex/config.toml).'), { timeout: 4000 });
    expect(document.body.textContent).not.toContain('/home/alice');
  });

  it('registered: says so with its tools, and links to the server', async () => {
    unitOutput = output(registeredRecord);
    page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('registered'));
    expect(screen.getByTestId('job-passage-install').textContent).toContain('Installed and registered in MCP tools: 2 tools.');
    expect(screen.getByTestId('job-passage-install-mcp').getAttribute('href')).toBe('/mcp?server=acme-notes');
  });

  it('the CLI configurations skipped: says they were not updated and what to do, the installer’s words behind details', () => {
    const w = installWords(installRecordOf(JSON.stringify(noVerbRecord))!);
    expect(w.registered).toBe(true);
    expect(w.clis).toEqual(['The helpers’ CLI configurations were not updated, so those CLIs can’t use it yet. Update wicked-installer, then run the install again.']);
    expect(w.detail).toEqual(['wicked-installer lacks the mcp verb (needs >= the release that adds it)']);
    expect(clisWords('skipped: --cli none')).toBeNull();
  });

  it('“Also install into my CLIs”: the person’s own CLIs are said too, failures included', () => {
    const w = installWords(installRecordOf(JSON.stringify({ ...registeredRecord, target: 'operator',
      operatorClis: [{ cli: 'claude', result: 'written', target: '~/.claude.json', detail: null }, { cli: 'codex', result: 'failed', target: '~/.codex/config.toml', detail: 'failed: config is read-only' }] }))!);
    expect(w.clis).toEqual([
      'Added to Claude Code and Codex. Not added to Pi (no MCP target).',
      'Added to your own Claude Code. Not added to your own Codex (config is read-only).',
    ]);
  });

  it('an updated server says so', () => {
    expect(installWords(installRecordOf(JSON.stringify({ ...registeredRecord, registered: 'updated' }))!).line).toBe('Installed and updated in MCP tools: 2 tools.');
  });

  it('only garden’s record counts: other JSON lines (before or after it) are not read as one', () => {
    const real = JSON.stringify(pendingRecord);
    expect(installRecordOf(`${real}\n{"registered": true}\n{"ok": true, "note": "done"}`)!.registered).toBe(false);
    expect(installRecordOf('{"registered": true}')).toBeNull();
    expect(installRecordOf('{"ok": true, "key": "x", "registered": "maybe"}')).toBeNull();
  });

  it('a failed install record and output with no record are said, never a plain Done', () => {
    expect(installRecordOf('npm ci…\nno json here')).toBeNull();
    const failed = installWords(installRecordOf('{"ok": false, "error": "the staged server failed its smoke: boom"}')!);
    expect(failed.line).toBe('The install failed: the staged server failed its smoke: boom.');
    expect(failed.todo).toBe('Fix what it names, then run the job again.');
  });
});

describe('studio#1365: a finished domain mapping names what it found', () => {
  const COVERAGE = { realPct: 85, minPct: 80, behaviorBearing: 5786, real: 4918, placeholders: 841, unmapped: 27, notProduct: 2380 };
  const DOMAINS = ['Billing', 'Runs', 'Gates'].map((name, i) => ({ id: `d${i}`, name, purpose: `${name} rules`, requirements: [], directories: [] }));
  const domainRun = () => makeView({
    id: RUN, status: 'completed', workflow_id: 'domain-extraction', repo_ref: 'repo-crew', unit_ix: 12, chat_id: CHAT, from_proposal: `${CHAT}:t1`, created_at: (T0 + 5) / 1000,
    delivery: 'none',
  } as never, [makeUnit({ id: `${RUN}:domain-graph`, session_id: RUN, ord: 12, status: 'done', phase_ref: 'domain-graph' })]);

  it('shows the coverage figure, the business domains and opens the repository’s requirements', async () => {
    requirements = () => ok({ total: 1, corpus: 4918, offset: 0, limit: 1, items: [], source: 'store', coverage: COVERAGE, businessDomains: DOMAINS });
    page([domainRun()]);
    await waitFor(() => expect(screen.getByTestId('job-passage-domain-result').dataset['state']).toBe('built'), { timeout: 4000 });
    expect(screen.getByTestId('job-passage-domain-result').textContent).toContain('Mapped 85% real requirements · minimum 80%, across 3 business domains.');
    expect(screen.getByTestId('job-passage-delivered').textContent).toMatch(/^Finished\./);
    expect(screen.getByTestId('job-passage-delivered').textContent).not.toMatch(/nothing to deliver/i);
    fireEvent.click(screen.getByTestId('job-passage-requirements-open'));
    expect(await screen.findByTestId('requirements-coverage-headline', {}, { timeout: 4000 })).toHaveTextContent('85% real requirements · minimum 80%');
  });

  it('after “Finish with what was found” (a lowered minimum) the figure is the one the map was built at, not the store now', async () => {
    const built = { ...COVERAGE, realPct: 42, minPct: 42, real: 2410 };
    // a later mapping moved the store on (48%) without building: the job's map is still the 42% one
    requirements = () => ok({ total: 1, corpus: 2410, offset: 0, limit: 1, items: [], source: 'store', coverage: { ...built, realPct: 48, real: 2760 },
      graphBuild: { generation: 3, coverage: built, behind: true }, businessDomains: DOMAINS.slice(0, 2) });
    page([domainRun()]);
    await waitFor(() => expect(screen.getByTestId('job-passage-domain-result').textContent).toContain('Mapped 42% real requirements · minimum 42%, across 2 business domains.'));
  });

  it('a map that was not built says so with the share, and still opens the requirements', async () => {
    requirements = () => ok({ error: 'No requirements graph yet for this repository', code: 'notGenerated', workflow: 'domain-extraction', coverage: { ...COVERAGE, realPct: 42, real: 2410 } }, 404);
    page([domainRun()]);
    await waitFor(() => expect(screen.getByTestId('job-passage-domain-result').dataset['state']).toBe('not-built'), { timeout: 4000 });
    expect(screen.getByTestId('job-passage-domain-result').textContent).toContain('The requirements map wasn’t built: 42% real requirements · minimum 80%.');
    expect(screen.getByTestId('job-passage-requirements-open')).toBeTruthy();
  });

  it('a run on a project (no repository) links to the project’s requirements, and is not left loading', async () => {
    page([makeView({ ...domainRun().session, repo_ref: null, project_id: 'proj-1' } as never, domainRun().units)]);
    const line = await screen.findByTestId('job-passage-domain-result');
    expect(line.dataset['state']).toBe('project');
    expect(screen.getByTestId('job-passage-requirements-open').getAttribute('href')).toBe('/projects/proj-1/requirements');
  });

  it('closing the requirements view reads the result again (a map built there is said)', async () => {
    let built = false;
    requirements = () => (built
      ? ok({ total: 1, corpus: 2410, offset: 0, limit: 1, items: [], source: 'store', coverage: { ...COVERAGE, realPct: 42, minPct: 42, real: 2410 }, businessDomains: DOMAINS })
      : ok({ error: 'No requirements graph yet for this repository', code: 'notGenerated', workflow: 'domain-extraction', coverage: { ...COVERAGE, realPct: 42, real: 2410 } }, 404));
    page([domainRun()]);
    await waitFor(() => expect(screen.getByTestId('job-passage-domain-result').dataset['state']).toBe('not-built'), { timeout: 4000 });
    fireEvent.click(screen.getByTestId('job-passage-requirements-open'));
    await screen.findByTestId('requirements-not-generated', {}, { timeout: 4000 });
    built = true;
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('job-passage-domain-result').dataset['state']).toBe('built'), { timeout: 4000 });
  });
});

describe('studio#1382: an install that registered nothing never reads as a plain green Finished', () => {
  const output = (record: unknown) => () => ok({ output: `staging acme-notes…\n${JSON.stringify(record)}\n` });
  const passage = () => screen.getByTestId('job-passage');
  const badge = () => screen.getByTestId('session-status');

  it('not registered (garden’s pending record): the lead says it once, in studio’s words; amber edge and badge', async () => {
    unitOutput = output(pendingRecord);
    page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('not-registered'), { timeout: 4000 });
    const lead = screen.getByTestId('job-passage-delivered').querySelector('p')!.textContent;
    expect(lead).toBe('Delivered, but not registered · Pull request #7');
    expect(screen.getByTestId('job-passage-delivered').textContent).not.toContain('Finished');
    expect(screen.getByTestId('job-passage-install-todo').textContent).toContain('set ACME_NOTES_TOKEN in the environment Studio’s service runs in, and run the install again.');
    expect(passage().textContent).not.toMatch(/daemon/i);
    await waitFor(() => expect(badge().textContent).toBe('Not registered'));
    expect(badge().dataset['tone']).toBe('gate');
    expect(passage().className).toContain('wk-pass--needs');
    expect(passage().className).not.toContain('wk-pass--ok');
    // The header, the passage's edge and the delivery's lines share ONE read of the install's output.
    expect(reads.filter((r) => r === `GET /runs/${RUN}/units/install/output`)).toHaveLength(1);
  });

  it('a failed install with a record: says the install failed; red edge, Install failed badge', async () => {
    unitOutput = output({ ok: false, error: 'the staged server failed its smoke: boom' });
    page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('failed'), { timeout: 4000 });
    expect(screen.getByTestId('job-passage-delivered').querySelector('p')!.textContent).toBe('Delivered, but the install failed · Pull request #7');
    await waitFor(() => expect(badge().textContent).toBe('Install failed'));
    expect(badge().dataset['tone']).toBe('danger');
    expect(passage().className).toContain('wk-pass--bad');
  });

  it('registered: still the green Finished and Done', async () => {
    unitOutput = output(registeredRecord);
    page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('registered'), { timeout: 4000 });
    expect(screen.getByTestId('job-passage-delivered').querySelector('p')!.textContent).toBe('Done. Finished · delivered · Pull request #7');
    expect(badge().textContent).toBe('Finished');
    expect(badge().dataset['tone']).toBe('ok');
    expect(passage().className).toContain('wk-pass--ok');
  });

  it('no service to register with: the next step names Studio’s service, not the daemon', () => {
    const w = installWords(installRecordOf(JSON.stringify({ ...pendingRecord, missing: [], reason: 'no daemon at http://127.0.0.1:7701' }))!);
    expect(w.todo).toBe('Start Studio’s service, then run the install again, or add the server in MCP tools with Add existing.');
  });

  it('while the install record is read, nothing claims a success: no green edge or badge, no "Done"', async () => {
    let answer!: (r: Response) => void;
    unitOutput = () => new Promise<Response>((r) => { answer = r; });
    page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('loading'), { timeout: 4000 });
    expect(screen.getByTestId('job-passage-delivered').querySelector('p')!.textContent).toBe('Delivered · Pull request #7');
    expect(passage().className).not.toContain('wk-pass--ok');
    expect(badge().textContent).toBe('Finished');
    expect(badge().dataset['tone']).toBe('quiet');
    await act(async () => { answer(output(pendingRecord)()); });
    await waitFor(() => expect(badge().textContent).toBe('Not registered'));
    expect(passage().className).toContain('wk-pass--needs');
  });

  it('Try again after a failed read reaches every surface: the header and the edge follow the delivery’s lines', async () => {
    let calls = 0;
    unitOutput = () => (++calls === 1 ? ok({ error: 'boom' }, 500) : output(pendingRecord)());
    page([mcpRun('completed', 'done')]);
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('failed'), { timeout: 4000 });
    // A read that failed says nothing about the install: the badge is the run's own.
    expect(badge().textContent).toBe('Finished');
    fireEvent.click(screen.getByTestId('job-passage-install-retry'));
    await waitFor(() => expect(screen.getByTestId('job-passage-install').dataset['state']).toBe('not-registered'));
    await waitFor(() => expect(badge().textContent).toBe('Not registered'));
    expect(passage().className).toContain('wk-pass--needs');
    expect(reads.filter((r) => r === `GET /runs/${RUN}/units/install/output`)).toHaveLength(2);
  });

  it('an older job (a newer one proposed after it) keeps saying its install registered nothing, never "Done"', async () => {
    unitOutput = output(pendingRecord);
    const P2 = { at: T0 + 20, turnId: 't2', kind: 'proposal', proposal: jobProposal({ pid: `${CHAT}:t2`, turnId: 't2', lineage: `${CHAT}:t2` } as never) };
    messages = [USER, P1, DECIDED, { ...USER, at: T0 + 10, turnId: 't2', text: 'and a second one' }, P2];
    page([mcpRun('completed', 'done')]);
    await waitFor(() => {
      const older = screen.getAllByTestId('job-passage').find((el) => el.dataset['settled'] === 'true');
      expect(older?.textContent).toMatch(/^Delivered, but not registered\. /);
    }, { timeout: 4000 });
    const older = screen.getAllByTestId('job-passage').find((el) => el.dataset['settled'] === 'true')!;
    expect(older.textContent).toContain('Pull request #7');
    expect(older.textContent).not.toMatch(/^Done\./);
  });
});
