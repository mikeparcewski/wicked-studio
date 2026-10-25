import { describe, expect, it, vi } from 'vitest';
import type { RosterSeat, SessionView } from '../src/api/types.js';

/**
 * DES-SYSTEM-CHAT, the pure parts: the scope chips' wire mapping (§6), the CLI picker's default and
 * its disabled reasons (§5), and the page-aware prompts built from live data (§7).
 */

vi.mock('../src/api/client.js', () => ({ api: {}, apiFetch: vi.fn() }));

const { addChip, chipsOpenFields, chipsScoped, clickChip, defaultScopeChips, scopePackLines } = await import('../src/board/chatScopes.js');
const { cliOptions, defaultChatCli } = await import('../src/board/chatCli.js');
const { pageContext, pagePlaceholder, pagePrompts } = await import('../src/board/pagePrompts.js');

const run = (id: string, problem: string, status: string, extra: Record<string, unknown> = {}): SessionView =>
  ({ session: { id, problem, status, created_at: 1, repo_ref: null, ...extra }, units: [] }) as unknown as SessionView;

describe('scope chips → the existing scope wire', () => {
  const page = defaultScopeChips({ project: { id: 'p1', name: 'API' }, repo: { id: 'r1', name: 'billing' } });

  it('the page defaults: This page, Project and Repo on; Memory, Steering, Recent runs off', () => {
    expect(page.map((c) => [c.key, c.on])).toEqual([
      ['page', true], ['project:p1', true], ['repo:r1', true], ['memory', false], ['steering', false], ['runs', false],
    ]);
    expect(defaultScopeChips({ project: null, repo: null }).map((c) => c.key)).toEqual(['page', 'all-repos', 'memory', 'steering', 'runs']);
  });

  it('maps exactly the chips that are on', () => {
    expect(chipsOpenFields(page)).toEqual({ repoRefs: ['r1'], projectId: 'p1' });
    const noRepo = clickChip(page, 'repo:r1');
    expect(chipsOpenFields(noRepo)).toEqual({ projectId: 'p1' });
    const nothing = clickChip(noRepo, 'project:p1');
    expect(chipsOpenFields(nothing)).toEqual({ scopeKind: 'system' });
    expect(chipsOpenFields(nothing, 'p9')).toEqual({ scopeKind: 'system', projectId: 'p9' });
    expect(chipsScoped(nothing)).toBe(false);
    const all = defaultScopeChips({ project: null, repo: null });
    expect(chipsOpenFields(all)).toEqual({ scopeKind: 'everything' });
    // Context chips never touch the wire.
    expect(chipsOpenFields(clickChip(clickChip(nothing, 'memory'), 'runs'))).toEqual({ scopeKind: 'system' });
  });

  it('+ Add: a second project replaces the first (the wire names one); an added chip removes on click', () => {
    const two = addChip(page, { key: 'project:p2', kind: 'project', label: 'Other', ref: 'p2' });
    expect(two.filter((c) => c.kind === 'project').map((c) => c.key)).toEqual(['project:p2']);
    expect(chipsOpenFields(two)).toEqual({ repoRefs: ['r1'], projectId: 'p2' });
    const withRun = addChip(page, { key: 'run:x', kind: 'run', label: 'fix login', ref: 'x' });
    expect(clickChip(withRun, 'run:x').some((c) => c.key === 'run:x')).toBe(false);
  });

  it('the pack names what was chosen and what was not, and only the chosen content', () => {
    const chips = clickChip(clickChip(page, 'memory'), 'page');
    const lines = scopePackLines(chips, [{ id: 'r-1', title: 'fix login', status: 'failed' }]);
    expect(lines[0]).toBe('can see (chosen by the user): Project · API · Repo · billing · Memory');
    expect(lines[1]).toBe('not chosen — do not consult: Steering · Recent runs');
    expect(lines.some((l) => l.startsWith('memory:'))).toBe(true);
    expect(lines.some((l) => l.startsWith('recent runs'))).toBe(false);
  });
});

describe('the CLI picker', () => {
  const ROSTER = [
    { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, auth: 'signed_out', signed_in: false },
    { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, health: { status: 'inactive', message: '429 Too Many Requests: usage limit, retry at 2026-10-25T18:00', since: 'x' } },
    { key: 'agy', display_name: 'Antigravity', binary: 'agy', enabled_for_council: true, chat_admission: { scoped: { ok: false, reason: 'its ACP adapter asks no permissions' }, unscoped: { ok: true } } },
    { key: 'opencode', display_name: 'OpenCode', binary: 'opencode', enabled_for_council: true },
    { key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true },
    { key: 'claude-judge', display_name: 'Claude Code (judge)', binary: 'claude', category: 'judge', enabled_for_council: true },
  ] as unknown as RosterSeat[];

  it('lists every CLI but the reviewer-only one, each with whether it can answer and why not', () => {
    const opts = cliOptions(ROSTER, true);
    expect(opts.map((o) => o.key)).toEqual(['claude', 'codex', 'agy', 'opencode', 'pi']);
    const by = Object.fromEntries(opts.map((o) => [o.key, o]));
    expect(by['claude']).toMatchObject({ ok: false, reason: 'signed out', signInPath: '/agents?fix=claude' });
    expect(by['codex']).toMatchObject({ ok: false, reason: 'benched: access returns 2026-10-25T18:00', signInPath: null });
    expect(by['agy']).toMatchObject({ ok: false, reason: 'its ACP adapter asks no permissions' });
    expect(by['opencode']).toMatchObject({ ok: true, optIn: true });
    expect(by['pi']).toMatchObject({ ok: true, reason: null });
    // Unscoped, agy's admission is ok.
    expect(cliOptions(ROSTER, false).find((o) => o.key === 'agy')?.ok).toBe(true);
  });

  it('defaults to exactly one: the last pick, else the saved default seat, else the first that can answer (never an opt-in)', () => {
    const opts = cliOptions(ROSTER, true);
    expect(defaultChatCli(opts, null, [])).toBe('pi');
    expect(defaultChatCli(opts, null, ['claude', 'opencode'])).toBe('opencode');
    expect(defaultChatCli(opts, 'opencode', [])).toBe('opencode');
    // A remembered pick that can no longer answer is passed over.
    expect(defaultChatCli(opts, 'codex', [])).toBe('pi');
    expect(defaultChatCli(cliOptions([ROSTER[0]!], true), null, [])).toBeNull();
  });
});

