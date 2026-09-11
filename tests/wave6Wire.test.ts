/**
 * The wave-6 wire MIRROR (`src/api/wave6-wire.ts`) against the INSTALLED `wicked-crew-api-types`.
 *
 * The #257 parity pattern (`tests/skillsWire.test.ts`), now in its PINNED posture (pin ≥ 0.36.0,
 * the version that published the wire): every `>>> VERBATIM … <<< VERBATIM` region of the mirror is
 * byte-equal to the installed package at the labelled line range, every label names the pinned
 * version, and every wave-6 declaration studio codes against lives INSIDE a region (a trivial region
 * beside a hand-written wave-6 block does not satisfy the pin — independent review of #263, F-6).
 *
 * The two WIRE GAPS the mirror keeps studio-worded (a row-level `Campaign.test_set` /
 * `RunGroup.test_set` join; `TestingReconBody.workflow`) are guarded the other way round: the
 * installed package must NOT declare them — the version that does fails here and says "re-vendor".
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  diffSource,
  distributionAgreementPct,
  distributionDegradedReason,
  gateUngated,
  gateUngatedReason,
  QE_AUTHOR_TESTS_WORKFLOW_ID,
  testSetOf,
  WORKER_REMOTE_WRITE_REMEDY,
} from '../src/api/wave6-wire.js';

const MIRROR = fileURLToPath(new URL('../src/api/wave6-wire.ts', import.meta.url));
const SKILLS_MIRROR = fileURLToPath(new URL('../src/api/skills-wire.ts', import.meta.url));
const INSTALLED = fileURLToPath(new URL('../node_modules/wicked-crew-api-types/index.d.ts', import.meta.url));
const INSTALLED_PKG = fileURLToPath(new URL('../node_modules/wicked-crew-api-types/package.json', import.meta.url));
const PINNED_PKG = fileURLToPath(new URL('../package.json', import.meta.url));

/** The version the wave-6 wire publishes under — the mirror's floor. */
const WAVE6_VERSION = [0, 36, 0] as const;

const LABEL = /^wicked-crew-api-types@(\S+) index\.d\.ts:(\d+)-(\d+) /;
const BEGIN = /^\/\/ >>> VERBATIM (.+)$/;
const END = '// <<< VERBATIM';
const GAPS_BANNER = '// ── WIRE GAPS — PROVISIONAL';

