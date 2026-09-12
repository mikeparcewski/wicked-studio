/**
 * The deliver-gate wire (api-types 0.37.0 — crew#543 / wicked-core#456, acceptance finding F-E2E-030)
 * against the INSTALLED `wicked-crew-api-types`.
 *
 * Studio 0.5.9-pre (#269) hand-declared three "≥ 0.37" shapes while 0.37.0 was unpublished:
 * `GET /health`'s `capabilities.deliverGate` (in `src/api/client.ts`), `LaunchRunBody.deliverGate`
 * (on `LaunchBodyWithDeliver` in `src/api/types.ts`) and the `session.auto_deliver` read. At the pin
 * they come from the package — so, the `wire433.shapes` pattern, two pins, one per compiler.
 * COMPILE-TIME: the literals below are declared `satisfies` the package's own types (a lost or
 * re-spelled key is a red `npm run typecheck`). RUN-TIME: the installed `index.d.ts` must declare
 * each shape at its 0.37.0 spelling, the pin must be exact and ≥ 0.37.0, and the hand-declared
 * copies must be GONE — a pin bump that regresses below the deliver-gate wire, or a re-mint that
 * drops a key, fails here and says which.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { AgentSession, HealthResponse, LaunchBodyWithDeliver, LaunchRunBody } from '../src/api/types.js';

const INSTALLED = fileURLToPath(new URL('../node_modules/wicked-crew-api-types/index.d.ts', import.meta.url));
const INSTALLED_PKG = fileURLToPath(new URL('../node_modules/wicked-crew-api-types/package.json', import.meta.url));
const PINNED_PKG = fileURLToPath(new URL('../package.json', import.meta.url));
const CLIENT_SRC = fileURLToPath(new URL('../src/api/client.ts', import.meta.url));
const TYPES_SRC = fileURLToPath(new URL('../src/api/types.ts', import.meta.url));

/** The version that published the deliver-gate wire — this suite's floor. */
const DELIVER_GATE_VERSION = [0, 37, 0] as const;

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

// ── COMPILE-TIME pins — spelled as 0.37.0 publishes them ──────────────────────────────────────

/** A crew ≥ 0.7.33 daemon whose engine (core-ts ≥ 0.7.24) knows the deliver gate. */
const HEALTH_GATED = { status: 'ok', version: '0.7.33', ping: 'pong', capabilities: { deliverGate: true } } satisfies HealthResponse;
/** A daemon before the capability — `capabilities` absent; delivery follows verify unattended. */
const HEALTH_OLDER = { status: 'ok', version: '0.7.32', ping: 'pong' } satisfies HealthResponse;
/** The composer's explicit opt-out (the "No gates · auto-deliver" / Autonomous postures). */
const LAUNCH_AUTO = { problem: 'fix the flaky test', repoRef: 'r', deliver: 'pr', deliverGate: 'auto' } satisfies LaunchRunBody;
/** The default posture spelled out — the engine gates the push whatever `humanConfirm` says. */
const LAUNCH_HUMAN = { problem: 'fix the flaky test', humanConfirm: 'none', deliverGate: 'human' } satisfies LaunchRunBody;
/** Studio's launch body keeps the key through the `Omit<LaunchRunBody, 'deliver'>` — no hand-declaration. */
const STUDIO_BODY: LaunchBodyWithDeliver = { problem: 'fix the flaky test', deliver: 'none', deliverGate: 'auto' };
/** The run DTO's posture (`false` = the engine pauses before the deliver Tool unit). */
const SESSION_GATED: Pick<AgentSession, 'auto_deliver'> = { auto_deliver: false };
const SESSION_PREDATES: Pick<AgentSession, 'auto_deliver'> = {};

/** 0.37.0's declaration lines, verbatim — each must be in the installed `index.d.ts`. */
const DECLS = [
  'export interface HealthResponse {',
  '  capabilities?: { deliverGate: boolean };',
  '  auto_deliver?: boolean;',
  "  deliverGate?: 'human' | 'auto';",
];

const installed = JSON.parse(readFileSync(INSTALLED_PKG, 'utf8')) as { version: string };
const pinned = (JSON.parse(readFileSync(PINNED_PKG, 'utf8')) as { devDependencies: Record<string, string> }).devDependencies['wicked-crew-api-types']!;
const installedDts = readFileSync(INSTALLED, 'utf8');

describe('the deliver-gate wire (api-types 0.37.0) — declared by the installed package, not by studio', () => {
  it('the devDependency is an exact pin equal to the installed version, at or above the deliver-gate floor', () => {
    expect(pinned).toBe(installed.version);
    expect(atLeast(installed.version, DELIVER_GATE_VERSION), `${installed.version} ≥ 0.37.0`).toBe(true);
  });

  it('declares HealthResponse.capabilities.deliverGate, AgentSession.auto_deliver and LaunchRunBody.deliverGate at their 0.37.0 spelling', () => {
    for (const line of DECLS) expect(installedDts, line).toContain(line);
    // Each lives in the interface it belongs to.
    const between = (from: string, to: RegExp): string => {
      const start = installedDts.indexOf(from);
      expect(start, from).toBeGreaterThanOrEqual(0);
      const rest = installedDts.slice(start);
      return rest.slice(0, rest.search(to));
    };
    expect(between('export interface HealthResponse {', /\n}\n/)).toContain('capabilities?: { deliverGate: boolean };');
    expect(between('export interface AgentSession {', /\n}\n/)).toContain('auto_deliver?: boolean;');
    expect(between('export interface LaunchRunBody {', /\n}\n/)).toContain("deliverGate?: 'human' | 'auto';");
  });

  it('the hand-declared "≥ 0.37" copies are gone: client.ts reads HealthResponse, types.ts declares no deliverGate', () => {
    const client = readFileSync(CLIENT_SRC, 'utf8');
    expect(client).toContain("getHealth: () => apiFetch<HealthResponse>('/health'),");
    expect(client).not.toContain('capabilities?: { deliverGate?: boolean }');
    const types = readFileSync(TYPES_SRC, 'utf8');
    const launchBody = types.slice(types.indexOf('export type LaunchBodyWithDeliver ='));
    expect(launchBody.slice(0, launchBody.indexOf('\n};\n'))).not.toMatch(/^\s*deliverGate\??:/m);
  });

  it('the compile-time pins read back as the wire spells them', () => {
    expect(HEALTH_GATED.capabilities.deliverGate).toBe(true);
    expect('capabilities' in HEALTH_OLDER).toBe(false);
    expect(LAUNCH_AUTO.deliverGate).toBe('auto');
    expect(LAUNCH_HUMAN.deliverGate).toBe('human');
    expect(STUDIO_BODY.deliverGate).toBe('auto');
    expect(SESSION_GATED.auto_deliver).toBe(false);
    expect(SESSION_PREDATES.auto_deliver).toBeUndefined();
  });
});
