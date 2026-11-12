import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { codeWords, jiraBasic, PmSourceSheet, reachFailureOf, reachLines, reachOf, savedWords, toolGroupsOf, toolReview, toolReviewsOf } from '../src/components/sources/PmSourceSheet.js';
import { ApiError } from '../src/api/errors.js';
import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { pgServer } from './sourcesFixtures.js';

/**
 * DES-PM-001 PM-1, studio: the hand-built Jira and GitHub Issues source sheets (COORD DEFAULT until the generated A2UI
 * surface) over a mocked crew (`POST /mcp/servers/preview` with `pm`, `POST /mcp/servers`, `GET /sources/:name/trackers`):
 * the token is typed once, sent only with the preview and kept in no DOM attribute; the restricted-token advice; Test,
 * then each tool's review; Save; Test connection's reach; the Agents switches. NC1: on a crew without tracker links the
 * Data sources page offers no PM kind and no PM list.
 */

// A plain fixture word, not a credential shape: no scanner reads it as a secret.
const TOKEN = 'fixture-token-not-a-secret';
const jiraTools = [
  { name: 'searchJiraIssuesUsingJql', class: 'read', binding: { policy: 'jira/searchJiraIssuesUsingJql@1' } },
  { name: 'getJiraIssue', class: 'read', binding: { policy: 'jira/getJiraIssue@1' } },
  { name: 'getVisibleJiraProjects', class: 'read', binding: null },
  { name: 'addCommentToJiraIssue', class: 'write', binding: null },
].map((t) => ({ subject: t.name, description: null, annotations: null, inputSchema: null, classOverride: null, schemaHash: 'h', enabledOnSave: true, ...t }));
const jiraServer = (over: Record<string, unknown> = {}) => ({
  ...pgServer({ name: 'jira' }), kind: 'mcp-http', sql: undefined, url: 'https://mcp.atlassian.com/v2/mcp', pm: { system: 'jira' }, authState: 'set',
  tools: jiraTools.map((t) => ({ ...t, derivedClass: t.class, enabled: true, status: 'registered', observedSchemaHash: 'h', binding: t.binding === null ? null : { ...t.binding, schemaHash: 'h', inForce: true } })),
  agents: { see: true, query: false, projects: ['proj_billing'], everyProject: false },
  trackers: [],
  ...over,
});

let calls: Array<{ path: string; method: string; body: unknown }> = [];
let servers: unknown[] = [];
let cliAnswer: unknown;
beforeEach(() => {
  calls = [];
  servers = [];
  cliAnswer = undefined;
  useCapabilities.setState({ loaded: true, dataSources: true, trackerLinks: true });
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (path === '/mcp/servers/preview') return Promise.resolve({ previewHash: 'ph-1', expiresAt: '2026-11-04T20:00:00Z', server: { ...body, command: null, args: [] }, serverInfo: { name: 'atlassian-mcp', version: '2.0' }, tools: jiraTools, diff: null });
    if (path === '/mcp/servers' && method === 'POST') { servers = [jiraServer()]; return Promise.resolve(jiraServer()); }
    if (path === '/mcp/servers') return Promise.resolve({ servers, discovered: [], ...(cliAnswer !== undefined ? { ghCli: cliAnswer } : {}) });
    if (path === '/sources/jira/trackers') {
      return Promise.resolve({ name: 'jira', next: 'c2', trackers: [
        { tenant: 'cloud-1', tenantLabel: 'acme.atlassian.net', key: 'BILL', label: 'Billing', links: [] },
        { tenant: 'cloud-1', tenantLabel: 'acme.atlassian.net', key: 'PAY', label: 'Payments', links: [] },
        { tenant: 'cloud-2', tenantLabel: 'acme-labs.atlassian.net', key: 'LAB', label: 'Labs', links: [] },
      ] });
    }
    if (path === '/projects?status=active') return Promise.resolve({ projects: [{ id: 'proj_billing', name: 'Billing' }] });
    if (path === '/sources/jira/agent-queries') return Promise.resolve({ name: 'jira', known: true, queries: [] });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});
afterEach(() => { cleanup(); useCapabilities.setState({ trackerLinks: false }); });

