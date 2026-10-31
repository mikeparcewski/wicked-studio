import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeDaemon, type FakeDaemon } from './learnFakeDaemon.js';

/**
 * program DES-LEARN, rendered: Learn's tabs, the personality (preview + save + the project override),
 * the starter rules, Style's review (keep = approve / keepRules, untick = reject), the first run's asks
 * filling "Your setup", and Memory's new ways in. A fake crew answers `fetch`; every assertion is on what
 * was SENT or what the page shows.
 */

const { LearnHub } = await import('../src/components/learn/LearnHub.js');
const { FirstRun } = await import('../src/components/desk/FirstRun.js');
const { MemoryCaptureAdd, MemoryRetired, MemoryTable } = await import('../src/components/memory/MemoryAdd.js');
const { resetFirstRun, useFirstRun } = await import('../src/store/firstRun.js');
const { useProjectsStore } = await import('../src/store/projects.js');

let d: FakeDaemon;
const settings: Record<string, unknown> = {};

beforeEach(() => {
  resetFirstRun();
  for (const k of Object.keys(settings)) delete settings[k];
  d = fakeDaemon();
  d.on('GET /settings', () => ({ settings }));
  d.on('PUT /settings', (b) => { Object.assign(settings, b as object); return { settings }; });
  d.on('GET /projects', { projects: [{ id: 'default', name: 'Unfiled' }, { id: 'pay', name: 'Payments' }] });
  d.on('GET /repos', { repos: [{ id: 'r1', name: 'web-store', root_path: '/x/web-store', default_branch: 'main', registered_at: 0 }] });
  d.on('GET /setup/known', { git: { name: 'Sam Rivera', email: 'sam@acme.dev' }, languages: [{ name: 'TypeScript', files: 62, share: 0.62 }, { name: 'Go', files: 38, share: 0.38 }], filesCounted: 100, nearby: [{ name: 'handbook', path: '/x/handbook' }] });
  useProjectsStore.setState({ projects: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const nav = vi.fn();

describe('Learn: tabs and the personality', () => {
  it('opens on Style; the tabs are Style, Rules, Personality, Brand', async () => {
    d.on('GET /governance/rules', { rules: [] });
    render(<LearnHub navigate={nav} search="" />);
    expect(screen.getAllByTestId('learn-tab').map((t) => t.textContent)).toEqual(['Style', 'Rules', 'Personality', 'Brand']);
    expect(screen.getByTestId('learn-panel-style')).toBeTruthy();
    fireEvent.click(screen.getAllByTestId('learn-tab')[2]!);
    expect(nav).toHaveBeenLastCalledWith('/learn?tab=personality');
  });

  it('the preview re-answers as a dial moves, and Save sends the person’s personality and marks Learn used', async () => {
    d.on('GET /persona', { user: null, projects: {}, voice: { user: null, projects: {} } });
    d.on('PUT /persona', (b) => ({ scope: 'user', persona: { ...(b as { persona: object }).persona, version: 1, updatedAt: 1 }, voice: '## Voice' }));
    await useFirstRun.getState().load();
    render(<LearnHub navigate={nav} search="?tab=personality" />);
    const answer = await screen.findByTestId('persona-answer');
    expect(answer.textContent).toContain('rather fix the bound');
    fireEvent.change(screen.getByTestId('persona-dial-pushback'), { target: { value: '0' } });
    expect(screen.getByTestId('persona-answer').textContent).not.toContain('rather fix the bound');
    fireEvent.change(screen.getByTestId('persona-name'), { target: { value: 'Robin' } });
    expect(screen.getByTestId('persona-preview-name').textContent).toBe('Robin');
    fireEvent.click(screen.getByTestId('persona-save'));
    await waitFor(() => expect(d.sent('PUT /persona')).toHaveLength(1));
    expect(d.sent('PUT /persona')[0]).toMatchObject({ scope: 'user', persona: { name: 'Robin', dials: { pushback: 0 } } });
    await waitFor(() => expect(typeof useFirstRun.getState().state.learnUsedAt).toBe('number'));
    expect((settings['studio.firstRun'] as { learnUsedAt?: number }).learnUsedAt).toBeTypeOf('number');
  });

  it('a project scope saves an override, and says it starts as a copy of yours', async () => {
    d.on('GET /persona', { user: { name: 'Wren', colour: '#6366f1', dials: { length: 1, warmth: 0, pushback: 2, initiative: 1 }, habits: [], version: 2, updatedAt: 1 }, projects: {}, voice: { user: '## Voice', projects: {} } });
    d.on('PUT /persona', (b) => ({ scope: 'project:pay', persona: { ...(b as { persona: object }).persona, version: 1, updatedAt: 1 }, voice: '' }));
    render(<LearnHub navigate={nav} search="?tab=personality&project=pay" />);
    expect((await screen.findByTestId('persona-scope-note')).textContent).toBe('Starts as a copy of yours.');
    expect((screen.getByTestId('persona-name') as HTMLInputElement).value).toBe('Wren');
    fireEvent.click(screen.getByTestId('persona-save'));
    await waitFor(() => expect(d.sent('PUT /persona')[0]).toMatchObject({ scope: 'project:pay', persona: { name: 'Wren' } }));
  });

  it('an older crew without the routes says so', async () => {
    render(<LearnHub navigate={nav} search="?tab=personality" />);
    expect(await screen.findByTestId('persona-unsupported')).toBeTruthy();
  });
});

describe('Learn: rules', () => {
  it('picking a starter puts a real rule in force; unpicking retires it', async () => {
    let rules: unknown[] = [];
    d.on('GET /governance/rules', () => ({ rules }));
    d.on('POST /governance/rules', (b) => { rules = [...rules, b]; return { status: 'ok' }; });
    d.on('DELETE /governance/rules/learn-small-prs', () => { rules = []; return { status: 'retired', id: 'learn-small-prs' }; });
    render(<LearnHub navigate={nav} search="?tab=rules" />);
    const tile = (await screen.findAllByTestId('learn-starter')).find((t) => t.getAttribute('data-starter') === 'learn-small-prs')!;
    expect(tile.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(tile);
    await waitFor(() => expect(d.sent('POST /governance/rules')[0]).toMatchObject({ id: 'learn-small-prs', provenance: { source: 'ui', ref: 'learn:starter' } }));
    await waitFor(() => expect(screen.getAllByTestId('learn-rule')).toHaveLength(1));
    fireEvent.click(screen.getAllByTestId('learn-starter').find((t) => t.getAttribute('data-starter') === 'learn-small-prs')!);
    await waitFor(() => expect(d.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('Learn: Style review', () => {
  it('kept memories are approved and unticked rejected; kept drafted rules land through keepRules', async () => {
    settings['studio.learn.style'] = { jobs: [{ runId: 'rd', kind: 'rules', sources: ['CONTRIBUTING.md'] }, { runId: 'rr', kind: 'repo', sources: ['web-store'] }], startedAt: 1 };
    d.on('GET /governance/rules', { rules: [] });
    d.on('GET /runs/rd', { run: { session: { id: 'rd', status: 'awaiting_human', unit_ix: 2 }, units: [{ id: 'rd:analyze', ord: 1 }, { id: 'rd:propose', ord: 2 }] } });
    d.on('GET /runs/rr', { run: { session: { id: 'rr', status: 'completed', unit_ix: 3 }, units: [{}, {}, {}] } });
    d.on('GET /proposals', { proposals: [
      { id: 'm1', kind_type: 'memory', payload: { content: 'Tests sit beside the code.' }, facets: {}, provenance: { run_id: 'rr' }, state: 'pending', created_at: 1 },
      { id: 'm2', kind_type: 'memory', payload: { content: 'Commits are imperative.' }, facets: {}, provenance: { run_id: 'rr' }, state: 'pending', created_at: 1 },
      { id: 'x9', kind_type: 'memory', payload: { content: 'Someone else’s.' }, facets: {}, provenance: { run_id: 'other' }, state: 'pending', created_at: 1 },
    ] });
    d.on('GET /governance/steering/author/rd/draft', { runId: 'rd', ready: true, rules: [
      { id: 'POL-0001', statement: 'Every PR links an issue.', severity: 'error', steering_type: 'development', rule_type: 'policy', confidence: 0.9, targets: {}, provenance: { source: 'chat', source_kinds: [] } },
      { id: 'POL-0002', statement: 'Branches are type/slug.', severity: 'warn', steering_type: 'development', rule_type: 'policy', confidence: 0.9, targets: {}, provenance: { source: 'chat', source_kinds: [] } },
    ] });
    d.on('POST /proposals/m1/approve', { outcome: 'promoted', active_id: 'a1' });
    d.on('POST /proposals/m2/reject', { ok: true });
    d.on('POST /runs/rd/gate', { status: 'completed', landing: { outcome: 'landed', ruleIds: ['POL-0002'], declinedIds: ['POL-0001'] } });
    await useFirstRun.getState().load();
    render(<LearnHub navigate={nav} search="" />);
    const mem = await screen.findByTestId('style-memories');
    expect(within(mem).getAllByTestId('ask-option').map((o) => o.textContent)).toEqual([expect.stringContaining('Tests sit beside'), expect.stringContaining('Commits are imperative')]);
    fireEvent.click(within(mem).getAllByTestId('ask-option')[1]!);
    fireEvent.click(within(mem).getByTestId('ask-confirm'));
    await waitFor(() => expect(screen.getByTestId('style-memories-record').textContent).toBe('You kept 1 of 2 memories · saved to Memory'));
    expect(d.calls.some((c) => c.path === '/proposals/m1/approve')).toBe(true);
    expect(d.calls.some((c) => c.path === '/proposals/m2/reject')).toBe(true);
    const rulesAsk = screen.getByTestId('style-rules');
    fireEvent.click(within(rulesAsk).getAllByTestId('ask-option')[0]!);
    fireEvent.click(within(rulesAsk).getByTestId('ask-confirm'));
    await waitFor(() => expect(d.sent('POST /runs/rd/gate')[0]).toEqual({ approve: true, keepRules: ['POL-0002'] }));
    await waitFor(() => expect(screen.getByTestId('style-rules-record').textContent).toBe('You adopted 1 of 2 rules · now in Steering'));
    expect(screen.getAllByTestId('style-station').map((s) => s.getAttribute('data-s'))).toEqual(['done', 'done', 'done', 'done']);
    await waitFor(() => expect(typeof useFirstRun.getState().state.learnUsedAt).toBe('number'));
  });

  it('a source list launches one job per kind: team docs to steering-author, a repo to capture-learnings', async () => {
    d.on('GET /governance/rules', { rules: [] });
    d.on('POST /governance/steering/author', { runId: 'rd' });
    d.on('POST /runs', { runId: 'rr' });
    d.on('GET /runs/rd', { run: { session: { id: 'rd', status: 'executing', unit_ix: 0 }, units: [{}, {}] } });
    d.on('GET /runs/rr', { run: { session: { id: 'rr', status: 'executing', unit_ix: 0 }, units: [{}, {}, {}] } });
    d.on('GET /proposals', { proposals: [] });
    d.on('GET /governance/steering/author/rd/draft', { runId: 'rd', ready: false, rules: [] });
    render(<LearnHub navigate={nav} search="" />);
    fireEvent.change(await screen.findByTestId('style-input'), { target: { value: 'https://wiki.example.com/handbook' } });
    fireEvent.click(screen.getByTestId('style-add'));
    fireEvent.change(screen.getByTestId('style-kind'), { target: { value: 'repo' } });
    await waitFor(() => expect(screen.getByTestId('style-repo')).toBeTruthy());
    fireEvent.change(screen.getByTestId('style-repo'), { target: { value: 'r1' } });
    fireEvent.click(screen.getByTestId('style-add'));
    expect(screen.getAllByTestId('style-source')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('style-go'));
    await waitFor(() => expect(d.sent('POST /runs')).toHaveLength(1));
    expect(d.sent('POST /governance/steering/author')[0]).toMatchObject({ instructions: expect.stringContaining('Also read: https://wiki.example.com/handbook') });
    expect(d.sent('POST /runs')[0]).toMatchObject({ workflow: 'capture-learnings', repoRef: 'r1', problem: expect.stringContaining('style lens') });
    await waitFor(() => expect(screen.getByTestId('style-runline').textContent).toContain('Running as 2 jobs'));
    expect((settings['studio.learn.style'] as { jobs: unknown[] }).jobs).toHaveLength(2);
  });
});

describe('First run (§4)', () => {
  const agent = (over: object) => ({ key: 'claude', name: 'Claude Code', usable: true, optIn: false, issues: [], login: null, ...over });
  const agents = [agent({}), agent({ key: 'codex', name: 'Codex', usable: false, issues: [{ code: 'signed_out', severity: 'block' }], login: 'codex login' })] as never;

  it('shows what is known from real reads, then asks one thing at a time, each answer filling Your setup', async () => {
    d.on('POST /repos', { repo: { id: 'r2' }, onboardRunId: 'o1' });
    render(<FirstRun navigate={nav} agents={agents} hasRoster />);
    expect((await screen.findByTestId('known-git')).textContent).toContain('Sam Rivera');
    await waitFor(() => expect(screen.getByTestId('known-repos').textContent).toContain('1 repository · 1 nearby'));
    expect(screen.getByTestId('known-agents').textContent).toContain('2 agents found');
    expect(screen.getByTestId('known-agents').textContent).toContain('Codex not signed in');
    expect(screen.getByTestId('known-languages').textContent).toContain('TypeScript, Go');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome, Sam');
    const ask = await screen.findByTestId('first-run-ask-repos');
    fireEvent.click(within(ask).getAllByTestId('ask-option')[1]!);
    fireEvent.click(within(ask).getByTestId('ask-confirm'));
    await waitFor(() => expect(d.sent('POST /repos')[0]).toEqual({ name: 'handbook', rootPath: '/x/handbook' }));
    await waitFor(() => expect(screen.getByTestId('first-run-record-repos').textContent).toBe('You picked: web-store, handbook'));
    const row = screen.getAllByTestId('first-run-row').find((r) => r.getAttribute('data-k') === 'repos')!;
    expect(row.getAttribute('data-done')).toBe('true');
    const agentsAsk = await screen.findByTestId('first-run-ask-agents');
    expect(within(agentsAsk).getByTestId('ask-question').textContent).toBe('Sign Codex in now? Jobs need a second agent to check the work.');
    expect((settings['studio.firstRun'] as { answers: Record<string, unknown> }).answers['repos']).toBeTruthy();
  });

  it('picking a personality saves it as yours and moves Learn below Evaluate', async () => {
    settings['studio.firstRun'] = { answers: Object.fromEntries(['repos', 'agents', 'style', 'rules'].map((k) => [k, { line: k, words: k, done: true }])) };
    d.on('PUT /persona', (b) => ({ scope: 'user', persona: { ...(b as { persona: object }).persona, version: 1, updatedAt: 1 }, voice: '' }));
    render(<FirstRun navigate={nav} agents={agents} hasRoster />);
    const ask = await screen.findByTestId('first-run-ask-persona');
    fireEvent.click(within(ask).getAllByRole('radio')[1]!);
    fireEvent.click(within(ask).getByTestId('ask-confirm'));
    await waitFor(() => expect(d.sent('PUT /persona')[0]).toMatchObject({ scope: 'user', persona: { name: 'Wren' } }));
    expect((d.sent('PUT /persona')[0] as { persona: { dials: { warmth: number } } }).persona.dials.warmth).toBe(2);
    await waitFor(() => expect(typeof useFirstRun.getState().state.learnUsedAt).toBe('number'));
  });

  it('Ignore setup collapses to one line with Undo, and persists', async () => {
    render(<FirstRun navigate={nav} agents={agents} hasRoster />);
    fireEvent.click(await screen.findByTestId('first-run-ignore'));
    expect((await screen.findByTestId('first-run-hidden')).textContent).toContain('Setup hidden');
    await waitFor(() => expect((settings['studio.firstRun'] as { ignoredAt?: number }).ignoredAt).toBeTypeOf('number'));
    fireEvent.click(screen.getByTestId('first-run-undo'));
    await waitFor(() => expect((settings['studio.firstRun'] as { ignoredAt?: number }).ignoredAt).toBeUndefined());
    expect(await screen.findByTestId('first-run-flow')).toBeTruthy();
  });

  it('ignored before, it never returns', async () => {
    settings['studio.firstRun'] = { ignoredAt: 5 };
    const { container } = render(<FirstRun navigate={nav} agents={agents} hasRoster />);
    await waitFor(() => expect(useFirstRun.getState().read).toBe('ok'));
    expect(container.textContent).toBe('');
  });
});

describe('Memory: Steering’s ways in (§6.3)', () => {
  const projects = [{ id: 'default', name: 'Unfiled' }];

  it('Add with chat files a capture and ends in a pick-several of the memories it would keep', async () => {
    d.on('POST /projects/default/capture', { runId: 'c1' });
    d.on('GET /runs/c1', { run: { session: { id: 'c1', status: 'completed', unit_ix: 1 }, units: [{}] } });
    d.on('GET /proposals', { proposals: [
      { id: 'p1', kind_type: 'memory', payload: { content: 'Releases cut on Thursdays.' }, facets: {}, provenance: { run_id: 'c1' }, state: 'pending', created_at: 1 },
      { id: 'p2', kind_type: 'memory', payload: { content: 'Hotfixes skip the train.' }, facets: {}, provenance: { run_id: 'c1' }, state: 'pending', created_at: 1 },
    ] });
    d.on('POST /proposals/p1/approve', { outcome: 'promoted' });
    d.on('POST /proposals/p2/approve', { outcome: 'promoted' });
    const kept = vi.fn();
    render(<MemoryCaptureAdd mode="chat" project="default" projects={projects} onClose={() => undefined} onKept={kept} />);
    fireEvent.change(screen.getByTestId('memory-add-text'), { target: { value: 'We cut releases on Thursdays.' } });
    fireEvent.click(screen.getByTestId('memory-add-send'));
    await waitFor(() => expect(d.sent('POST /projects/default/capture')[0]).toMatchObject({ notes: expect.stringContaining('We cut releases on Thursdays.') }));
    const ask = await screen.findByTestId('memory-add-ask');
    expect(within(ask).getAllByTestId('ask-option')).toHaveLength(2);
    fireEvent.click(within(ask).getByTestId('ask-confirm'));
    await waitFor(() => expect(screen.getByTestId('memory-add-record').textContent).toBe('You kept 2 of 2 · in Memory now'));
    expect(kept).toHaveBeenCalled();
  });

  it('Edit as a table saves only the rows that changed', async () => {
    d.on('POST /memory/edit', (b) => ({ memory_id: 'new', retired: (b as { memory_id: string }).memory_id }));
    const memories = [{ id: 'a', content: 'One', tier: 'semantic', scope: '', facets: {} }, { id: 'b', content: 'Two', tier: 'semantic', scope: '', facets: {} }] as never;
    render(<MemoryTable memories={memories} onSaved={() => undefined} onClose={() => undefined} />);
    fireEvent.change(screen.getAllByTestId('memory-table-text')[1]!, { target: { value: 'Two, edited' } });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    await waitFor(() => expect(d.sent('POST /memory/edit')).toEqual([{ memory_id: 'b', content: 'Two, edited' }]));
    expect((await screen.findByTestId('memory-table-note')).textContent).toBe('Saved 1 change.');
  });

  it('Show retired says a retired memory is erased, and can bring back a suggestion you said no to', async () => {
    d.on('GET /proposals', { proposals: [{ id: 'q1', kind_type: 'memory', payload: { content: 'Old idea.' }, facets: {}, provenance: {}, state: 'rejected', created_at: 1 }] });
    d.on('POST /proposals', { id: 'n1' });
    d.on('POST /proposals/n1/approve', { outcome: 'promoted', active_id: 'm9' });
    render(<MemoryRetired onClose={() => undefined} onBrought={() => undefined} />);
    expect(screen.getByTestId('memory-retired-erased').textContent).toContain('erased');
    fireEvent.click(await screen.findByTestId('memory-retired-bring'));
    await waitFor(() => expect(d.sent('POST /proposals')[0]).toEqual({ content: 'Old idea.' }));
    expect(await screen.findByTestId('memory-retired-back')).toBeTruthy();
  });
});
