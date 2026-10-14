import { describe, expect, it } from 'vitest';
import type { GovernanceScopeKind, RosterSeat, SeatGovernanceMode, SeatIssue, SeatRecordResponse } from '../src/api/types.js';
import { issueCopy } from '../src/board/agentsCopy.js';
import { agentRows, agentTiles, attention, boundaryHolds, commandDisplay, countWords, fixLabel, maskIds, type AgentIssue, type AgentRow, type AgentsInputs } from '../src/board/agentsModel.js';

/**
 * DES-seats-page §3–§4: the Agents model over crew's wire (api-types 0.115.0), shaped like the rig's
 * roster (scrubbed): Claude Code signed out, Codex benched on repository jobs (studio's constant:
 * no `work_admission` yet), Pi unconfirmed with frequent fresh starts, Copilot on an active quota
 * bench with writes kept in the repository, opencode opt-in on an unapproved version, and a
 * reviewer-only Claude Code that folds into its row. Each seat's `issues` is what crew's
 * `seatIssues` sends for those facts.
 */
const NOW = Date.UTC(2026, 9, 12, 18, 40);
const ago = (min: number): string => new Date(NOW - min * 60_000).toISOString();
const mode = (m: SeatGovernanceMode['mode'], source: SeatGovernanceMode['source']): SeatGovernanceMode => ({ mode: m, class: null, source, reason: 'r', fence: { write_roots: [], read_roots: [], network: 'open' } });
const all = (m: SeatGovernanceMode): Record<GovernanceScopeKind, SeatGovernanceMode> => ({ unscoped: m, scoped: m, scoped_bound: m });
const HOME = '/Users/reel-operator';
const issue = (code: string, severity: SeatIssue['severity'], params: SeatIssue['params'] = {}): SeatIssue => ({ code, severity, params, message: `crew says ${code}` });

const seat = (key: string, display_name: string, extra: Partial<RosterSeat> & Record<string, unknown>): RosterSeat => ({
  key, display_name, binary: key, enabled_for_council: true, health: { status: 'active', since: ago(600) }, issues: [], ...extra,
});

const BENCH = { kind: 'quota_exhausted', runs: 3, last_at: ago(12), lifts_at: new Date(NOW + 18 * 60_000).toISOString(), source: 'worker', reason: 'quota_exhausted (no success in the run)' };
const ROSTER: RosterSeat[] = [
  seat('claude', 'Claude Code', {
    auth: 'signed_out', login_check: 'status', probed_at: ago(4), council_eligible: false, governance_mode: all(mode('admitted', 'acp_input_governance')),
    login_invocation: `CLAUDE_CONFIG_DIR="${HOME}/.wicked-worker/claude" claude`, logout_invocation: `CLAUDE_CONFIG_DIR="${HOME}/.wicked-worker/claude" claude auth logout`,
    auth_evidence: 'someone@example.com is not logged in', login_note: 'login unverified — account acct_123',
    issues: [issue('signed_out', 'problem')],
  }),
  seat('codex', 'Codex', { auth: 'signed_in', login_check: 'live', probed_at: ago(6), council_eligible: true, governance_mode: all(mode('os_sandbox', 'self')), login_invocation: `CODEX_HOME="${HOME}/.wicked-worker/codex" codex login`, logout_invocation: `CODEX_HOME="${HOME}/.wicked-worker/codex" codex logout`, account: { kind: 'subscription' } }),
  seat('pi', 'Pi CLI', { auth: 'signed_in', login_check: 'unverified', council_eligible: true, governance_mode: all(mode('admitted', 'acp_input_governance')), login_invocation: 'pi login', issues: [issue('unverified', 'note')] }),
  seat('copilot', 'GitHub Copilot CLI', {
    auth: 'signed_in', login_check: 'unverified', council_eligible: false, login_invocation: 'copilot login', recent_bench: BENCH,
    governance_mode: { unscoped: mode('none', 'none'), scoped: mode('none', 'none'), scoped_bound: mode('os_sandbox', 'repo_boundary') },
    issues: [issue('fence_scoped', 'warning'), issue('quota', 'warning', { kind: 'quota_exhausted', runs: 3 }), issue('unverified', 'note')],
  }),
  seat('opencode', 'opencode', {
    optIn: true, auth: 'not_required', free_tier: 'free models', council_eligible: true, governance_mode: all(mode('none', 'none')), account: { kind: 'free' },
    version: { installed: 'opencode v2.0.25', proven: 'opencode v1.17.18', status: 'unproven', checked_at: ago(3), install_source: 'brew' },
    version_pin: { cli: 'opencode', binary: 'opencode', pinned: 'opencode v1.17.18', observed: 'opencode v2.0.25', matched: false, governanceClaimed: true, disclosure: 'pin mismatch: governance fails closed' },
    issues: [issue('version_unproven', 'warning', { installed: 'opencode v2.0.25', proven: 'opencode v1.17.18' }), issue('opt_in', 'note')],
  }),
  seat('claude-eval', 'Claude Code (judge)', { category: 'judge', binary: 'claude', auth: 'signed_out', council_eligible: false, issues: [issue('signed_out', 'problem')] }),
];