describe('the Jira sheet (mockup screen 1a)', () => {
  it('the token is sent once, with the preview only, as Atlassian’s Basic credential; it is never in the DOM', async () => {
    const onSaved = vi.fn();
    render(<PmSourceSheet target={{ mode: 'new', system: 'jira' }} existing={[]} onSaved={onSaved} onClose={vi.fn()} />);
    expect(screen.getByTestId('pm-sheet-title')).toHaveTextContent('Add Jira');
    expect(screen.getByTestId('pm-url')).toHaveValue('https://mcp.atlassian.com/v2/mcp');
    expect(screen.getByTestId('pm-token-advice')).toHaveTextContent('Jira API tokens can’t be limited to projects. crew limits every call to the Jira projects you link');
    expect(screen.getByTestId('pm-test-run')).toBeDisabled();
    fireEvent.change(screen.getByTestId('pm-email'), { target: { value: 'crew-bot@acme.example' } });
    const secret = screen.getByTestId('pm-secret') as HTMLInputElement;
    secret.value = TOKEN;
    fireEvent.input(secret);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    fireEvent.click(screen.getByTestId('pm-test-run'));
    await screen.findByTestId('pm-test-lines');
    // Sent once: the field let go of it, and a second test needs it typed again.
    expect(secret.value).toBe('');
    expect(screen.getByTestId('pm-test-run')).toBeDisabled();
    expect(screen.getByTestId('pm-sheet-foot')).toHaveTextContent('Saving keeps the token in your keychain.');
    expect(document.body.innerHTML).not.toContain(jiraBasic('crew-bot@acme.example', TOKEN));
    const preview = calls.find((c) => c.path === '/mcp/servers/preview')!;
    expect(preview.body).toEqual({
      name: 'jira', kind: 'mcp-http', url: 'https://mcp.atlassian.com/v2/mcp',
      auth: { ref: 'keychain:wicked-mcp/jira', header: 'Authorization', prefix: 'Basic ' }, pm: { system: 'jira' },
      secret: jiraBasic('crew-bot@acme.example', TOKEN),
    });
    expect(atob(jiraBasic('crew-bot@acme.example', TOKEN))).toBe(`crew-bot@acme.example:${TOKEN}`);
    // Each tool, reviewed and grouped with its reason: bound reads, a write that asks, an unbindable read by name only.
    expect(screen.getAllByTestId('pm-tool').map((t) => [t.dataset.tool, t.dataset.verdict])).toEqual([
      ['searchJiraIssuesUsingJql', 'reviewed'], ['getJiraIssue', 'reviewed'], ['addCommentToJiraIssue', 'asks'],
    ]);
    expect(screen.getAllByTestId('pm-tool-verdict').map((v) => v.textContent)).toEqual(['Reviewed', 'Reviewed', 'Asks you']);
    expect(screen.getAllByTestId('pm-tool-group').map((g) => g.dataset.group)).toEqual(['agents', 'writes', 'unscoped']);
    expect(screen.getAllByTestId('pm-tool-chip').map((t) => [t.dataset.tool, t.dataset.verdict])).toEqual([['getVisibleJiraProjects', 'not_for_agents']]);
    expect(screen.getAllByTestId('pm-tool-group-head')[2]).toHaveTextContent('Not for agents (1): Can’t be limited to your linked Jira projects.');
    // The write tool is granted only by its tick (crew's G1 `enabledWrites`): the person ticks the comment tool.
    const grants = screen.getAllByTestId('pm-tool-grant');
    expect(grants).toHaveLength(1);
    fireEvent.click(within(grants[0]!).getByRole('checkbox'));
    // Save registers exactly the preview, lets go of the token, then reads what the token reaches (no issue read).
    fireEvent.click(screen.getByTestId('pm-save'));
    await screen.findByTestId('pm-test-reach-lines');
    expect(calls.find((c) => c.path === '/mcp/servers' && c.method === 'POST')!.body).toEqual({ previewHash: 'ph-1', enabledWrites: ['addCommentToJiraIssue'] });
    expect(calls.filter((c) => JSON.stringify(c.body ?? '').includes(jiraBasic('crew-bot@acme.example', TOKEN)))).toHaveLength(1);
    expect(screen.getByTestId('pm-test-reach-lines')).toHaveTextContent('This token reaches at least 2 sites: acme.atlassian.net, acme-labs.atlassian.net. Each tracker you link names its site.');
    expect(screen.getByTestId('pm-test-reach-lines')).toHaveTextContent('At least 2 projects visible on acme.atlassian.net, 1 on acme-labs.atlassian.net.');
    expect(onSaved).toHaveBeenCalledTimes(1);
    // The saved source's Agents switches, in PM words.
    const box = await screen.findByTestId('pm-agent-controls');
    expect(within(box).getByText('Agents can see its structure')).toBeInTheDocument();
    expect(within(box).getByText('Agents can read issues')).toBeInTheDocument();
  });

  it('a saved tool whose binding is no longer in force says to review it again', () => {
    expect(toolReview({ name: 'getJiraIssue', class: 'read', binding: { policy: 'p', schemaHash: 'h', inForce: false } }, true).verdict).toBe('review_again');
    expect(toolReview({ name: 'x', class: 'read', binding: null }).verdict).toBe('not_for_agents');
    // A binding studio can't read whole, or none at all, claims nothing; saved, only one in force is "Reviewed".
    expect(toolReview({ name: 'x', class: 'read' }).verdict).toBe('unknown');
    expect(toolReview({ name: 'x', class: 'read', binding: { policy: 'p' } }, true).verdict).toBe('unknown');
    expect(toolReview({ name: 'x', class: 'read', binding: { policy: 'p', inForce: true } }, true).verdict).toBe('reviewed');
    expect(toolReview({ name: 'x', class: 'read', binding: { policy: 'p' } }).verdict).toBe('reviewed');
    expect(toolReviewsOf([{ name: 'a', class: 'read', binding: null }, null], true)).toBeNull();
    expect(toolReviewsOf(undefined, true)).toBeNull();
    // A saved write says whether it was granted at the save.
    expect(toolReview({ name: 'w', class: 'write', binding: null, enabled: true } as never, true).granted).toBe(true);
    expect(toolReview({ name: 'w', class: 'write', binding: null, enabled: false } as never, true).granted).toBe(false);
    expect(toolReview({ name: 'x', class: 'destructive', binding: { policy: 'p' } }).verdict).toBe('asks');
  });
});

