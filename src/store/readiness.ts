// The merged preflight / install-gate readiness model (DES-MERGE-001 §5.6, §4.9, slice 17).
//
// Studio's launch check and interactive's `InstallGate`/`preflight.js` fold into ONE model
// with three legs, all of which have to agree before the gate is allowed to say anything:
//
//   1. the crew daemon is reachable (studio's own connection status);
//   2. the interactive bridge is reachable or startable (crew's proxy answers, or answers
//      `503 bridge_unavailable` with a named fix command, §7.12);
//   3. per-dependency state as the SERVICE reports it — garden, ffmpeg, python-pptx, … —
//      normalized here, never re-probed by the browser.
//
// Two rules come straight out of the design and are the whole point of the fold:
//
//   · a HARD dependency (garden) blocks entering Document and Video, with the service's
//     install command carried verbatim (§3.3: an error with no next action is banned) and
//     a "Continue anyway" escape (§4.9, interactive #159);
//   · OPTIONAL dependencies NEVER gate. A missing ffmpeg or python-pptx degrades at
//     point-of-use — the storyboard still stands with the install command beside the
//     player (slice 13), the PPTX export answers a clean 400 with its hint (slice 15).
//     Gating the door on them would hide three working features behind one absent one.
//
// Chat and Build are never gated: neither touches the bridge (§1.3 — the modes are peers,
// and Build's governed run surface has nothing to do with the document service).
import { create } from 'zustand';
import type { Mode } from '../hooks/useRoute.js';

// ── The dependency model ────────────────────────────────────────────────────

/** One dependency, flattened to what the gate renders: is it there, and what installs it. */
export interface Dep {
  name: string;
  ok: boolean;
  /** The service's own install command, verbatim — retyping it would retype a command
   *  the user has to run. `null` when the service named none. */
  install: string | null;
  /** Whether its absence makes the mode unusable rather than degraded. */
  hard: boolean;
}

/**
 * Dependencies studio treats as hard when the service does not say. The service's own
 * `required`/`optional` flag always wins; this is the fallback, and it is deliberately
 * a SHORT list: everything not named here degrades at point-of-use.
 */