const REC: SeatRecordResponse = {
  days: 7, since: NOW - 7 * 86_400_000, until: NOW, runsRead: 32, truncated: false,
  seats: [
    { cli: 'pi', units: 42, gated: 40, firstPass: 38, rework: 1, stalls: 0, benched: 0, benchReasons: {}, costUsd: null, costedUsage: 0, byPhase: {} },
    { cli: 'copilot', units: 3, gated: 3, firstPass: 3, rework: 0, stalls: 0, benched: 3, benchReasons: { 'quota_exhausted (no success in the run)': 3 }, costUsd: null, costedUsage: 0, byPhase: {} },
  ],
};
const ACP = { pi: { sessionsStarted: 123, fallbacks: 209, fallbackKinds: { read_only_requires_wrapped: 145, binary_unavailable: 64 } } };
const base: AgentsInputs = { roster: ROSTER, acpByCli: ACP, record: REC, defaults: null, now: NOW };
const by = (inp: AgentsInputs = base): Record<string, AgentRow> => Object.fromEntries(agentRows(inp).map((r) => [r.key, r]));
const over = (key: string, extra: Record<string, unknown>): RosterSeat[] => ROSTER.map((s) => (s.key === key ? ({ ...s, ...extra } as RosterSeat) : s));
const codes = (r: AgentRow): string[] => r.issues.map((i) => i.code);
const find = (r: AgentRow, code: string): AgentIssue => r.issues.find((i) => i.code === code)!;

describe('container seats (crew#1006)', () => {
  const signedIn = { auth: 'signed_in', login_check: 'status', council_eligible: true, issues: [issue('live_check_failed', 'warning')] };
  it('a container seat reads Signed in, and crew’s live_check_failed for its broker reading is dropped', () => {
    const r = by({ ...base, roster: over('claude', { ...signedIn, sign_in: 'container' }) });
    expect(r.claude!.sign).toMatchObject({ word: 'Signed in', tone: 'ok' });
    expect(codes(r.claude!)).not.toContain('live_check_failed');
  });
  it('every "sign in again" step of a container agent is the Sign in button, never a host command (codex r7)', () => {
    const r = by({ ...base, roster: over('claude', { auth: 'signed_in', login_check: 'status', council_eligible: false, sign_in: 'container', issues: [] }) });
    const card = issueCopy(find(r.claude!, 'not_admitted'), r.claude!, agentRows(base), NOW, true);
    const again = card.fix.find((f) => f.lead.startsWith('If it keeps happening'))!;
    expect(again).toMatchObject({ lead: 'If it keeps happening, sign in again here.', signIn: true, commands: [] });
    // A host agent keeps its own command.
    const host = issueCopy(find(r.claude!, 'not_admitted'), r.claude!, agentRows(base), NOW, false);
    expect(host.fix.find((f) => f.lead.startsWith('If it keeps happening'))!.commands.length).toBe(1);
  });
  it('a host seat keeps its real live_check_failed, even folded under a container seat (per seat, codex r3)', () => {
    const roster = over('claude', { ...signedIn, sign_in: 'container' }).map((s) => (s.key === 'claude-eval' ? ({ ...s, ...signedIn } as RosterSeat) : s));
    const r = by({ ...base, roster });
    expect(r.claude!.keys).toEqual(['claude', 'claude-eval']);
    expect(codes(r.claude!)).toContain('live_check_failed');
    expect(codes(by({ ...base, roster: over('claude', signedIn) }).claude!)).toContain('live_check_failed');
  });
});