describe('page-aware prompts from live data', () => {
  const projects = [{ id: 'p-up', name: 'upload-endpoint', updated_at: 5 }];
  const repos = [{ id: 'r-bill', name: 'billing' }];
  const base = { needRows: [], gates: {}, clis: [], roster: null, projects, repos };

  it('a held run: "Why is this run held, and what should I do?" carrying its gate', () => {
    const runs = [run('run-7', 'migrate the auth tables', 'awaiting_human', { project_id: 'p-up', repo_ref: 'r-bill' })];
    const ctx = pageContext({ pathname: '/s/run%3Arun-7', runs, projects, repos });
    expect(ctx).toMatchObject({ kind: 'run', project: { id: 'p-up', name: 'upload-endpoint' }, repo: { id: 'r-bill', name: 'billing' } });
    expect(pagePlaceholder(ctx)).toBe(`Ask about ${ctx.label}…`);
    const prompts = pagePrompts({ ...base, ctx, runs, gates: { 'run-7': { prompt: 'Approve the plan?' } } });
    expect(prompts[0]!.label).toBe('Why is this run held, and what should I do?');
    expect(prompts[0]!.text).toContain('run-7');
    expect(prompts[0]!.text).toContain('“Approve the plan?”');
  });

  it('a failed run asks why it failed; a running one asks what it is doing', () => {
    const failed = [run('run-8', 'ship the parser', 'failed')];
    const ctx = pageContext({ pathname: '/s/run-8', runs: failed, projects, repos });
    expect(pagePrompts({ ...base, ctx, runs: failed })[0]!.label).toBe('Why did “ship the parser” fail?');
    const live = [run('run-9', 'ship the parser', 'executing')];
    const ctx2 = pageContext({ pathname: '/s/run-9', runs: live, projects, repos });
    expect(pagePrompts({ ...base, ctx: ctx2, runs: live })[0]!.label).toBe('What is this run doing right now?');
  });

  it('Nerve Center: "What’s stopping work right now?", plus the CLI that is out and the waiting count', () => {
    const ctx = pageContext({ pathname: '/watch', runs: [], projects, repos });
    expect(ctx.kind).toBe('nerve');
    expect(pageContext({ pathname: '/health', runs: [], projects, repos }).kind).toBe('nerve');
    const clis = [
      { key: 'pi', label: 'Pi', ok: true, reason: null, signInPath: null, optIn: false },
      { key: 'codex', label: 'Codex', ok: false, reason: 'benched: usage limit reached', signInPath: null, optIn: false },
    ];
    const prompts = pagePrompts({ ...base, ctx, runs: [], clis, needRows: [{}, {}] as never });
    expect(prompts.map((p) => p.label)).toEqual([
      'What’s stopping work right now?',
      'Why is Codex out?',
      'Which of the 2 waiting items comes first?',
    ]);
    expect(prompts[1]!.text).toContain('benched: usage limit reached');
  });

  it('a repo page names the repo and leads with its failed run', () => {
    const runs = [run('run-1', 'fix the invoice total', 'failed', { repo_ref: 'r-bill' }), run('run-2', 'other repo', 'failed', { repo_ref: 'r-x' })];
    const ctx = pageContext({ pathname: '/repo-detail/r-bill', runs, projects, repos });
    expect(ctx).toMatchObject({ kind: 'repo', label: 'billing', repo: { id: 'r-bill', name: 'billing' } });
    const labels = pagePrompts({ ...base, ctx, runs }).map((p) => p.label);
    expect(labels).toEqual(['Why did “fix the invoice total” fail?', 'What changed in billing recently?', 'Where is billing riskiest to change?']);
  });

  it('prompts differ per page type', () => {
    const at = (pathname: string): string[] => pagePrompts({ ...base, ctx: pageContext({ pathname, runs: [], projects, repos }), runs: [] }).map((p) => p.label);
    const pages = ['/', '/watch', '/steering', '/workflows', '/projects/p-up', '/repo-detail/r-bill'];
    const sets = pages.map((p) => at(p).join('|'));
    expect(new Set(sets).size).toBe(pages.length);
    expect(at('/projects/p-up')[0]).toBe('How healthy is upload-endpoint?');
    expect(at('/')).toContain('Is studio healthy?');
  });
});
