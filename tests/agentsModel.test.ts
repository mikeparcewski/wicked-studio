import { describe, expect, it } from 'vitest';
import type { DiagnosticsSeatGovernance, GovernanceScopeKind, RosterSeat, SeatGovernanceMode, SeatRecordResponse } from '../src/api/types.js';
import { issueCopy } from '../src/board/agentsCopy.js';
import { agentRows, agentTiles, attention, boundaryHolds, commandDisplay, countWords, fixLabel, type AgentsInputs } from '../src/board/agentsModel.js';

/**
 * DES-seats-page §3–§4: the Agents model over today's wire (crew 0.10), shaped like the rig's roster
 * (scrubbed): Claude Code signed out, Codex benched on repository jobs, Pi unconfirmed with frequent
 * fresh starts, Copilot out of quota with writes kept in the repository, opencode opt-in on an
 * unapproved version, and a reviewer-only Claude Code that folds into its row.
 */
const NOW = Date.UTC(2026, 9, 12, 18, 40);
const ago = (min: number): string => new Date(NOW - min * 60_000).toISOString();
const mode = (m: SeatGovernanceMode['mode'], source: SeatGovernanceMode['source']): SeatGovernanceMode => ({ mode: m, class: null, source, reason: 'r', fence: { write_roots: [], read_roots: [], network: 'open' } });
const all = (m: SeatGovernanceMode): Record<GovernanceScopeKind, SeatGovernanceMode> => ({ unscoped: m, scoped: m, scoped_bound: m });
const HOME = '/Users/reel-operator';

const seat = (key: string, display_name: string, extra: Partial<RosterSeat> & Record<string, unknown>): RosterSeat => ({
  key, display_name, binary: key, enabled_for_council: true, health: { status: 'active', since: ago(600) }, ...extra,
});

const ROSTER: RosterSeat[] = [
  seat('claude', 'Claude Code', {
    auth: 'signed_out', login_check: 'status', probed_at: ago(4), council_eligible: false, governance_mode: all(mode('admitted', 'acp_input_governance')),
    login_invocation: `CLAUDE_CONFIG_DIR="${HOME}/.wicked-worker/claude" claude`, logout_invocation: `CLAUDE_CONFIG_DIR="${HOME}/.wicked-worker/claude" claude auth logout`,
    auth_evidence: 'someone@example.com is not logged in', login_note: 'login unverified — account acct_123',
  }),
  seat('codex', 'Codex', { auth: 'signed_in', login_check: 'live', probed_at: ago(6), council_eligible: true, governance_mode: all(mode('os_sandbox', 'self')), login_invocation: `CODEX_HOME="${HOME}/.wicked-worker/codex" codex login`, logout_invocation: `CODEX_HOME="${HOME}/.wicked-worker/codex" codex logout` }),
  seat('pi', 'Pi CLI', { auth: 'signed_in', login_check: 'unverified', council_eligible: true, governance_mode: all(mode('admitted', 'acp_input_governance')), login_invocation: 'pi login' }),
  seat('copilot', 'GitHub Copilot CLI', {
    auth: 'signed_in', login_check: 'unverified', council_eligible: true, login_invocation: 'copilot login',
    governance_mode: { unscoped: mode('none', 'none'), scoped: mode('none', 'none'), scoped_bound: mode('os_sandbox', 'repo_boundary') },
  }),
  seat('opencode', 'opencode', {
    optIn: true, auth: 'not_required', free_tier: 'free models', council_eligible: true, governance_mode: all(mode('none', 'none')),
    version_pin: { cli: 'opencode', binary: 'opencode', pinned: 'opencode v1.17.18', observed: 'opencode v2.0.25', matched: false, governanceClaimed: true, disclosure: 'pin mismatch: governance fails closed' },
  }),
  seat('claude-eval', 'Claude Code (judge)', { category: 'judge', binary: 'claude', auth: 'signed_out', council_eligible: false }),
];

const GOV: DiagnosticsSeatGovernance = {
  rosterFile: null, hostBoundary: 'sandbox-exec',
  seats: ROSTER.map((s) => ({ cli: s.key, enabled_for_council: true, transport: 'acp', os_sandbox: false, class: null, input_governance: 'claimed', governance_mode: s.governance_mode! })),
};
const REC: SeatRecordResponse = {
  days: 7, since: NOW - 7 * 86_400_000, until: NOW, runsRead: 32, truncated: false,
  seats: [
    { cli: 'pi', units: 42, gated: 40, firstPass: 38, rework: 1, stalls: 0, benched: 0, benchReasons: {}, costUsd: null, costedUsage: 0, byPhase: {} },
    { cli: 'copilot', units: 3, gated: 3, firstPass: 3, rework: 0, stalls: 0, benched: 3, benchReasons: { 'quota_exhausted (no success in the run)': 3 }, costUsd: null, costedUsage: 0, byPhase: {} },
  ],
};
const ACP = { pi: { sessionsStarted: 123, fallbacks: 209, fallbackKinds: { read_only_requires_wrapped: 145, binary_unavailable: 64 } } };
const base: AgentsInputs = { roster: ROSTER, governance: GOV, acpByCli: ACP, record: REC, defaults: null, now: NOW };
const by = (inp: AgentsInputs = base) => Object.fromEntries(agentRows(inp).map((r) => [r.key, r]));