describe('one row per agent, in plain words (§3.1)', () => {
  it('folds the reviewer-only seat into its agent (#735): one Claude Code row, "Also reviews work"', () => {
    const rows = agentRows(base);
    expect(rows.map((r) => r.key)).toEqual(['claude', 'codex', 'pi', 'copilot', 'opencode']);
    expect(rows[0]!.alsoReviews).toBe(true);
    expect(codes(rows[0]!)).toEqual(['signed_out']); // the folded seat's same code, once
  });

  it('keeps a reviewer-only seat on its own row when its sign-in differs (one row = one login)', () => {
    const rows = agentRows({ ...base, roster: over('claude-eval', { auth: 'signed_in', login_check: 'live', council_eligible: true, issues: [] }) });
    expect(rows.map((r) => r.key)).toEqual(['claude', 'codex', 'pi', 'copilot', 'opencode', 'claude-eval']);
    expect(rows[0]!.alsoReviews).toBe(false);
    expect(rows[0]!.keys).toEqual(['claude']);
  });

  it('reads each agent the way the design table says', () => {
    const r = by();
    expect([r.claude!.ready.word, r.claude!.sign.word, r.claude!.sign.sub]).toEqual(['Not ready', 'Signed out', 'checked 4 minutes ago']);
    expect([r.codex!.ready.word, r.codex!.sign.word, r.codex!.safe.word, r.codex!.account]).toEqual(['Ready, except repository jobs', 'Signed in', 'Writes kept in its sandbox', 'subscription']);
    expect([r.pi!.ready.word, r.pi!.ready.sub, r.pi!.sign.word]).toEqual(['Ready', 'worked 42 steps this week', 'Looks signed in']);
    expect([r.opencode!.ready.word, r.opencode!.sign.word, r.opencode!.safe.word, r.opencode!.version.word, r.opencode!.version.sub, r.opencode!.account])
      .toEqual(['Not recommended', 'No sign-in needed', 'Not checked', '2.0.25', 'not approved yet (approved: 1.17.18)', 'free models']);
    expect(r.claude!.version.word).toBe('Not reported');
    const v = by({ ...base, roster: over('claude', { version: { installed: '2.1.287 (Claude Code)', proven: null, status: 'no_pin', checked_at: ago(1), install_source: 'brew' } }) });
    expect(v.claude!.version.word).toBe('2.1.287');
  });

  it('an active bench (A3) says so, with crew’s window as studio’s retry — never as a provider reset', () => {
    const r = by();
    expect(r.copilot!.ready.word).toBe('Out of quota');
    expect(r.copilot!.ready.sub).toMatch(/^studio tries it again by \d{1,2}:\d{2}/);
    expect(r.copilot!.usable).toBe(false);
    const c = issueCopy(find(r.copilot!, 'quota'), r.copilot!, agentRows(base), NOW);
    expect(c.what).toContain('3 jobs');
    expect(c.why).toContain('not when your plan resets');
    expect(`${c.title} ${c.what} ${c.why}`).not.toMatch(/until \d|resets at|out of usage until/i);
    expect(c.tech).toBe('quota_exhausted (no success in the run)');
    // The bench clears (no recent_bench, no crew issue): the row recovers; week history alone never says "out".
    const cleared = by({ ...base, roster: over('copilot', { recent_bench: undefined, council_eligible: true, issues: [issue('fence_scoped', 'warning'), issue('unverified', 'note')] }) });
    expect(cleared.copilot!.ready.word).toBe('Ready');
    const usage = by({ ...base, roster: over('copilot', { recent_bench: { ...BENCH, kind: 'usage_limit' }, issues: [issue('usage_limit', 'warning')] }) });
    expect([usage.copilot!.ready.word, codes(usage.copilot!)]).toEqual(['Out of usage', ['usage_limit']]);
  });

  it('an unanswered version probe reads "Not found", never as an unapproved version', () => {
    const missing = over('opencode', { version: undefined, version_pin: { ...ROSTER[4]!.version_pin!, observed: null } });
    const r = by({ ...base, roster: missing });
    expect([r.opencode!.version.word, r.opencode!.ready.sub]).toEqual(['Not found', 'studio couldn’t read its version']);
    expect(issueCopy(find(r.opencode!, 'version_unproven'), r.opencode!, agentRows({ ...base, roster: missing }), NOW).title).toBe('Safety checks are off: its version couldn’t be read');
  });

  it('real :7701 data (crew 0.10.1): the approved build whose version check got no answer is not called "a different build"', () => {
    const silent = over('opencode', {
      version: { installed: 'opencode v2.0.25', proven: 'opencode v2.0.25', status: 'unproven', checked_at: ago(1), install_source: 'brew' },
      version_pin: { ...ROSTER[4]!.version_pin!, pinned: 'opencode v2.0.25', observed: null },
    });
    const r = by({ ...base, roster: silent });
    expect([r.opencode!.version.word, r.opencode!.version.sub]).toEqual(['2.0.25', 'its version check didn’t answer']);
    const c = issueCopy(find(r.opencode!, 'version_unproven'), r.opencode!, agentRows({ ...base, roster: silent }), NOW);
    expect(c.title).toBe('Safety checks are off: its version check didn’t answer');
    expect(c.what).not.toContain('proven on');
  });

  it('a known installed build that differs from the proven one stays a mismatch, even with an unanswered pin probe', () => {
    const r = by({ ...base, roster: over('opencode', { version_pin: { ...ROSTER[4]!.version_pin!, observed: null } }) });
    expect(r.opencode!.version.sub).toBe('not approved yet (approved: 1.17.18)');
  });

  it('real :7701 data (crew 0.10.2): A1 sends no installed build while the pin probe read it — the pin’s reading shows', () => {
    const r = by({ ...base, roster: over('opencode', {
      version: { installed: null, proven: 'opencode v2.0.25', status: 'proven', checked_at: ago(1), install_source: 'brew' },
      version_pin: { ...ROSTER[4]!.version_pin!, pinned: 'opencode v2.0.25', observed: 'opencode v2.0.25', matched: true },
    }) });
    expect([r.opencode!.version.word, r.opencode!.version.sub]).toEqual(['2.0.25', 'approved build']);
  });

  it('build metadata after a pre-release counts when comparing builds (codex #759 r1)', () => {
    const r = by({ ...base, roster: over('opencode', {
      version: { installed: 'opencode 1.2.3-rc+other', proven: 'opencode 1.2.3-rc+approved', status: 'unproven', checked_at: ago(1), install_source: 'brew' },
      version_pin: { ...ROSTER[4]!.version_pin!, observed: null },
    }) });
    expect([r.opencode!.version.word, r.opencode!.version.sub]).toEqual(['1.2.3-rc+other', 'not approved yet (approved: 1.2.3-rc+approved)']);
  });

  it('prerelease builds compare whole: 1.2.3-beta-2 is not the proven 1.2.3-beta-1', () => {
    const r = by({ ...base, roster: over('opencode', {
      version: { installed: 'opencode 1.2.3-beta-2', proven: 'opencode 1.2.3-beta-1', status: 'unproven', checked_at: ago(1), install_source: 'npm' },
      version_pin: { ...ROSTER[4]!.version_pin!, observed: null },
    }) });
    expect(r.opencode!.version.sub).toBe('not approved yet (approved: 1.2.3-beta-1)');
  });

    it('a folded reviewer’s bench takes away reviews only; the agent stays ready for work (codex S4 r4)', () => {
    const roster = ROSTER.map((x) => (x.key === 'claude' ? { ...x, auth: 'signed_in', login_check: 'live', council_eligible: true, issues: [] }
      : x.key === 'claude-eval' ? { ...x, auth: 'signed_in', council_eligible: false, recent_bench: BENCH, issues: [issue('quota', 'warning', { kind: 'quota_exhausted', runs: 2, last_at: ago(5), lifts_at: BENCH.lifts_at })] } : x) as RosterSeat);
    const rows = agentRows({ ...base, roster });
    const c = rows.find((r) => r.key === 'claude')!;
    expect([c.ready.word, c.usable, c.alsoReviews]).toEqual(['Ready', true, true]);
    const q = issueCopy(find(c, 'quota'), c, rows, NOW);
    expect(q.what).toContain('2 jobs');
    expect(q.what).toContain('studio tries it again by');
  });

    it('a folded reviewer’s more severe reading of the same code wins', () => {
    const r = by({ ...base, roster: over('claude', { issues: [{ ...issue('signed_out', 'problem'), severity: 'warning' }] }) });
    expect(r.claude!.issues.find((i) => i.code === 'signed_out')!.severity).toBe('problem');
  });

  it('quality checks are "not reported" until crew sends qe_reviewer (feature-detected)', () => {
    expect(agentRows(base).every((r) => r.qe === null)).toBe(true);
    const withQe = ROSTER.map((s) => ({ ...s, qe_reviewer: s.key === 'opencode' ? { ok: false, reason_code: 'skill_not_admitted', reason: 'r' } : { ok: true } }) as RosterSeat);
    const r = by({ ...base, roster: withQe });
    expect([r.codex!.qe, r.claude!.qe, r.opencode!.qe]).toEqual([true, false, false]);
  });

  it('no_qe never says "Nothing to do" while no agent can run quality checks (agy #759 r2)', () => {
    const qeAll = (ok: boolean): RosterSeat[] => ROSTER.map((s) => ({ ...s, qe_reviewer: s.key === 'pi' || !ok ? { ok: false, reason_code: 'skill_not_admitted', reason: 'r' } : { ok: true }, ...(s.key === 'pi' ? { issues: [issue('no_qe', 'note')] } : {}) }) as RosterSeat);
    const copyFor = (ok: boolean): string => {
      const inp = { ...base, roster: qeAll(ok) };
      const pi = by(inp).pi!;
      const c = issueCopy(find(pi, 'no_qe'), pi, agentRows(inp), NOW);
      return `${c.why} ${c.fix.map((f) => `${f.lead} ${f.text}`).join(' ')}`;
    };
    expect(copyFor(true)).toContain('Nothing to do.');
    const none = copyFor(false);
    expect(none).toContain('Right now no agent can run them.');
    expect(none).not.toContain('Nothing to do');
    expect(none).toContain('Sign in an agent that can run them.');
  });

  it('qe_blocked and no_qe come from crew’s codes, not a studio rule', () => {
    const r = by({ ...base, roster: over('claude', { issues: [issue('signed_out', 'problem'), issue('qe_blocked', 'problem')] }) });
    expect(codes(r.claude!)).toEqual(['signed_out', 'qe_blocked']);
    expect(codes(by().claude!)).not.toContain('qe_blocked');
  });

  it('work_admission (A5), when sent, replaces the codex constant; other refusals are never "Ready"', () => {
    const ok = { unscoped: { ok: true }, scoped: { ok: true }, scoped_bound: { ok: true } };
    expect(by({ ...base, roster: over('codex', { work_admission: ok }) }).codex!.ready.word).toBe('Ready');
    expect(codes(by().codex!)).toContain('codex_worktree');
    const crewSays = by({ ...base, roster: over('codex', { work_admission: { ...ok, scoped_bound: { ok: false, reason_code: 'worktree_bench', source: 'launcher', reason: 'r' } }, issues: [issue('codex_worktree', 'warning')] }) });
    expect(codes(crewSays.codex!)).toEqual(['codex_worktree']);
    const refused = by({ ...base, roster: over('pi', { work_admission: { ...ok, scoped_bound: { ok: false, reason_code: 'scope_ungoverned', source: 'scope', reason: 'r' } } }) });
    expect(refused.pi!.ready.word).toBe('Ready, except repository jobs');
    expect(codes(refused.pi!)).toContain('repo_refused');
  });

  it('a code studio has no words for shows crew’s line, in Technical details only', () => {
    const r = by({ ...base, roster: over('pi', { issues: [issue('brand_new_thing', 'warning')] }) });
    const u = find(r.pi!, 'unknown');
    const c = issueCopy(u, r.pi!, agentRows(base), NOW);
    expect(`${c.title} ${c.what} ${c.why}`).not.toContain('crew says');
    expect(c.tech).toBe('brand_new_thing: crew says brand_new_thing');
  });
});

