/**
 * The wave-6 wire MIRROR (`src/api/wave6-wire.ts`) against the INSTALLED `wicked-crew-api-types`.
 *
 * The #257 parity pattern (`tests/skillsWire.test.ts`), in two postures keyed on the pin:
 *
 *  - PROVISIONAL (pin < 0.36.0 — the wire is not published yet): the mirror's header says
 *    PROVISIONAL, none of the wave-6 names exist in the installed `index.d.ts` (so studio cannot
 *    be silently reading a shape the pinned contract already declares differently), the readers
 *    are null-safe on a frame without the keys, and every name the wave-6 briefs give is spelled
 *    in the mirror exactly.
 *  - PINNED (pin ≥ 0.36.0): the mirror MUST have been re-vendored — VERBATIM regions between
 *    `>>> VERBATIM wicked-crew-api-types@<v> index.d.ts:<from>-<to> …` / `<<< VERBATIM` markers,
 *    each byte-equal to the installed package at the labelled line range — and the PROVISIONAL
 *    header must be gone. A pin bump without the re-vendor fails HERE.
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
const INSTALLED = fileURLToPath(new URL('../node_modules/wicked-crew-api-types/index.d.ts', import.meta.url));
const INSTALLED_PKG = fileURLToPath(new URL('../node_modules/wicked-crew-api-types/package.json', import.meta.url));
const PINNED_PKG = fileURLToPath(new URL('../package.json', import.meta.url));

/** The version the wave-6 wire publishes under. */
const WAVE6_VERSION = [0, 36, 0] as const;

const LABEL = /^wicked-crew-api-types@(\S+) index\.d\.ts:(\d+)-(\d+) /;
const BEGIN = /^\/\/ >>> VERBATIM (.+)$/;
const END = '// <<< VERBATIM';

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
const pinnedAtWave6 = atLeast(installed.version, WAVE6_VERSION);

/** Every wave-6 name the briefs give — spelled once here, asserted present in the mirror. */
const WAVE6_NAMES = [
  "QE_AUTHOR_TESTS_WORKFLOW_ID = 'qe-author-tests'",
  'export interface TestingAuthorBody',
  'export interface TestingAuthorResponse',
  'export interface TestSetRegistration',
  "export type RunDiffSource = 'worktree' | 'branch'",
  'ungated?: boolean;',
  'ungatedReason?: string | null;',
  'degradedReason?: string | null;',
  'agreementPct?: number | null;',
  "type: 'workerToolCallDenied';",
  'role: string;',
  'command: string;',
  'remedy: string | null;',
];

describe('src/api/wave6-wire.ts — the wave-6 mirror against the installed contract', () => {
  it('the devDependency is an exact pin equal to the installed version', () => {
    expect(pinned).toBe(installed.version);
  });

  it('spells every name the wave-6 briefs give, exactly', () => {
    for (const name of WAVE6_NAMES) expect(mirror, name).toContain(name);
  });

  it(`posture: ${pinnedAtWave6 ? 'PINNED ≥ 0.36.0 — re-vendored VERBATIM regions, no PROVISIONAL header' : 'PROVISIONAL < 0.36.0 — the wave-6 names are NOT yet in the installed contract'}`, () => {
    if (!pinnedAtWave6) {
      expect(mirror.slice(0, 1200)).toContain('PROVISIONAL');
      // None of these are declared by the pinned contract yet — if one appears, the pin moved and
      // the mirror must be re-vendored against it (the other posture) rather than kept provisional.
      for (const name of ['workerToolCallDenied', 'ungatedReason', 'TestSetRegistration', 'TestingAuthorBody']) {
        expect(installedDts, `${name} declared by ${installed.version} — re-vendor the mirror`).not.toContain(name);
      }
      return;
    }
    expect(mirror.slice(0, 1200)).not.toContain('PROVISIONAL');
    const rs = regions(MIRROR);
    expect(rs.length, 'at least one VERBATIM region').toBeGreaterThan(0);
    const lines = installedDts.split('\n');
    for (const { label, body } of rs) {
      const m = LABEL.exec(label);
      expect(m, `label names a version and a line range: ${label}`).not.toBeNull();
      const [, version, from, to] = m!;
      expect(version, label).toBe(installed.version);
      expect(body, label).toBe(lines.slice(Number(from) - 1, Number(to)).join('\n'));
    }
    for (const name of ['workerToolCallDenied', 'ungatedReason', 'degradedReason']) {
      expect(installedDts, name).toContain(name);
    }
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
  it('distribution: camelCase first, snake_case fallback, null/absent → null', () => {
    expect(distributionDegradedReason(bare)).toBeNull();
    expect(distributionAgreementPct(bare)).toBeNull();
    expect(distributionDegradedReason({ type: 'unitDistributed', session: 'r', degraded_reason: 'x' } as never)).toBe('x');
    expect(distributionDegradedReason({ type: 'unitDistributed', session: 'r', degradedReason: 'y', degraded_reason: 'x' } as never)).toBe('y');
    expect(distributionAgreementPct({ type: 'unitDistributed', session: 'r', agreementPct: 66 } as never)).toBe(66);
    expect(distributionAgreementPct({ type: 'unitDistributed', session: 'r', agreement_pct: 50 } as never)).toBe(50);
    expect(distributionAgreementPct({ type: 'unitDistributed', session: 'r', agreementPct: Number.NaN } as never)).toBeNull();
  });
  it('diff: only the two declared sources; anything else (absent, a newer token) is null', () => {
    expect(diffSource({ diff: '', truncated: false })).toBeNull();
    expect(diffSource({ diff: '', truncated: false, source: 'branch' } as never)).toBe('branch');
    expect(diffSource({ diff: '', truncated: false, source: 'worktree' } as never)).toBe('worktree');
    expect(diffSource({ diff: '', truncated: false, source: 'bundle' } as never)).toBeNull();
  });
  it('the constants studio speaks', () => {
    expect(QE_AUTHOR_TESTS_WORKFLOW_ID).toBe('qe-author-tests');
    expect(WORKER_REMOTE_WRITE_REMEDY).toBe("delivery is performed by the run's deliver phase");
    expect(testSetOf(null)).toBeNull();
  });
});
