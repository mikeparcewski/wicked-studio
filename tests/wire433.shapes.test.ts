// @vitest-environment node
// (a pure filesystem + type-pin suite: the suite-wide jsdom env rewrites import.meta.url to an
// http: origin, and nothing here renders)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  AcpFallbackEvent,
  DeliverLiftEvaluatedEvent,
  EvaluatorMutatedWorktreeEvent,
  EvaluatorToolCallDeniedEvent,
  GateEvaluatedEvent,
  RepoChecksEvaluatedEvent,
  RunBaseResolvedEvent,
  StepFailedEvent,
  WorktreeRestoredEvent,
} from '../src/api/types.js';
import {
  DELIVER_REVERIFY_CHANGED_TREE,
  DELIVER_REVERIFY_FAIL,
  DELIVER_REVERIFY_PASS,
  GATE_DELIVER_PASS,
  GATE_DENY_RESTORED,
  LIFT_CONFLICT,
  LIFT_FAILED,
  LIFT_LIFTED,
  LIFT_SKIPPED,
  LIFT_UNCHANGED,
  MUTATION_RESTORED,
  READ_ONLY_REROUTE,
  RUN_BASE_AT_TIP,
  RUN_BASE_FETCH_FAILED,
  RUN_BASE_LIFTED,
  RUN_BASE_LOCAL_KEPT,
  RUN_BASE_NO_REMOTE,
  STEP_FAILED_APPLY,
  STEP_FAILED_CHANGED_TREE,
  STEP_FAILED_CONFLICT,
  STEP_FAILED_REVERIFY,
  STEP_FAILED_WRONG_HEAD,
  TOOL_DENIED,
  TOOL_DENIED_KINDLESS,
  WORKTREE_RESTORED,
  type Wire,
} from './fixtures/wire433.js';

/**
 * wire433.shapes — the fixtures ARE `wicked-crew-api-types` 0.33.0's declared shapes (wicked-core#431 /
 * wicked-crew#527; F-3R2-013).
 *
 * Two pins, one per compiler. COMPILE-TIME: every #431 frame in `fixtures/wire433.ts` is declared
 * `satisfies` its named type (excess keys fail there), and the `pinned` table below assigns each frame
 * to that type again (a missing key, a tightened nullability or a token outside a union fails here) —
 * `tsc --noEmit` covers `tests/`, so either drift is a red `npm run typecheck`. RUN-TIME: this suite
 * reads the INSTALLED `index.d.ts`, extracts each declaration's key set and each union's tokens, and
 * diffs the frames against them — "every key present, `null` never absent, nothing the wire does not
 * declare" is re-derived from the package the lockfile resolved, not from a hand-copied list that
 * would drift silently on the next pin.
 */

const PKG_ROOT = new URL('../', import.meta.url);
const DTS = readFileSync(fileURLToPath(new URL('node_modules/wicked-crew-api-types/index.d.ts', PKG_ROOT)), 'utf8');