describe('the one boundary predicate (§3.1)', () => {
  it('a repo_boundary claim holds unless crew says this computer has no sandbox tool', () => {
    const copilot = ROSTER.find((s) => s.key === 'copilot')!;
    expect(boundaryHolds(copilot, 'scoped_bound')).toBe(true);
    const none = { ...copilot, issues: [issue('unchecked', 'warning', { why: 'no_host_boundary' })] };
    expect(boundaryHolds(none, 'scoped_bound')).toBe(false);
  });

  it('with no host boundary the row, the card and the count all downgrade together', () => {
    const r = by({ ...base, roster: over('copilot', { issues: [issue('unchecked', 'warning', { why: 'no_host_boundary' }), issue('quota', 'warning')] }) });
    expect([r.copilot!.safe.word, r.copilot!.safe.sub, r.copilot!.governed.word]).toEqual(['Not checked', 'no sandbox on this computer', 'Not checked']);
    expect(codes(r.copilot!)).toEqual(['no_host_boundary', 'quota']);
  });

  it('codex’s own --sandbox (source self) keeps its claim (Q5)', () => {
    expect(by().codex!.safe.word).toBe('Writes kept in its sandbox');
  });
});

describe('issues, counts and the fix button (§4)', () => {
  it('sorts problem > warning > note, safety before availability (Copilot: unlimited writes above quota)', () => {
    expect(codes(by().copilot!)).toEqual(['fence_scoped', 'quota', 'unverified']);
    expect(codes(by().opencode!)).toEqual(['version_unproven', 'opt_in']);
    expect(codes(by().pi!)).toEqual(['unverified', 'fallbacks']);
  });

  it('labels the button by the worst severity and counts problems and warnings only for the rail (Q6)', () => {
    const r = by();
    expect(fixLabel(r.claude!)).toEqual({ label: 'Fix 1 problem', tone: 'fail' });
    expect(fixLabel(r.copilot!)).toEqual({ label: 'See 2 warnings', tone: 'gate' });
    expect(fixLabel(r.pi!)).toEqual({ label: 'See 2 notes', tone: 'quiet' });
    expect(agentTiles(agentRows(base))).toMatchObject({ ready: 1, limited: 1, held: 1, notRecommended: 1, total: 5, signedOut: 1, everyAction: 2, floorOnly: 1, boundaryOnly: 1, fixes: 5, notes: 4 });
    expect(countWords(r.copilot!)).toBe('2 warnings · 1 note, most important first');
    expect(attention(agentRows(base))).toEqual({ count: 4, tone: 'fail' });
  });

  it('commands show $HOME (it expands inside double quotes; ~ does not) and copy the line verbatim', () => {
    const r = by();
    const c = issueCopy(find(r.claude!, 'signed_out'), r.claude!, agentRows(base), NOW);
    expect(c.fix[0]!.commands[0]).toEqual({ line: ROSTER[0]!.login_invocation, display: 'CLAUDE_CONFIG_DIR="$HOME/.wicked-worker/claude" claude', label: 'sign-in' });
    expect(commandDisplay('PI_CONFIG_DIR=/home/ada/.wicked-worker/pi pi login')).toBe('PI_CONFIG_DIR=$HOME/.wicked-worker/pi pi login');
  });

  it('crew’s sentences and sign-in evidence render only in Technical details, identifiers masked (§4.3, A8)', () => {
    const rows = agentRows(base);
    for (const row of rows) {
      for (const i of row.issues) {
        const c = issueCopy(i, row, rows, NOW);
        const defaultLayer = [c.title, c.what, c.why, ...[...c.fix, ...c.fix.flatMap((f) => f.sub ?? [])].flatMap((f) => [f.lead, f.text, f.note ?? '', ...f.commands.map((x) => x.display)])].join(' ');
        expect(defaultLayer).not.toMatch(/example\.com|acct_123|not logged in|pin mismatch|crew says|\/Users\//);
        expect(c.tech ?? '').not.toMatch(/example\.com|acct_123/);
      }
    }
    const claude = by().claude!;
    expect(issueCopy(find(claude, 'signed_out'), claude, rows, NOW).tech).toBe('[email hidden] is not logged in\nlogin unverified — account [id hidden]');
    expect(issueCopy(find(by().opencode!, 'version_unproven'), by().opencode!, rows, NOW).tech).toBe('pin mismatch: governance fails closed');
    expect(maskIds('value ' + 'x1'.repeat(20))).toBe('value [key hidden]');
    expect(maskIds('key: ' + 'aB3+/'.repeat(6) + '==')).toBe('key: [key hidden]');
    expect(maskIds('CLAUDE_CONFIG_DIR is set')).toBe('CLAUDE_CONFIG_DIR is set');
    expect(maskIds('for user_jane_doe and acct_ab-12.')).toBe('for [id hidden] and [id hidden].');
    expect(maskIds('account_id=123456789012 ok')).toBe('[hidden] ok');
    expect(maskIds(`token=${'abcdefghijklmnop'.repeat(2)} ok`)).toBe('[hidden] ok');
    expect(maskIds('{"account_id": "alice", "token": "short secret", "loggedIn": true}')).toBe('{[hidden], [hidden], "loggedIn": true}');
    expect(maskIds('the user is not signed in to this account')).toBe('the user is not signed in to this account');
    expect(maskIds("{'password': 'x y', 'ok': 1}")).toBe("{[hidden], 'ok': 1}");
    // codex #759 r1–r3 P1: every 24+ run is hidden, paths and names included.
    expect(maskIds('seen ' + 'QwErTyUiOpAsDfGhJkLzXcVb' + ' ok')).toBe('seen [key hidden] ok');
    expect(maskIds('seen ' + '1'.repeat(30) + ' ok')).toBe('seen [key hidden] ok');
    expect(maskIds('read /opt/homebrew/lib/node_modules ok')).toBe('read [key hidden] ok');
    expect(maskIds('seen /abcdefghijklmnopqrstuv/wxyzabcd ok')).toBe('seen [key hidden] ok');
    expect(maskIds('signed_in_via_the_keychain ok')).toBe('[key hidden] ok');
    expect(maskIds('x abcdefghijkl_mnopqrstuvwxyz y')).toBe('x [key hidden] y');
    expect(maskIds('x abc/defghijkl-mnopqrstuvwxyz y')).toBe('x [key hidden] y');
    expect(maskIds('set CLAUDE_CONFIG_DIR ok')).toBe('set CLAUDE_CONFIG_DIR ok');
    expect(maskIds(`key ${['s', 'k'].join('')}-${'abcdefghijklm'.repeat(2)}`)).toBe('key [key hidden]'); // built at runtime: no key-shaped literal
    expect(by().copilot!.reviews).toBe(false); // on an active bench
  });

  it('never says nothing is blocked while quality checks are blocked (codex P1 r2)', () => {
    const withQe = ROSTER.map((s) => ({ ...s, qe_reviewer: s.key === 'claude' ? { ok: false, reason_code: 'signed_out', reason: 'r' } : { ok: false, reason_code: 'skill_not_admitted', reason: 'r' } }) as RosterSeat);
    const rows = agentRows({ ...base, roster: withQe });
    const codex = rows.find((r) => r.key === 'codex')!;
    const cw = issueCopy(find(codex, 'codex_worktree'), codex, rows, NOW);
    expect(cw.fix[0]!.text).toContain('Quality checks stay unavailable');
    expect(JSON.stringify(cw.fix.map((f) => [f.lead, f.text]))).not.toContain('WICKED_');
    expect(cw.fix[1]!.sub![1]!.tech!.text).toContain('WICKED_CODEX_WORKTREE_OK');
  });
});