describe('the GitHub Issues sheet (mockup screen 1b)', () => {
  it('recommends a fine-grained token and sends it as a Bearer token', async () => {
    render(<PmSourceSheet target={{ mode: 'new', system: 'github' }} existing={[]} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('pm-sheet-title')).toHaveTextContent('Add GitHub Issues');
    expect(screen.getByTestId('pm-token-advice')).toHaveTextContent('Use a fine-grained token limited to the repositories you’ll link, with Issues: read');
    const secret = screen.getByTestId('pm-secret') as HTMLInputElement;
    secret.value = 'fixture-pat-not-a-secret';
    fireEvent.input(secret);
    fireEvent.click(screen.getByTestId('pm-test-run'));
    await screen.findByTestId('pm-test-lines');
    expect(calls.find((c) => c.path === '/mcp/servers/preview')!.body).toMatchObject({ kind: 'mcp-http', url: 'https://api.githubcopilot.com/mcp/', auth: { prefix: 'Bearer ' }, pm: { system: 'github' }, secret: 'fixture-pat-not-a-secret' });
    expect(reachLines('github', reachOf([{ tenant: 'github.com', key: 'acme/a', label: 'a', links: [] }, { tenant: 'github.com', key: 'acme/b', label: 'b', links: [] }], null))).toEqual(['This token reaches 2 repositories on github.com.']);
  });
});