function semver(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (m === null) throw new Error(`not a semver: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function atLeast(v: string, floor: readonly [number, number, number]): boolean {
  const [a, b, c] = semver(v);
  if (a !== floor[0]) return a > floor[0];
  if (b !== floor[1]) return b > floor[1];
  return c >= floor[2];
}

/** The marked regions of a file: `{ label, body }` per `>>> … <<<` pair, in order. */
function regions(path: string): Array<{ label: string; body: string }> {
  const out: Array<{ label: string; body: string }> = [];
  let open: { label: string; lines: string[] } | null = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const begin = BEGIN.exec(line);
    if (begin !== null) {
      if (open !== null) throw new Error(`${path}: a VERBATIM region opens inside another (${open.label})`);
      open = { label: begin[1]!, lines: [] };
      continue;
    }
    if (line === END) {
      if (open === null) throw new Error(`${path}: a VERBATIM region closes with none open`);
      out.push({ label: open.label, body: open.lines.join('\n') });
      open = null;
      continue;
    }
    if (open !== null) open.lines.push(line);
  }
  if (open !== null) throw new Error(`${path}: the VERBATIM region ${open.label} never closes`);
  return out;
}

const installed = JSON.parse(readFileSync(INSTALLED_PKG, 'utf8')) as { version: string };
const pinned = (JSON.parse(readFileSync(PINNED_PKG, 'utf8')) as { devDependencies: Record<string, string> }).devDependencies['wicked-crew-api-types']!;
const mirror = readFileSync(MIRROR, 'utf8');
const installedDts = readFileSync(INSTALLED, 'utf8');
const rs = regions(MIRROR);
const regionText = rs.map((r) => r.body).join('\n');
const gapsAt = mirror.indexOf(GAPS_BANNER);

/** Studio's own spellings — the constants the surfaces speak; asserted present in the mirror. */
const STUDIO_CONSTANTS = [
  "QE_AUTHOR_TESTS_WORKFLOW_ID = 'qe-author-tests'",
  `WORKER_REMOTE_WRITE_REMEDY = "delivery is performed by the run's deliver phase"`,
];

/** Every wave-6 declaration the briefs name, spelled as 0.36.0 PUBLISHES it — each must live inside
 *  a VERBATIM region of the mirror. */
const WAVE6_DECLS = [
  // POST /testing/author + the registered test set
  "export type QeAuthorTestsWorkflowId = 'qe-author-tests';",
  'export interface TestingAuthorBody {',
  'export interface TestingAuthorResponse {',
  'export interface WorkflowPlan {',
  'export interface TestingAuthorRun {',
  'export interface TestSet {',
  'test_sets?: TestSet[];',
  'export interface TestingReconBody {',
  // GET /runs/:id/diff
  "source?: 'worktree' | 'branch';",
  // gateEvaluated
  'ungated?: boolean;',
  'ungatedReason?: string | null;',
  'floorNote?: string | null;',
  'judgeSkippedReason?: string | null;',
  // repoChecksEvaluated
  'sandboxLevel?: string;',
  'sandboxError?: string | null;',
  'detectError?: string | null;',
  // unitDistributed — camelCase
  'export interface UnitDistributedEvent {',
  "routingMethod: 'council' | 'degraded' | 'evaluator_distinct' | 'tool';",
  'agreementPct: number | null;',
  'seated: number | null;',
  'degradedReason: string | null;',
  'seatConstraint: string | null;',
  // workerToolCallDenied
  "type: 'workerToolCallDenied';",
  "carrier: 'acp' | 'wrapped_cli' | (string & {});",
  "role: 'creator' | 'evaluator' | 'neutral' | (string & {});",
  'tool: string;',
  'command: string;',
  'remedy: string;',
  // acpFallback auth kinds
  "| 'auth_failed'",
  "| 'unauthenticated'",
  // runBaseResolved
  'runBranch?: string;',
  // roster
  'auth?: SeatAuth;',
  "auth_source?: 'seat-stderr';",
  "free_tier_source?: 'registry' | 'crew-heuristic';",
  'council_eligible?: boolean;',
  'council_bench?: RosterSeatCouncilBench;',
  // chat refused[]
  "export type ChatRefusalSource = 'auth' | 'scope' | 'bench' | 'budget' | 'engine' | (string & {});",
  'refused?: ChatSeatRefusal[];',
  'refused?: ChatSeatRefusal[] | null;',
  // GET /interactive/docs
  'export interface InteractiveDocsListing {',
  'export interface InteractiveDocIndexRow {',
  'unreachable: InteractiveDocsUnreachable[];',
];

/** The wave-6 SKILLS additions live in the skills block, vendored by `skills-wire.ts`. */
const WAVE6_SKILLS_DECLS = [
  "| 'skills.stale-rules';",
  'export interface PortabilityRulesIdentity {',
  'export interface SnapshotRowDrift {',
  'drift?: SnapshotRowDrift[];',
];

describe('src/api/wave6-wire.ts — the wave-6 mirror against the installed contract', () => {
  it('the devDependency is an exact pin equal to the installed version, at or above the wave-6 floor', () => {
    expect(pinned).toBe(installed.version);
    expect(atLeast(installed.version, WAVE6_VERSION), `${installed.version} ≥ 0.36.0`).toBe(true);
  });

  it('carries the MIRROR header naming the contract and the release swap; PROVISIONAL only in the wire-gaps section', () => {
    const head = mirror.slice(0, 400);
    expect(head).toContain(`MIRROR of the wicked-crew-api-types ${installed.version} wave-6 additions`);
    expect(head).toContain('replace with imports from the');
    expect(gapsAt, 'the wire-gaps section exists').toBeGreaterThan(0);
    expect(mirror.slice(0, gapsAt)).not.toContain('PROVISIONAL');
  });

  it('every VERBATIM region is byte-equal to the INSTALLED package at the labelled line range, and the label names the pinned version', () => {
    expect(rs.length, 'the regions').toBeGreaterThanOrEqual(14);
    const lines = installedDts.split('\n');
    for (const { label, body } of rs) {
      const m = LABEL.exec(label);
      expect(m, `label names a version and a line range: ${label}`).not.toBeNull();
      const [, version, from, to] = m!;
      expect(version, label).toBe(installed.version);
      expect(body, label).toBe(lines.slice(Number(from) - 1, Number(to)).join('\n'));
    }
  });

  it('every wave-6 declaration lives INSIDE a VERBATIM region (F-6), spelled as the package publishes it', () => {
    for (const name of WAVE6_DECLS) expect(regionText, `${name} inside a VERBATIM region`).toContain(name);
    for (const name of WAVE6_DECLS) expect(installedDts, `${name} declared by ${installed.version}`).toContain(name);
  });

  it('spells the constants studio speaks, exactly', () => {
    for (const name of STUDIO_CONSTANTS) expect(mirror, name).toContain(name);
  });

  it('the wave-6 SKILLS additions (stale-rules, current.rules / drift) are declared by the package and vendored by skills-wire.ts', () => {
    const skills = regions(SKILLS_MIRROR).map((r) => r.body).join('\n');
    for (const name of WAVE6_SKILLS_DECLS) {
      expect(installedDts, name).toContain(name);
      expect(skills, `${name} inside a skills-wire.ts VERBATIM region`).toContain(name);
    }
  });

  it('WIRE GAP 1 — a row-level `test_set` join / `TestSetRegistration` is NOT declared by the package; the mirror keeps it provisional', () => {
    expect(installedDts).not.toMatch(/\btest_set\b/);
    expect(installedDts).not.toContain('TestSetRegistration');
    // The package serves the sets at the list level instead — vendored, so the gap is legible.
    expect(regionText).toContain('test_sets?: TestSet[];');
    const gaps = mirror.slice(gapsAt);
    expect(gaps).toContain('export interface TestSetRegistration {');
    expect(gaps).toContain('test_set?: TestSetRegistration | null;');
  });

  it('WIRE GAP 2 — `TestingReconBody` declares no `workflow` key; the mirror keeps the ladder rung provisional', () => {
    const recon = rs.find((r) => r.label.includes('TestingReconBody'));
    expect(recon, 'the TestingReconBody region').toBeDefined();
    expect(recon!.body).toContain('export interface TestingReconBody {');
    expect(recon!.body).not.toContain('workflow');
    expect(mirror.slice(gapsAt)).toContain('export interface TestingReconWorkflowBody {');
  });
});

describe('the null-safe readers — an older daemon\'s frame changes nothing', () => {
  const bare = { type: 'gateEvaluated', session: 'r' } as never;
  it('gate: ungated false / reason null on a frame without the keys; true only on an explicit true', () => {
    expect(gateUngated(bare)).toBe(false);
    expect(gateUngatedReason(bare)).toBeNull();
    expect(gateUngated({ type: 'gateEvaluated', session: 'r', ungated: 'yes' } as never)).toBe(false);
    expect(gateUngated({ type: 'gateEvaluated', session: 'r', ungated: true } as never)).toBe(true);
    expect(gateUngatedReason({ type: 'gateEvaluated', session: 'r', ungatedReason: '' } as never)).toBeNull();
  });
  it('distribution: the camelCase spelling ONLY — the deprecated snake_case aliases the engine never emitted are not read', () => {
    expect(distributionDegradedReason(bare)).toBeNull();
    expect(distributionAgreementPct(bare)).toBeNull();
    expect(distributionDegradedReason({ type: 'unitDistributed', session: 'r', degradedReason: 'y' } as never)).toBe('y');
    expect(distributionDegradedReason({ type: 'unitDistributed', session: 'r', degraded_reason: 'x' } as never)).toBeNull();
    expect(distributionDegradedReason({ type: 'unitDistributed', session: 'r', degradedReason: null, degraded_reason: 'x' } as never)).toBeNull();
    expect(distributionAgreementPct({ type: 'unitDistributed', session: 'r', agreementPct: 66 } as never)).toBe(66);
    expect(distributionAgreementPct({ type: 'unitDistributed', session: 'r', agreement_pct: 50 } as never)).toBeNull();
    expect(distributionAgreementPct({ type: 'unitDistributed', session: 'r', agreementPct: Number.NaN } as never)).toBeNull();
  });
  it('diff: only the two declared sources; anything else (absent, a newer token) is null', () => {
    expect(diffSource({ diff: '', truncated: false })).toBeNull();
    expect(diffSource({ diff: '', truncated: false, source: 'branch' })).toBe('branch');
    expect(diffSource({ diff: '', truncated: false, source: 'worktree' })).toBe('worktree');
    expect(diffSource({ diff: '', truncated: false, source: 'bundle' } as never)).toBeNull();
  });
  it('the constants studio speaks', () => {
    expect(QE_AUTHOR_TESTS_WORKFLOW_ID).toBe('qe-author-tests');
    expect(WORKER_REMOTE_WRITE_REMEDY).toBe("delivery is performed by the run's deliver phase");
    expect(testSetOf(null)).toBeNull();
  });
});