describe('one row per agent, in plain words (§3.1)', () => {
  it('folds the reviewer-only seat into its agent (#735): one Claude Code row, "Also reviews work"', () => {
    const rows = agentRows(base);
    expect(rows.map((r) => r.key)).toEqual(['claude', 'codex', 'pi', 'copilot', 'opencode']);
    expect(rows[0]!.alsoReviews).toBe(true);
  });

  it('reads each agent the way the design table says', () => {
    const r = by();
    expect([r.claude!.ready.word, r.claude!.sign.word, r.claude!.sign.sub]).toEqual(['Not ready', 'Signed out', 'checked 4 minutes ago']);
    expect([r.codex!.ready.word, r.codex!.sign.word, r.codex!.safe.word]).toEqual(['Ready, except repository jobs', 'Signed in', 'Writes kept in its sandbox']);
    expect([r.pi!.ready.word, r.pi!.ready.sub, r.pi!.sign.word]).toEqual(['Ready', 'worked 42 steps this week', 'Looks signed in']);
    expect([r.copilot!.ready.word, r.copilot!.safe.word]).toEqual(['Quota unknown', 'Writes kept in the repository']);
    expect([r.opencode!.ready.word, r.opencode!.sign.word, r.opencode!.safe.word, r.opencode!.version.word, r.opencode!.version.sub])
      .toEqual(['Not recommended', 'No sign-in needed', 'Not checked', '2.0.25', 'not approved yet (approved: 1.17.18)']);
    expect(r.claude!.version.word).toBe('Not reported');
    // crew's A1 `version` when present: the first version-shaped token of the CLI's own line.
    const v = by({ ...base, roster: ROSTER.map((x) => (x.key === 'claude' ? { ...x, version: { installed: '2.1.287 (Claude Code)', proven: null, status: 'no_pin' } } : x)) });
    expect(v.claude!.version.word).toBe('2.1.287');
    expect(r.pi!.transport?.sub).toBe('if it can’t start one, studio starts a new one');
  });

  it('an unanswered version probe reads "Not found", never as an unapproved version (real :7701 data)', () => {
    const missing = ROSTER.map((x) => (x.key === 'opencode' ? { ...x, version_pin: { ...x.version_pin!, observed: null } } : x));
    const r = by({ ...base, roster: missing });
    expect([r.opencode!.version.word, r.opencode!.ready.sub]).toEqual(['Not found', 'studio couldn’t read its version']);
    expect(issueCopy('version_unproven', r.opencode!, agentRows({ ...base, roster: missing }), NOW).title).toBe('Safety checks are off: its version couldn’t be read');
  });

  it('quality checks are "not reported" until crew sends qe_reviewer (no seat list in studio)', () => {
    expect(agentRows(base).every((r) => r.qe === null)).toBe(true);
    const withQe = ROSTER.map((s) => ({ ...s, qe_reviewer: { ok: s.key !== 'opencode', reason_code: null } }));
    const r = by({ ...base, roster: withQe });
    expect(r.codex!.qe).toBe(true);
    expect(r.claude!.qe).toBe(false); // signed out
    expect(r.opencode!.qe).toBe(false);
  });

  it('flags qe_blocked only from crew’s field: no agent can run them and signing this one in would', () => {
    const withQe = ROSTER.map((s) => ({ ...s, qe_reviewer: s.key === 'claude' ? { ok: false, reason_code: 'signed_out' } : { ok: false, reason_code: 'no_isolated_reviewer' } }));
    const r = by({ ...base, roster: withQe });
    expect(r.claude!.issues.map((i) => i.code)).toContain('qe_blocked');
    expect(by().claude!.issues.map((i) => i.code)).not.toContain('qe_blocked');
  });

  it('the codex bench comes from work_admission when crew sends it (the studio constant is the fallback)', () => {
    const admitted = ROSTER.map((s) => (s.key === 'codex' ? { ...s, work_admission: { unscoped: { ok: true }, scoped: { ok: true }, scoped_bound: { ok: true } } } : s));
    expect(by({ ...base, roster: admitted }).codex!.ready.word).toBe('Ready');
    expect(by().codex!.issues.map((i) => i.code)).toContain('codex_worktree');
  });
});

