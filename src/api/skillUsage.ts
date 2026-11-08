/**
 * Skill usage (operator 2026-11-08: "we should be recording skills usage - that way we know which ones we can turn off
 * over time") — `GET /api/v1/skills/usage[?sinceGen=N]` (wicked-crew#1432 over wicked-core#1352).
 *
 * Read-only. It answers which skills seats use, by which CLI, how often (30 / 90 days) and when last, and which were
 * handed but not used since generation N. "Used" = the seat opened the skill (loaded its instructions), or ran one of
 * its scripts. `directed` (the step named it) and `browsed` (one command looked over many skills) are counted beside
 * it and are not use. A CLI whose use cannot be seen (copilot; opencode / agy on the host floor) is "not observable",
 * never "unused".
 *
 * THE TYPES: `SkillUsageResponse` ships in wicked-crew-api-types 0.198.0, which this studio does not pin yet (0.195.0).
 * They are mirrored here VERBATIM from crew#1432 until the pin moves (studio pins an earlier api-types); the swap is this
 * one block. Until then every answer is checked by {@link readSkillUsage} before anything renders it.
 */

import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';

// ── mirror of wicked-crew-api-types 0.198.0 (crew#1432) — replace with an import when the pin moves ──

export type SkillUsageSignal = 'directed' | 'opened' | 'browsed' | 'ran';

export interface SkillUsageCell {
  d30: number;
  d90: number;
  lastAt: number | null;
  lastGen: number | null;
}

export interface SkillUsageRow {
  name: string;
  enabled: boolean | null;
  introduced: { gen: number; seeded: boolean } | null;
  byCli: Record<string, { handedLastGen: number | null } & Record<SkillUsageSignal, SkillUsageCell>>;
  lastUsed: { at: number; gen: number | null; cli: string } | null;
  unusedSince: { all: boolean; byCli: string[]; notObservable: boolean };
}

export interface SkillUsageResponse {
  currentGen: number | null;
  recordingSince: { gen: number | null; at: number } | null;
  sinceGen: number | null;
  sinceGenClamped: boolean;
  observable: Record<string, { signals: SkillUsageSignal[]; note: string | null }>;
  skills: SkillUsageRow[];
  scripts: Array<{ script: string; owners: string[]; d30: number; d90: number; lastAt: number | null }>;
}

// ── end mirror ──

export const USAGE_SIGNALS: readonly SkillUsageSignal[] = ['opened', 'ran', 'directed', 'browsed'];

export const SIGNAL_LABEL: Record<SkillUsageSignal, string> = {
  opened: 'Opened',
  ran: 'Ran a script',
  directed: 'Told to use',
  browsed: 'Looked over',
};

/** Why usage is not shown: this crew has no such route (an older crew), or the read failed / did not validate. */
export type SkillUsageUnavailable = { unavailable: 'unsupported' | 'error' };

/** A read of the rollup gives up after this long (it is telemetry beside the catalog, never a blocker). */
export const USAGE_READ_TIMEOUT_MS = 20_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);

function isCell(v: unknown): boolean {
  return isObj(v) && isNum(v['d30']) && isNum(v['d90']) && isNumOrNull(v['lastAt']) && isNumOrNull(v['lastGen']);
}

function isRow(v: unknown): v is SkillUsageRow {
  if (!isObj(v) || typeof v['name'] !== 'string' || !isObj(v['byCli']) || !isObj(v['unusedSince'])) return false;
  const u = v['unusedSince'];
  if (typeof u['all'] !== 'boolean' || typeof u['notObservable'] !== 'boolean' || !Array.isArray(u['byCli'])) return false;
  const last = v['lastUsed'];
  if (last !== null && !(isObj(last) && isNum(last['at']) && typeof last['cli'] === 'string')) return false;
  const intro = v['introduced'];
  if (intro !== null && intro !== undefined && !(isObj(intro) && isNum(intro['gen']))) return false;
  return Object.values(v['byCli']).every((c) => isObj(c) && USAGE_SIGNALS.every((s) => isCell(c[s])));
}