export const HARD_DEPS = new Set(['garden', 'wicked-garden']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function toDep(name: string, d: Record<string, unknown>): Dep {
  // An entry we cannot read reports OK. A gate that fires on a field it failed to parse
  // is a hard block on a working install; the point-of-use path still catches the real
  // absence (slices 13/15), so ambiguity resolves toward letting the user in.
  const ok = bool(d.ok) ?? bool(d.installed) ?? bool(d.present) ?? true;
  const optional = bool(d.optional);
  const required = bool(d.required) ?? (optional === null ? null : !optional);
  return {
    name,
    ok,
    install: text(d.install) ?? text(d.hint) ?? text(d.command),
    hard: required ?? HARD_DEPS.has(name),
  };
}

/**
 * `GET /api/preflight`'s body → the model. The service owns this vocabulary, so the
 * reader is tolerant by design: a `deps` map, a `deps` array of `{name, …}`, or the map
 * at the top level all normalize to the same list, and anything unreadable is dropped
 * rather than guessed at.
 */
export function normalizeDeps(wire: unknown): Dep[] {
  if (!isRecord(wire)) return [];
  const raw: unknown = wire.deps ?? wire;
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.map((d) => [isRecord(d) && typeof d.name === 'string' ? d.name : '', d])
    : isRecord(raw) ? Object.entries(raw) : [];
  return entries
    .filter((e): e is [string, Record<string, unknown>] => e[0] !== '' && isRecord(e[1]))
    .map(([name, d]) => toDep(name, d));
}

// ── The merged model, per project ───────────────────────────────────────────

export type BridgeState = 'unknown' | 'ready' | 'unavailable';

export interface ProjectReadiness {
  bridge: BridgeState;
  /** The 503's named fix command (§7.12), when the bridge could not be started. */
  bridgeHint: string | null;
  deps: Dep[];
  /** True once the user took the escape hatch, for this project, for this session. */
  continued: boolean;
}

/** Before preflight answers. Nothing is claimed, so nothing is blocked. */
export const UNKNOWN_READINESS: ProjectReadiness = {
  bridge: 'unknown', bridgeHint: null, deps: [], continued: false,
};

/** What the gate shows: the missing subject and the command that installs it. */
export interface Blocker {
  subject: string;
  install: string | null;
}

/** The modes that depend on the interactive service. Chat and Build never do (§1.3). */
export const GATED_MODES: readonly Mode[] = ['document', 'video'] as const;

/**
 * The hard dependencies standing between the user and this project's Document/Video mode.
 *
 * A bridge that cannot start is deliberately NOT here: that failure is recoverable by
 * retrying (crew starts the bridge on the next proxied request, §5.6) and the mode's own
 * surface already states its named fix with a Retry beside it (slice 8). The gate is for
 * the absence retrying cannot fix — a dependency the service reports missing.
 */
export function gateBlockers(r: ProjectReadiness, crewReachable: boolean): Blocker[] {
  if (r.continued || !crewReachable) return [];
  return r.deps
    .filter((d) => d.hard && !d.ok)
    .map((d) => ({ subject: d.name, install: d.install }));
}

/** As above, per mode: Chat and Build are never gated, whatever preflight reports. */
export function gateForMode(mode: Mode, r: ProjectReadiness, crewReachable: boolean): Blocker[] {
  return GATED_MODES.includes(mode) ? gateBlockers(r, crewReachable) : [];
}

/**
 * §1.3 rule 3: a mode that cannot open is disabled, never hidden, and states the ONE
 * action that enables it. Both unavailable legs surface here — a bridge that will not
 * start and a hard dependency that is absent — because both are answered by running a
 * command, which is what the tab has to name. `null` means the mode is available.
 */
export function enablingAction(mode: Mode, r: ProjectReadiness, crewReachable: boolean): string | null {
  if (!GATED_MODES.includes(mode) || r.continued || !crewReachable) return null;
  if (r.bridge === 'unavailable') {
    return r.bridgeHint ?? 'the document service is not running';
  }
  const [blocker] = gateBlockers(r, crewReachable);
  if (!blocker) return null;
  return blocker.install
    ? `needs ${blocker.subject} — ${blocker.install}`
    : `needs ${blocker.subject}`;
}

// ── The store ───────────────────────────────────────────────────────────────

interface ReadinessStore {
  /** Keyed by project: one project's absent garden says nothing about another's. */
  byProject: Record<string, ProjectReadiness>;
  /** Bumped by the gate's Re-check, so a just-run install lands without a reload. */
  attempt: number;
  report: (projectId: string, next: Partial<ProjectReadiness>) => void;
  continueAnyway: (projectId: string) => void;
  recheck: () => void;
}

export const useReadinessStore = create<ReadinessStore>((set) => ({
  byProject: {},
  attempt: 0,
  report: (projectId, next) => set((s) => ({
    byProject: {
      ...s.byProject,
      // Merged, never replaced: a re-check must not silently revoke the escape hatch
      // the user already took (§4.9 — "Continue anyway" lasts the session).
      [projectId]: { ...UNKNOWN_READINESS, ...s.byProject[projectId], ...next },
    },
  })),
  continueAnyway: (projectId) => set((s) => ({
    byProject: {
      ...s.byProject,
      [projectId]: { ...UNKNOWN_READINESS, ...s.byProject[projectId], continued: true },
    },
  })),
  recheck: () => set((s) => ({ attempt: s.attempt + 1 })),
}));

/** This project's readiness, or the inert unknown — never undefined, so no caller guards. */
export function useProjectReadiness(projectId: string): ProjectReadiness {
  return useReadinessStore((s) => s.byProject[projectId] ?? UNKNOWN_READINESS);
}