describe('the one boundary predicate (§3.1)', () => {
  it('a repo_boundary claim holds only with the host’s sandbox tool', () => {
    const copilot = ROSTER.find((s) => s.key === 'copilot')!;
    expect(boundaryHolds(copilot, 'scoped_bound', GOV)).toBe(true);
    expect(boundaryHolds(copilot, 'scoped_bound', { ...GOV, hostBoundary: null })).toBe(false);
    expect(boundaryHolds(copilot, 'scoped_bound', undefined)).toBe(false);
  });

  it('with no host boundary the row, the card and the count all downgrade together', () => {
    const r = by({ ...base, governance: { ...GOV, hostBoundary: null } });
    expect([r.copilot!.safe.word, r.copilot!.safe.sub]).toEqual(['Not checked', 'no sandbox on this computer']);
    expect(r.copilot!.issues.map((i) => i.code)).toContain('no_host_boundary');
    expect(r.copilot!.issues.map((i) => i.code)).not.toContain('fence_scoped');
  });

  it('an unread host boundary is unknown, not a confirmed absence (codex r4 P1)', () => {
    const r = by({ ...base, governance: undefined });
    expect([r.copilot!.safe.word, r.copilot!.safe.sub]).toEqual(['Not checked', 'couldn’t read this computer’s sandbox']);
    expect(r.copilot!.issues.map((i) => i.code)).toContain('boundary_unknown');
    expect(r.copilot!.issues.map((i) => i.code)).not.toContain('no_host_boundary');
  });

  it('codex’s own --sandbox (source self) keeps its claim (Q5)', () => {
    expect(by({ ...base, governance: { ...GOV, hostBoundary: null } }).codex!.safe.word).toBe('Writes kept in its sandbox');
  });
});

describe('issues, counts and the fix button (§4)', () => {
  it('sorts problem > warning > note, safety before availability (Copilot: unlimited writes above quota)', () => {
    expect(by().copilot!.issues.map((i) => i.code)).toEqual(['fence_scoped', 'quota', 'unverified']);
    expect(by().opencode!.issues.map((i) => i.code)).toEqual(['version_unproven', 'opt_in']);
  });

  it('labels the button by the worst severity and counts problems and warnings only for the rail (Q6)', () => {
    const r = by();
    expect(fixLabel(r.claude!)).toEqual({ label: 'Fix 1 problem', tone: 'fail' });
    expect(fixLabel(r.copilot!)).toEqual({ label: 'See 2 warnings', tone: 'gate' });
    expect(fixLabel(r.pi!)).toEqual({ label: 'See 2 notes', tone: 'quiet' });
    // The tiles count only rows that say Ready; Codex, Copilot and opencode can work, with limits (codex P1).
    expect(agentTiles(agentRows(base))).toMatchObject({ ready: 1, limited: 2, notRecommended: 1, total: 5, signedOut: 1, everyAction: 2, floorOnly: 1, boundaryOnly: 1, fixes: 5, notes: 4 });
    expect(countWords(r.copilot!)).toBe('2 warnings · 1 note, most important first');
    expect(attention(agentRows(base))).toEqual({ count: 4, tone: 'fail' });
  });

  it('commands show $HOME (it expands inside double quotes; ~ does not) and copy the line verbatim', () => {
    const r = by();
    const c = issueCopy('signed_out', r.claude!, agentRows(base), NOW);
    expect(c.fix[0]!.commands[0]).toEqual({ line: ROSTER[0]!.login_invocation, display: 'CLAUDE_CONFIG_DIR="$HOME/.wicked-worker/claude" claude', label: 'sign-in' });
    expect(commandDisplay('PI_CONFIG_DIR=/home/ada/.wicked-worker/pi pi login')).toBe('PI_CONFIG_DIR=$HOME/.wicked-worker/pi pi login');
  });

  it('never renders auth_evidence or login_note, and crew’s own sentences only as Technical details (§4.3)', () => {
    const rows = agentRows(base);
    for (const row of rows) {
      for (const i of row.issues) {
        const c = issueCopy(i.code, row, rows, NOW);
        const defaultLayer = [c.title, c.what, c.why, ...[...c.fix, ...c.fix.flatMap((f) => f.sub ?? [])].flatMap((f) => [f.lead, f.text, f.note ?? '', ...f.commands.map((x) => x.display)])].join(' ');
        expect(defaultLayer).not.toMatch(/example\.com|acct_123|not logged in|pin mismatch|\/Users\//);
        expect(c.tech ?? '').not.toMatch(/example\.com|acct_123/);
      }
    }
    expect(issueCopy('version_unproven', by().opencode!, rows, NOW).tech).toBe('pin mismatch: governance fails closed');
  });

  it('never says nothing is blocked while quality checks are blocked (codex P1 r2)', () => {
    const withQe = ROSTER.map((s) => ({ ...s, qe_reviewer: { ok: false, reason_code: s.key === 'claude' ? 'signed_out' : 'no_isolated_reviewer' } }));
    const rows = agentRows({ ...base, roster: withQe });
    const codex = rows.find((r) => r.key === 'codex')!;
    expect(issueCopy('codex_worktree', codex, rows, NOW).fix[0]!.text).toContain('Quality checks stay unavailable');
    // The host opt-out (an env var) is never in the default layer: only inside the step's own disclosure.
    const cw = issueCopy('codex_worktree', codex, rows, NOW);
    expect(JSON.stringify(cw.fix.map((f) => [f.lead, f.text]))).not.toContain('WICKED_');
    expect(cw.fix[1]!.sub![1]!.tech!.text).toContain('WICKED_CODEX_WORKTREE_OK');
  });
});