/** The body of `export interface X {…}` / `export type X = {…}`, comments stripped. */
function declBody(name: string): string {
  const re = new RegExp(`^export (?:interface|type) ${name}(?:<[^>]*>)?\\s*=?\\s*\\{([\\s\\S]*?)^\\}`, 'm');
  const m = re.exec(DTS);
  if (m === null) throw new Error(`${name} is not declared in the installed wicked-crew-api-types index.d.ts`);
  return m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The property names a declaration lists (one per line, this package's style), sorted. */
function declaredKeys(name: string): string[] {
  return [...declBody(name).matchAll(/^\s+([A-Za-z_]\w*)\??:/gm)].map((m) => m[1]!).sort();
}

/** The `type: '<token>'` discriminant a frame declaration carries. */
function declaredType(name: string): string {
  const m = /^\s+type: '([A-Za-z]+)';/m.exec(declBody(name));
  if (m === null) throw new Error(`${name} declares no \`type\` discriminant`);
  return m[1]!;
}

/** The quoted tokens of a string-literal union (`export type X = | 'a' | 'b' | (string & {})`), sorted. */
function unionTokens(name: string): string[] {
  const re = new RegExp(`^export type ${name} =([\\s\\S]*?);`, 'm');
  const m = re.exec(DTS);
  if (m === null) throw new Error(`${name} is not declared in the installed wicked-crew-api-types index.d.ts`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
}

type Frame = { type: string } & Record<string, unknown>;
const ENVELOPE = new Set(['seq', 'ts']);
const wireKeys = (frame: Record<string, unknown>): string[] => Object.keys(frame).filter((k) => !ENVELOPE.has(k)).sort();

/** Every #431 frame the fixture ships, by the 0.33.0 declaration it must match. */
const pinned: Record<string, ReadonlyArray<Frame>> = {
  GateEvaluatedEvent: [GATE_DENY_RESTORED, GATE_DELIVER_PASS] satisfies Wire<GateEvaluatedEvent>[],
  EvaluatorMutatedWorktreeEvent: [MUTATION_RESTORED] satisfies Wire<EvaluatorMutatedWorktreeEvent>[],
  WorktreeRestoredEvent: [WORKTREE_RESTORED] satisfies Wire<WorktreeRestoredEvent>[],
  DeliverLiftEvaluatedEvent: [LIFT_UNCHANGED, LIFT_LIFTED, LIFT_CONFLICT, LIFT_SKIPPED, LIFT_FAILED] satisfies Wire<DeliverLiftEvaluatedEvent>[],
  RepoChecksEvaluatedEvent: [DELIVER_REVERIFY_PASS, DELIVER_REVERIFY_FAIL, DELIVER_REVERIFY_CHANGED_TREE] satisfies Wire<RepoChecksEvaluatedEvent>[],
  StepFailedEvent: [STEP_FAILED_CONFLICT, STEP_FAILED_APPLY, STEP_FAILED_WRONG_HEAD, STEP_FAILED_REVERIFY, STEP_FAILED_CHANGED_TREE] satisfies Wire<StepFailedEvent>[],
  RunBaseResolvedEvent: [RUN_BASE_LIFTED, RUN_BASE_AT_TIP, RUN_BASE_LOCAL_KEPT, RUN_BASE_NO_REMOTE, RUN_BASE_FETCH_FAILED] satisfies Wire<RunBaseResolvedEvent>[],
  EvaluatorToolCallDeniedEvent: [TOOL_DENIED, TOOL_DENIED_KINDLESS] satisfies Wire<EvaluatorToolCallDeniedEvent>[],
  AcpFallbackEvent: [READ_ONLY_REROUTE] satisfies Wire<AcpFallbackEvent>[],
};

describe('wire433 fixtures — the shapes wicked-crew-api-types 0.33.0 declares', () => {
  it('the pin is exact (no range) and the installed package is the pinned one', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', PKG_ROOT)), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    const installed = JSON.parse(
      readFileSync(fileURLToPath(new URL('node_modules/wicked-crew-api-types/package.json', PKG_ROOT)), 'utf8'),
    ) as { version: string };
    const pin = pkg.devDependencies['wicked-crew-api-types'];
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed.version).toBe(pin);
    // The #431 frames arrived in 0.33.0 — anything older cannot declare what the fixtures satisfy.
    const [major, minor] = installed.version.split('.').map(Number) as [number, number, number];
    expect(major > 0 || minor >= 33).toBe(true);
  });

  for (const [name, frames] of Object.entries(pinned)) {
    it(`${name}: every frame carries exactly the declared keys, each present (null, never absent)`, () => {
      const keys = declaredKeys(name);
      expect(keys.length).toBeGreaterThan(3);
      const token = declaredType(name);
      for (const frame of frames) {
        expect(frame.type).toBe(token);
        expect(wireKeys(frame)).toEqual(keys);
        expect(Object.values(frame).some((v) => v === undefined)).toBe(false);
        expect(typeof frame['seq']).toBe('number');
        expect(typeof frame['ts']).toBe('number');
      }
    });
  }

  it('nested records match their declarations: RepoCheckRun rows, UnitDenial, WorktreeChangedPath', () => {
    const runKeys = declaredKeys('RepoCheckRun');
    expect(runKeys).toContain('source');
    for (const floor of pinned['RepoChecksEvaluatedEvent']!) {
      for (const row of floor['checks'] as ReadonlyArray<Record<string, unknown>>) {
        expect(Object.keys(row).sort()).toEqual(runKeys);
        expect(Object.values(row).some((v) => v === undefined)).toBe(false);
      }
    }
    expect(Object.keys(GATE_DENY_RESTORED.denial).sort()).toEqual(declaredKeys('UnitDenial'));
    expect(unionTokens('UnitDenialSource')).toContain(GATE_DENY_RESTORED.denial.source);
    const pathKeys = declaredKeys('WorktreeChangedPath');
    for (const row of [...MUTATION_RESTORED.changed, ...WORKTREE_RESTORED.discarded]) {
      expect(Object.keys(row).sort()).toEqual(pathKeys);
    }
  });

  it('the unions declare every token the fixtures use — including the lift `failed` and the read-only reroute', () => {
    const outcomes = unionTokens('DeliverLiftOutcome');
    expect(outcomes).toEqual(['conflict', 'failed', 'lifted', 'skipped', 'unchanged']);
    for (const lift of pinned['DeliverLiftEvaluatedEvent']!) expect(outcomes).toContain(lift['outcome']);
    const kinds = unionTokens('AcpFallbackKind');
    expect(kinds).toContain('read_only_requires_wrapped');
    expect(kinds).toContain('governance_requires_wrapped');
    expect(kinds).toContain(READ_ONLY_REROUTE.fallbackKind);
    // `failureKind` is declared `string`; the engine's tokens are its `StepFailureKind` variants.
    for (const failed of pinned['StepFailedEvent']!) {
      expect(['workerError', 'environmentRefused', 'substanceRejected']).toContain(failed['failureKind']);
    }
  });

  it('the nullabilities the surfaces lean on are the declared ones', () => {
    const gate = declBody('GateEvaluatedEvent');
    expect(gate).toMatch(/^\s+judgeCli: string \| null;/m);
    expect(gate).toMatch(/^\s+judgeDistinct: boolean \| null;/m);
    const mutation = declBody('EvaluatorMutatedWorktreeEvent');
    expect(mutation).toMatch(/^\s+restored: boolean;/m);
    expect(mutation).toMatch(/^\s+restoreError: string \| null;/m);
    const restored = declBody('WorktreeRestoredEvent');
    expect(restored).toMatch(/^\s+head: string \| null;/m);
    expect(restored).toMatch(/^\s+discarded: WorktreeChangedPath\[\];/m);
    expect(restored).toMatch(/^\s+suggestionRef: string \| null;/m);
    const lift = declBody('DeliverLiftEvaluatedEvent');
    for (const k of ['baseRef', 'baseBefore', 'baseAfter', 'treeBefore', 'treeAfter', 'note']) {
      expect(lift).toMatch(new RegExp(`^\\s+${k}: string \\| null;`, 'm'));
    }
    expect(lift).toMatch(/^\s+conflicts: string\[\];/m);
    const base = declBody('RunBaseResolvedEvent');
    expect(base).toMatch(/^\s+baseRef: string \| null;/m);
    expect(base).toMatch(/^\s+baseCommit: string;/m);
    expect(base).not.toMatch(/^\s+ord\??:/m); // session-level: no ord
    const denied = declBody('EvaluatorToolCallDeniedEvent');
    expect(denied).toMatch(/^\s+kind: string \| null;/m);
    expect(denied).toMatch(/^\s+path: string \| null;/m);
    // `CoreEvent.kind` widened to `string | null` with this frame — why TOOL_DENIED_KINDLESS is a plain
    // literal and not a cast.
    expect(declBody('CoreEvent')).toMatch(/^\s+kind\?: string \| null;/m);
    expect(declBody('StepFailedEvent')).toMatch(/^\s+failureKind: string;/m);
    // The evidence union the gate card folds names all five frames.
    const evidence = unionTokens('GateEvidenceEvent');
    expect(evidence).toEqual([]); // a type union, not string literals — the members are checked below
    const evidenceDecl = /^export type GateEvidenceEvent =([\s\S]*?);/m.exec(DTS)![1]!;
    for (const member of [
      'EvaluatorMutatedWorktreeEvent',
      'RepoChecksEvaluatedEvent',
      'WorktreeRestoredEvent',
      'DeliverLiftEvaluatedEvent',
      'EvaluatorToolCallDeniedEvent',
    ]) {
      expect(evidenceDecl).toContain(member);
    }
  });
});