describe('the Data sources page', () => {
  it('NC1: a crew without tracker links offers no Jira or GitHub kind and no PM list', async () => {
    useCapabilities.setState({ trackerLinks: false });
    servers = [jiraServer()];
    render(<SourcesPage navigate={vi.fn()} search="" />);
    await waitFor(() => expect(calls.some((c) => c.path === '/mcp/servers')).toBe(true));
    fireEvent.click(await screen.findByTestId('sources-add'));
    await screen.findByTestId('source-kinds');
    expect(screen.queryByTestId('source-kinds-pm')).toBeNull();
    expect(screen.queryByTestId('pm-sources')).toBeNull();
  });

  it('with them: the PM sources are listed apart from app data, and Jira opens its own sheet', async () => {
    servers = [jiraServer({ trackers: [{ id: 'tl_1', trackerId: 'trk_1', source: 'jira', sourceId: 's', system: 'jira', tenant: 'cloud-1', key: 'BILL', label: 'Billing', target: { kind: 'project', id: 'proj_billing' }, linkedAt: 'x', linkedBy: 'op', projection: 'current' }] }), pgServer({ name: 'support-pg' })];
    const navigate = vi.fn();
    render(<SourcesPage navigate={navigate} search="" />);
    const row = await screen.findByTestId('pm-source');
    expect(row).toHaveTextContent('jira');
    expect(row).toHaveTextContent('Jira · 1 tracker linked · agents see its structure');
    fireEvent.click(screen.getByTestId('sources-add'));
    fireEvent.click(await screen.findByTestId('source-kind-jira'));
    expect(await screen.findByTestId('pm-sheet')).toHaveAttribute('data-system', 'jira');
    expect(screen.queryByTestId('source-sheet')).toBeNull();
  });

  it('the page hands crew’s ghCli to the GitHub sheet it opens, and an older crew’s silence keeps the token field', async () => {
    cliAnswer = { available: true, accounts: ['octo-a'], active: 'octo-a' };
    render(<SourcesPage navigate={vi.fn()} search="" />);
    await waitFor(() => expect(calls.some((c) => c.path === '/mcp/servers')).toBe(true));
    fireEvent.click(await screen.findByTestId('sources-add'));
    fireEvent.click(await screen.findByTestId('source-kind-github'));
    expect(await screen.findByTestId('pm-auth-gh')).toBeChecked();
    expect(screen.getByTestId('pm-gh-account')).toHaveValue('octo-a');
    cleanup();
    cliAnswer = undefined;
    render(<SourcesPage navigate={vi.fn()} search="" />);
    fireEvent.click(await screen.findByTestId('sources-add'));
    fireEvent.click(await screen.findByTestId('source-kind-github'));
    expect(await screen.findByTestId('pm-secret')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-auth-gh')).toBeNull();
  });

  it('a PM marker this studio can’t read is never offered as app data, and is said', async () => {
    servers = [{ ...jiraServer({ name: 'odd-pm' }), pm: { system: 'notion' } }, pgServer({ name: 'support-pg' })];
    render(<SourcesPage navigate={vi.fn()} search="" />);
    expect(await screen.findByTestId('pm-source-unreadable')).toHaveTextContent('odd-pm: a project-management tool this studio can’t read.');
    expect(screen.queryByRole('button', { name: /odd-pm/ })).toBeNull();
  });

  it('one sheet at a time: going back from a PM source to a data source closes the PM sheet', async () => {
    servers = [jiraServer(), pgServer({ name: 'support-pg' })];
    const view = render(<SourcesPage navigate={vi.fn()} search="?source=jira" />);
    await screen.findByTestId('pm-sheet');
    view.rerender(<SourcesPage navigate={vi.fn()} search="?source=support-pg" />);
    await screen.findByTestId('source-sheet');
    expect(screen.queryByTestId('pm-sheet')).toBeNull();
  });

  it('a null PM marker, or a PM record without its links list, is never app data nor "0 linked"', async () => {
    servers = [{ ...jiraServer({ name: 'null-pm' }), pm: null }, jiraServer({ name: 'no-links', trackers: undefined }), pgServer({ name: 'support-pg' })];
    render(<SourcesPage navigate={vi.fn()} search="" />);
    expect(await screen.findByTestId('pm-source-unreadable')).toHaveTextContent('null-pm');
    expect(screen.getByTestId('pm-source')).toHaveTextContent('no-links');
    expect(screen.getByTestId('pm-source')).toHaveTextContent('its links can’t be read');
    expect(screen.queryByRole('button', { name: /null-pm/ })).toBeNull();
  });

  it('a deep link to a PM record this studio can’t read says so (not "no source named")', async () => {
    servers = [{ ...jiraServer({ name: 'odd-pm' }), pm: { system: 'notion' } }];
    render(<SourcesPage navigate={vi.fn()} search="?source=odd-pm" />);
    await screen.findByTestId('pm-source-unreadable');
    expect(await screen.findByText('odd-pm is a project-management tool this studio can’t read: update studio.')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-sheet')).toBeNull();
  });
});

describe('review r2 folds: crew answers studio can’t read whole', () => {
  it('a partial preview (no tools) is said, never held or saved, and nothing crashes', async () => {
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? 'GET', body: undefined });
      if (path === '/mcp/servers/preview') return Promise.resolve({ previewHash: 'ph-x', serverInfo: null });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(<PmSourceSheet target={{ mode: 'new', system: 'github' }} existing={[]} onSaved={vi.fn()} onClose={vi.fn()} />);
    const secret = screen.getByTestId('pm-secret') as HTMLInputElement;
    secret.value = 'fixture-pat-not-a-secret';
    fireEvent.input(secret);
    fireEvent.click(screen.getByTestId('pm-test-run'));
    expect(await screen.findByTestId('pm-sheet-error')).toHaveTextContent('crew answered the test in a form this studio can’t read');
    expect(screen.getByTestId('pm-save')).toBeDisabled();
    expect(screen.queryByTestId('pm-test-lines')).toBeNull();
  });

  it('a hostile tool name finds no inherited note, and an unknown class claims nothing', () => {
    expect(toolReview({ name: '__proto__', class: 'read', binding: null }).note).toBe('crew can’t limit it to the trackers you link, so no agent gets it.');
    expect(toolReview({ name: 'constructor', class: 'read', binding: { policy: 'p' } }).note).toBe('Bound to the trackers you link: crew names the site and project, and drops anything else from an answer.');
    expect(toolReview({ name: 'x', class: 'admin', binding: { policy: 'p', inForce: true } }, true).verdict).toBe('unknown');
  });
});