/** The rollup, checked field by field against what the page renders; `null` when it does not hold. */
export function readSkillUsage(body: unknown): SkillUsageResponse | null {
  if (!isObj(body) || !Array.isArray(body['skills']) || !isObj(body['observable']) || !isNumOrNull(body['sinceGen'] ?? null)) return null;
  if (!body['skills'].every(isRow)) return null;
  const rs = body['recordingSince'];
  if (rs !== null && rs !== undefined && !(isObj(rs) && isNum(rs['at']))) return null;
  const scripts = Array.isArray(body['scripts']) ? body['scripts'] : [];
  return { ...(body as unknown as SkillUsageResponse), recordingSince: (rs ?? null) as SkillUsageResponse['recordingSince'], scripts: scripts as SkillUsageResponse['scripts'] };
}

/** The usage rollup, or why it is not shown: `unsupported` for a crew without the route (404 / 501), `error` for any
 *  other failure, a timeout or an answer that does not validate. Never throws. */
export async function getSkillUsage(sinceGen?: number): Promise<SkillUsageResponse | SkillUsageUnavailable> {
  const q = sinceGen === undefined ? '' : `?sinceGen=${encodeURIComponent(String(sinceGen))}`;
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(USAGE_READ_TIMEOUT_MS) : undefined;
    const body = await apiFetch<unknown>(`/skills/usage${q}`, signal === undefined ? undefined : { signal });
    return readSkillUsage(body) ?? { unavailable: 'error' };
  } catch (e) {
    if (isRouteUnsupported(e)) return { unavailable: 'unsupported' };
    return { unavailable: 'error' };
  }
}

export function isUsageUnavailable(v: SkillUsageResponse | SkillUsageUnavailable | undefined): v is SkillUsageUnavailable {
  return v !== undefined && 'unavailable' in v;
}

const FAMILY_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  agy: 'Antigravity',
  copilot: 'GitHub Copilot',
  opencode: 'opencode',
};

/** A seat key's CLI family and its own suffix (`codex-2` → `codex`, `2`; separators `-`, `#`, `_`). */
export function cliFamily(cli: string): { family: string; suffix: string } {
  const k = cli.toLowerCase();
  for (const f of Object.keys(FAMILY_LABEL)) {
    if (k === f) return { family: f, suffix: '' };
    if (k.startsWith(f) && ['-', '#', '_'].includes(k.charAt(f.length))) return { family: f, suffix: cli.slice(f.length + 1) };
  }
  return { family: k, suffix: '' };
}

/** A seat key as a person reads it (`codex` → `Codex`, `codex-2` → `Codex (2)`, `claude` → `Claude Code`). */
export function cliLabel(cli: string): string {
  const { family, suffix } = cliFamily(cli);
  if (!Object.hasOwn(FAMILY_LABEL, family)) return cli;
  const label = FAMILY_LABEL[family] as string;
  return suffix === '' ? label : `${label} (${suffix})`;
}

/** Uses (opened + ran) in the window, across CLIs. */
export function usesIn(row: SkillUsageRow, window: 'd30' | 'd90'): number {
  return Object.values(row.byCli).reduce((n, c) => n + c.opened[window] + c.ran[window], 0);
}

/** What a row says about a skill's use, in one short phrase. */
export type UsageVerdict =
  | { kind: 'used'; at: number; cli: string }
  | { kind: 'unused'; sinceGen: number | null }
  | { kind: 'not-observable' }
  | { kind: 'not-handed' };

export function usageVerdict(row: SkillUsageRow | undefined, sinceGen: number | null): UsageVerdict {
  if (row === undefined) return { kind: 'not-handed' };
  if (row.unusedSince.all) return { kind: 'unused', sinceGen };
  if (row.lastUsed !== null) return { kind: 'used', at: row.lastUsed.at, cli: row.lastUsed.cli };
  if (row.unusedSince.notObservable) return { kind: 'not-observable' };
  return { kind: 'not-handed' };
}

/** The per-skill lookup a page holds. */
export function usageByName(res: SkillUsageResponse | null): Map<string, SkillUsageRow> {
  return new Map((res?.skills ?? []).map((r) => [r.name, r]));
}