describe('the real Atlassian v2 server (pm-real-jira)', () => {
  const V2_TOOLS: Array<[string, string, boolean]> = [
    ['getAccessibleAtlassianResources', 'read', true], ['atlassianUserInfo', 'read', true], ['getConfluenceContent', 'read', false], ['createConfluenceContent', 'write', false],
    ['searchConfluence', 'read', false], ['getJiraIssue', 'read', true], ['listJiraIssueComments', 'read', true], ['searchJiraIssuesUsingJql', 'read', true],
    ['createJiraIssue', 'write', false], ['editJiraIssue', 'write', false], ['transitionJiraIssue', 'write', false], ['addOrEditJiraIssueComment', 'write', false],
    ['getLoomObjectsContent', 'read', false], ['getGraphContext', 'read', false], ['getGraphObject', 'read', false], ['addGraphContext', 'write', false],
    ['getCollaborators', 'read', false], ['getPeopleInfo', 'read', false], ['getWorkActivity', 'read', false], ['getWorkPortfolio', 'read', false],
    ['discover', 'read', false], ['executeRead', 'read', false], ['executeWrite', 'write', false], ['executeDestructive', 'destructive', false], ['search', 'read', false],
  ];
  it('groups its 25 tools by why, each group with one line, instead of one long "Not for agents" list', () => {
    const reviews = toolReviewsOf(V2_TOOLS.map(([name, cls, bound]) => ({ name, class: cls, binding: bound ? { policy: `jira/${name}@1`, inForce: true } : null })), true)!;
    const groups = toolGroupsOf('jira', reviews);
    expect(groups.map((g) => [g.key, g.tools.map((t) => t.name)])).toEqual([
      ['agents', ['getAccessibleAtlassianResources', 'atlassianUserInfo', 'getJiraIssue', 'listJiraIssueComments', 'searchJiraIssuesUsingJql']],
      ['writes', ['createJiraIssue', 'editJiraIssue', 'transitionJiraIssue', 'addOrEditJiraIssueComment']],
      ['unscoped', ['discover', 'executeRead', 'executeWrite', 'executeDestructive', 'search']],
      ['confluence', ['getConfluenceContent', 'createConfluenceContent', 'searchConfluence']],
      ['graph', ['getLoomObjectsContent', 'getGraphContext', 'getGraphObject', 'addGraphContext', 'getCollaborators', 'getPeopleInfo', 'getWorkActivity', 'getWorkPortfolio']],
    ]);
    expect(groups.find((g) => g.key === 'writes')!.reason).toBe('You confirm each one at delivery: an agent never sends one itself.');
    expect(groups.find((g) => g.key === 'confluence')!.reason).toBe('Not part of trackers (Confluence).');
    expect(groups.find((g) => g.key === 'agents')!.tools.filter((t) => t.kind === 'account').map((t) => t.name)).toEqual(['getAccessibleAtlassianResources', 'atlassianUserInfo']);
  });
  it('a saved source whose test fails shows crew’s own message and code, and says the source is saved', async () => {
    const said = 'jira (getAccessibleAtlassianResources) answered an error (HTTP 403): it says the token needs the scopes read:me, read:account; its other words are not shown';
    apiFetch.mockImplementation((path: string) => {
      if (path === '/sources/jira/trackers') return Promise.reject(new ApiError(503, said, { error: said, code: 'source_unavailable', cause: 'vendor_error' }));
      if (path === '/projects?status=active') return Promise.resolve({ projects: [] });
      if (path === '/sources/jira/agent-queries') return Promise.resolve({ name: 'jira', known: true, queries: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(<PmSourceSheet target={{ mode: 'saved', server: jiraServer() as never }} existing={['jira']} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('pm-test-reach'));
    const box = await screen.findByTestId('pm-test-reach-error');
    expect(screen.getByTestId('pm-test-fail')).toHaveTextContent('Test failed');
    expect(screen.queryByText('Not connected')).toBeNull();
    expect(within(box).getByTestId('pm-test-saved')).toHaveTextContent('The source is saved. This test, which reads what the token reaches, failed');
    expect(within(box).getByTestId('pm-test-crew-said')).toHaveTextContent(`crew said: “${said}”`);
    expect(within(box).getByTestId('pm-test-crew-code')).toHaveTextContent('source_unavailable: vendor_error');
    expect(box).not.toHaveTextContent('couldn’t be reached just now');
  });
  it('crew’s words are taken only from a refusal body; a code that is not a code word is not shown', () => {
    expect(reachFailureOf(new Error('x'))).toBeNull();
    expect(reachFailureOf(new ApiError(503, 'w', undefined))).toBeNull();
    expect(reachFailureOf(new ApiError(503, 'w', { error: 'said', code: 'Bad Code <b>', cause: 'unknown_shape' }))).toEqual({ said: 'said', code: null, cause: 'unknown_shape' });
    // A cause without a code is still shown; the same word once.
    expect(codeWords({ code: null, cause: 'unknown_shape' })).toBe('unknown_shape');
    expect(codeWords({ code: 'source_unavailable', cause: 'source_unavailable' })).toBe('source_unavailable');
    // A long sentence says it was cut.
    expect(reachFailureOf(new ApiError(503, 'w', { error: 'x'.repeat(1_300) }))!.said).toMatch(/… \(cut at 1200 characters\)$/);
  });
  it('says no more about the saved source than crew’s answer supports', () => {
    expect(savedWords({ code: 'source_not_found', cause: null })).toBe('crew no longer has this source: it was removed since this page was read.');
    expect(savedWords({ code: 'source_unavailable', cause: 'secret_missing' })).toContain('can’t read its token');
    expect(savedWords(null)).not.toContain('token.');
  });
  it('crew’s review state outranks a name: a changed or unreadable review is "Check again", not "not part of trackers"', () => {
    const reviews = toolReviewsOf([
      { name: 'getGraphContext', class: 'read', binding: { policy: 'p', inForce: false } },
      { name: 'getConfluenceContent', class: 'admin', binding: null },
    ], true)!;
    expect(toolGroupsOf('jira', reviews).map((g) => [g.key, g.tools.map((t) => t.name)])).toEqual([['again', ['getGraphContext', 'getConfluenceContent']]]);
  });
  it('a GitHub code write is never offered a grant; a kept grant on a write outside the tracker stays visible', async () => {
    const gh = toolReviewsOf([{ name: 'push_files', class: 'write', binding: null }, { name: 'add_issue_comment', class: 'write', binding: null }], false)!;
    expect(toolGroupsOf('github', gh).map((g) => [g.key, g.tools.map((t) => t.name)])).toEqual([['writes', ['add_issue_comment']], ['code', ['push_files']]]);
    const server = jiraServer({ tools: [
      { name: 'createConfluenceContent', class: 'write', derivedClass: 'write', enabled: true, status: 'registered', schemaHash: 'h', observedSchemaHash: 'h', binding: null, subject: 'c', description: null, annotations: null, inputSchema: null, classOverride: null },
      { name: 'getJiraIssue', class: 'read', derivedClass: 'read', enabled: true, status: 'registered', schemaHash: 'h', observedSchemaHash: 'h', binding: { policy: 'jira/getJiraIssue@1', schemaHash: 'h', inForce: true }, subject: 'g', description: null, annotations: null, inputSchema: null, classOverride: null },
    ] });
    render(<PmSourceSheet target={{ mode: 'saved', server: server as never }} existing={['jira']} onSaved={vi.fn()} onClose={vi.fn()} />);
    const chip = screen.getAllByTestId('pm-tool-chip').find((c) => c.dataset.tool === 'createConfluenceContent')!;
    expect(within(chip).getByTestId('pm-tool-chip-granted')).toHaveTextContent('granted');
    expect(screen.queryAllByTestId('pm-tool-grant')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /Not part of trackers \(Confluence\)/ })).toBeInTheDocument();
  });
});

describe('the GitHub CLI login option', () => {
  const cliState = (over: Record<string, unknown> = {}) => ({ available: true, accounts: ['octo-a', 'octo-b'], active: 'octo-b', ...over });
  const open = (ghCli?: unknown, onReread = vi.fn()) => render(<PmSourceSheet target={{ mode: 'new', system: 'github' }} existing={[]} ghCli={ghCli as never} onReread={onReread} onSaved={vi.fn()} onClose={vi.fn()} />);
  const previews = () => calls.filter((c) => c.path === '/mcp/servers/preview');

  it('signed in: the option is preselected with the account picker on the active account, and no token field', () => {
    const onReread = vi.fn();
    open(cliState(), onReread);
    expect(screen.getByTestId('pm-auth-gh')).toBeChecked();
    expect(screen.getByTestId('pm-gh-account')).toHaveValue('octo-b');
    expect(within(screen.getByTestId('pm-gh-account')).getAllByRole('option').map((o) => o.textContent)).toEqual(['octo-a', 'octo-b']);
    expect(screen.queryByTestId('pm-secret')).toBeNull();
    expect(screen.getByTestId('pm-test-run')).toBeEnabled();
    // The sheet reads crew again as it opens, so a login done after the page loaded is seen.
    expect(onReread).toHaveBeenCalledTimes(1);
  });

  it('no active account: the first is chosen', () => {
    open(cliState({ active: null }));
    expect(screen.getByTestId('pm-gh-account')).toHaveValue('octo-a');
  });

  it.each([
    ['missing', { available: false, accounts: [], active: null }, 'isn’t installed'],
    ['signedOut', { available: true, accounts: [], active: null }, 'signed out'],
  ])('CLI %s: says so in plain words and offers the token field', (state, ghCli, words) => {
    open(ghCli);
    expect(screen.getByTestId('pm-gh-state')).toHaveAttribute('data-state', state);
    expect(screen.getByTestId('pm-gh-state')).toHaveTextContent(words);
    expect(screen.getByTestId('pm-secret')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-auth-gh')).toBeNull();
  });

  it('an older crew (no ghCli): the token flow as ever', () => {
    open(undefined);
    expect(screen.getByTestId('pm-secret')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-gh-state')).toBeNull();
    expect(screen.queryByTestId('pm-auth-mode')).toBeNull();
  });

  it('Test then Save with the option: the preview names the login with the same header and prefix, and no secret rides anywhere', async () => {
    open(cliState());
    fireEvent.change(screen.getByTestId('pm-gh-account'), { target: { value: 'octo-a' } });
    fireEvent.click(screen.getByTestId('pm-test-run'));
    await screen.findByTestId('pm-test-lines');
    const body = previews()[0]!.body as Record<string, unknown>;
    expect(body['auth']).toEqual({ ref: 'gh-cli:octo-a', header: 'Authorization', prefix: 'Bearer ' });
    expect(Object.hasOwn(body, 'secret')).toBe(false);
    fireEvent.click(screen.getByTestId('pm-save'));
    await waitFor(() => expect(calls.some((c) => c.path === '/mcp/servers' && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.path === '/mcp/servers' && c.method === 'POST')!.body).toEqual({ previewHash: 'ph-1' });
  });

  it('changing the account drops a held preview, and a late older preview does not bring Save back', async () => {
    let release: (v: unknown) => void = () => undefined;
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/mcp/servers/preview' && previews().length === 0) { calls.push({ path, method: 'POST', body: JSON.parse(init!.body as string) }); return new Promise((r) => { release = r; }); }
      return base(path, init);
    });
    open(cliState());
    fireEvent.click(screen.getByTestId('pm-test-run'));
    await waitFor(() => expect(previews()).toHaveLength(1));
    fireEvent.change(screen.getByTestId('pm-gh-account'), { target: { value: 'octo-a' } });
    release({ previewHash: 'old', tools: jiraTools });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('pm-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('pm-test-run'));
    await screen.findByTestId('pm-test-lines');
    expect(screen.getByTestId('pm-save')).toBeEnabled();
    expect((previews()[1]!.body as { auth: { ref: string } }).auth.ref).toBe('gh-cli:octo-a');
  });

  it('switching to a typed token requires one; switching back never carries it', async () => {
    open(cliState());
    fireEvent.click(screen.getByTestId('pm-auth-token'));
    expect(screen.getByTestId('pm-test-run')).toBeDisabled();
    const secret = screen.getByTestId('pm-secret') as HTMLInputElement;
    secret.value = TOKEN;
    fireEvent.input(secret);
    fireEvent.click(screen.getByTestId('pm-auth-gh'));
    expect(screen.queryByTestId('pm-secret')).toBeNull();
    fireEvent.click(screen.getByTestId('pm-test-run'));
    await screen.findByTestId('pm-test-lines');
    expect(JSON.stringify(previews()[0]!.body)).not.toContain(TOKEN);
    expect((previews()[0]!.body as { auth: { ref: string } }).auth.ref).toBe('gh-cli:octo-b');
    fireEvent.click(screen.getByTestId('pm-auth-token'));
    expect((screen.getByTestId('pm-secret') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('pm-test-run')).toBeDisabled();
  });

  it('an account that vanishes from crew’s latest word falls back to the default and drops the held preview', async () => {
    const { rerender } = open(cliState());
    fireEvent.click(screen.getByTestId('pm-test-run'));
    await screen.findByTestId('pm-test-lines');
    rerender(<PmSourceSheet target={{ mode: 'new', system: 'github' }} existing={[]} ghCli={cliState({ accounts: ['octo-a'], active: 'octo-a' })} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('pm-gh-account')).toHaveValue('octo-a');
    expect(screen.getByTestId('pm-save')).toBeDisabled();
  });

  it.each([
    [409, 'gh_account_mismatch', 'isn’t the one the GitHub CLI is signed in as'],
    [409, 'gh_not_installed', 'isn’t installed'],
    [409, 'gh_signed_out', 'is signed out'],
    [409, 'gh_token_unavailable', 'couldn’t supply a login'],
    [400, 'gh_cli_not_allowed', 'can’t use the GitHub CLI login'],
  ])('a %i %s refusal at the preview is shown in translateWireError’s words', async (status, code, words) => {
    const base = apiFetch.getMockImplementation()!;
    const wire = `crew says ${code}`;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => (path === '/mcp/servers/preview' ? Promise.reject(new ApiError(status, wire, { error: wire, code })) : base(path, init)));
    const onReread = vi.fn();
    open(cliState(), onReread);
    onReread.mockClear();
    fireEvent.click(screen.getByTestId('pm-test-run'));
    const err = await screen.findByTestId('pm-sheet-error');
    expect(err).toHaveTextContent(words);
    expect(err).toHaveTextContent('Nothing was saved.');
    // The refusals about crew's CLI state send the page to read it again; "not allowed" does not.
    expect(onReread).toHaveBeenCalledTimes(code === 'gh_cli_not_allowed' ? 0 : 1);
  });

  it('a refusal at Save drops the held preview and says so', async () => {
    open(cliState());
    fireEvent.click(screen.getByTestId('pm-test-run'));
    await screen.findByTestId('pm-test-lines');
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => (path === '/mcp/servers' && init?.method === 'POST'
      ? Promise.reject(new ApiError(409, 'signed out', { error: 'signed out', code: 'gh_signed_out' })) : base(path, init)));
    fireEvent.click(screen.getByTestId('pm-save'));
    expect(await screen.findByTestId('pm-sheet-error')).toHaveTextContent('is signed out');
    expect(screen.getByTestId('pm-save')).toBeDisabled();
  });

  it('the Test caption names the login in CLI mode and the token in token mode', () => {
    open(cliState());
    expect(screen.getByText('Test connects to the server with the GitHub CLI login and lists its tools. It reads no issues.')).toBeInTheDocument();
    expect(screen.queryByText(/with your token/)).toBeNull();
    fireEvent.click(screen.getByTestId('pm-auth-token'));
    const secret = screen.getByTestId('pm-secret') as HTMLInputElement;
    secret.value = TOKEN;
    fireEvent.input(secret);
    expect(screen.getByText('Test connects to the server with your token and lists its tools. It reads no issues.')).toBeInTheDocument();
    expect(screen.queryByText(/GitHub CLI login and lists/)).toBeNull();
  });

  it('a saved CLI-login source offers no Replace token and says the login is read from the CLI', () => {
    const server = jiraServer({ name: 'github', pm: { system: 'github' }, url: 'https://api.githubcopilot.com/mcp/', auth: { ref: 'gh-cli:octo-a', header: 'Authorization', prefix: 'Bearer ' } });
    render(<PmSourceSheet target={{ mode: 'saved', server: server as never }} existing={[]} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('pm-auth-saved')).toHaveTextContent('octo-a');
    expect(screen.queryByTestId('pm-secret')).toBeNull();
    expect(screen.queryByText('Replace token')).toBeNull();
  });

  it('savedWords names the GitHub CLI, not a token, for such a source', () => {
    expect(savedWords({ code: null, cause: 'secret_missing' }, 'gh')).toContain('GitHub CLI');
  });
});
