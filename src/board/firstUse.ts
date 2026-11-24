import type { SystemSnapshot } from '../api/system.js';
import { helperNotInstalled, helperRuntimeDown } from './agentsCopy.js';
import { authOf, boundaryHolds, type AgentRow } from './agentsModel.js';

/** First use stays open until the live helper, skills, code map and runtime checks pass,
 * and there is somewhere to work. Only an explicit skip hides incomplete setup. */

/** `settings['studio.setup']` — a studio-owned key the daemon stores as-is. */
export interface SetupState { completedAt?: number; skippedAt?: number }

export const SETUP_KEY = 'studio.setup';

export function readSetup(settings: Record<string, unknown> | null | undefined): SetupState {
  const v = settings?.[SETUP_KEY];
  if (v === null || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  return {
    ...(typeof o['completedAt'] === 'number' ? { completedAt: o['completedAt'] } : {}),
    ...(typeof o['skippedAt'] === 'number' ? { skippedAt: o['skippedAt'] } : {}),
  };
}

export function setupSettled(s: SetupState, facts?: SetupFacts): boolean {
  // Landing decisions use the saved choice. The guide may reopen for a confirmed failure,
  // but an older service or a probe that did not answer cannot undo a completed setup.
  if (s.skippedAt !== undefined) return true;
  if (s.completedAt === undefined) return false;
  if (facts === undefined) return true;
  const checks = facts.checks;
  return checks?.skills !== false && checks?.estate !== false
    && !(checks?.runtimeRequired === true && checks.runtime === false);
}

export interface SetupChecks {
  skills: boolean | null;
  estate: boolean | null;
  runtime: boolean | null;
  runtimeRequired: boolean | null;
  /** studio#1363: what crew's skills seam is doing, for step 2's words (absent when diagnostics carried no skills block). */
  skillsReading?: SkillsReading;
}

/**
 * studio#1363: crew's skills state (`GET /diagnostics` `skills`) as step 2 and the Skills page say it. `publishing`: crew
 * publishes at boot, so there is nothing to do; `install`: wicked-garden is missing (`skills.fallback`) or too old
 * (`skills.garden`), with crew's install command; `published`: done; `todo`: anything else that still needs a publish.
 */
export type SkillsStage = 'published' | 'publishing' | 'install' | 'todo';
export interface SkillsReading {
  stage: SkillsStage;
  /** `install` only: crew's own command from its finding (`npx wicked-installer install wicked-garden`). */
  command: string | null;
  /** `install` only: no wicked-garden at all (`missing`), or one older than crew needs (`old`). */
  garden: 'missing' | 'old' | null;
}

/** crew's garden install or update command, as its finding words it (`plugin-source.ts` GARDEN_INSTALL_COMMAND /
 *  GARDEN_UPDATE_COMMAND). */
const GARDEN_COMMAND_RE = /\b(?:npx wicked-installer (?:install|update) wicked-garden|npm (?:i|install) -g wicked-garden(?:@[\w.-]+)?)/;

export function skillsReading(skills: unknown): SkillsReading | null {
  if (skills === null || typeof skills !== 'object') return null;
  const o = skills as Record<string, unknown>;
  const state = typeof o['state'] === 'string' ? o['state'] : null;
  if (state === null) return null;
  const findings = (Array.isArray(o['findings']) ? o['findings'] : [])
    .filter((f): f is Record<string, unknown> => f !== null && typeof f === 'object');
  if (state === 'publishing') return { stage: 'publishing', command: null, garden: null };
  const garden = findings.find((f) => f['kind'] === 'skills.fallback' || f['kind'] === 'skills.garden' && f['severity'] === 'error');
  const command = garden !== undefined && typeof garden['message'] === 'string' ? GARDEN_COMMAND_RE.exec(garden['message'])?.[0] ?? null : null;
  if (garden !== undefined && command !== null) return { stage: 'install', command, garden: garden['kind'] === 'skills.fallback' ? 'missing' : 'old' };
  if (state === 'published' && o['current'] !== null && o['current'] !== undefined && !findings.some((f) => f['severity'] === 'error')) {
    return { stage: 'published', command: null, garden: null };
  }
  return { stage: 'todo', command: null, garden: null };
}

/** Step 2's and the Skills page's words for one reading (one source, so the two never disagree). */
export function skillsWords(r: SkillsReading): string {
  switch (r.stage) {
    case 'published': return 'Done. Skills are published and ready for work.';
    case 'publishing': return 'Publishing now. Studio’s service publishes skills when it starts; this finishes on its own.';
    case 'install': return r.garden === 'missing'
      ? 'Not done. The skills package (wicked-garden) isn’t installed. Install it with this command, then on the Skills page choose Refresh baseline, then Publish.'
      : 'Not done. The skills package (wicked-garden) is older than studio needs. Update it with this command, then on the Skills page choose Refresh baseline, then Publish.';
    case 'todo': return 'Not done. Publish skills before starting work.';
  }
}

export const UNCHECKED_SETUP: SetupChecks = { skills: null, estate: null, runtime: null, runtimeRequired: null };

/** Reuse the Nerve Center's normalized probes, never their raw error prose. */
export function setupChecks(snapshot: SystemSnapshot | null, health?: unknown, diagnostics?: unknown): SetupChecks {
  const infra = snapshot?.infra ?? [];
  const state = (key: string): boolean | null => {
    const s = infra.find((r) => r.key === key)?.state;
    return s === undefined || s === 'unknown' ? null : s === 'ok';
  };
  const images = infra.find((r) => r.key === 'seat_images');
  // seat_images is explicitly off when helpers run on this computer. An answered image probe
  // (ok/degraded) reached the runtime; degraded can mean an image needs preparing, not a stopped runtime.
  const runtimeRequired = images === undefined || images.state === 'unknown' ? null : images.state !== 'off';
  const runtime = images === undefined || images.state === 'unknown' ? null
    : images.state === 'ok' || images.state === 'degraded';
  const h = health !== null && typeof health === 'object' ? health as Record<string, unknown> : {};
  const warnings = Array.isArray(h['warnings']) ? h['warnings'] : [];
  const skillsBlocked = warnings.some((w: unknown) => {
    if (w === null || typeof w !== 'object') return false;
    const b = w as Record<string, unknown>;
    return typeof b['kind'] === 'string' && b['kind'].startsWith('skills.') && b['severity'] === 'error';
  });
  const d = diagnostics !== null && typeof diagnostics === 'object' ? diagnostics as Record<string, unknown> : {};
  const skills = d['skills'] !== null && typeof d['skills'] === 'object' ? d['skills'] as Record<string, unknown> : {};
  const skillState = typeof skills['state'] === 'string' ? skills['state'] : null;
  const components = d['components'] !== null && typeof d['components'] === 'object' ? d['components'] as Record<string, unknown> : {};
  const binaries = components['engineBinaries'] !== null && typeof components['engineBinaries'] === 'object' ? components['engineBinaries'] as Record<string, unknown> : {};
  const estateVersion = binaries['wicked-estate'];
  // A missing binary is null in diagnostics. Newer services also name a missing installation
  // in the estate row; other down states can describe its data store and do not prove absence.
  const estateRow = infra.find((r) => r.key === 'estate');
  const estateMissing = estateRow?.state === 'down' && /isn.t installed|not installed/i.test(estateRow.reason ?? '');
  const estate = estateMissing || estateVersion === null ? false : typeof estateVersion === 'string' && estateVersion.trim() !== '' ? true : null;
  const skillsReady = skillState === null ? state('skills')
    : skillState !== 'published' ? false : skills['current'] === undefined ? null : skills['current'] !== null;
  const reading = skillsReading(d['skills']);
  return {
    skills: skillsBlocked || state('skills') === false ? false : skillsReady,
    estate, runtime, runtimeRequired,
    ...(reading !== null ? { skillsReading: reading } : {}),
  };
}

/**
 * The container runtime as the Helpers rows read it (first-run N3): a container helper whose check says the runtime
 * is stopped ("Docker isn't running") means it is down; a container helper whose sign-in check answered (signed in
 * or out) means it answered. The system snapshot's seat-image probe can time out on a loaded host and is read once,
 * so it only fills in when no row has said either. `downReason` is the rows' own sentence.
 */
export function withRowRuntime(checks: SetupChecks, rows: readonly AgentRow[]): SetupChecks & { downReason: string | null } {
  const container = rows.filter((r) => r.seat.sign_in === 'container');
  if (container.length === 0) return { ...checks, downReason: null };
  const down = container.map(helperRuntimeDown).find((m) => m !== null) ?? null;
  if (down !== null) return { ...checks, runtime: false, runtimeRequired: true, downReason: down };
  const answered = container.some((r) => r.seat.auth === 'signed_in' || r.seat.auth === 'signed_out');
  return { ...checks, runtime: answered ? true : checks.runtime, runtimeRequired: true, downReason: null };
}

/**
 * The agents that count for setup (§5.1 `usableAgents`): picked for new work, not opt-in, signed in
 * or needing no sign-in, not on an active bench, given repository work (crew's `work_admission`
 * when sent, else studio's codex constant), and with a safety claim that holds for repository work.
 * Reviews are a separate capability, so `council_eligible` alone never decides it.
 */
export function setupAgents(rows: readonly AgentRow[]): AgentRow[] {
  // studio#856: `jobWork`, so a work-only seat no studio job draws from never completes setup (coord F1 on #1302).
  return rows.filter((r) => r.picked && !r.optIn && r.usable && r.jobWork && r.repoWork && boundaryHolds(r.seat, 'scoped_bound'));
}

/**
 * crew#1568 D05: Helpers step 5's names. `using`: the helpers new work uses now: picked, signed in (or needing no
 * sign-in) and given job work, since crew's new-work pool draws only from helpers that can work. `off`: the ready
 * helpers left out until picked. A helper that is not installed or not signed in is in neither list.
 * `defaultPick`: no pick is saved (`newWorkSeats` unset), so crew's default rule applies, which leaves opt-in helpers
 * out unless one is all that can work: then it uses them (crew `defaultLaunchRoster`). A saved pick, even an empty
 * one, is used as it stands.
 */
export function newWorkHelpers(rows: readonly AgentRow[], defaultPick: boolean): { using: AgentRow[]; off: AgentRow[] } {
  const ready = rows.filter((r) => r.usable && r.jobWork);
  // crew's fallback looks at its own eligible list (`proposalRoster`: job work, not signed out), where a helper whose
  // sign-in cannot be read still counts: an opt-in helper stands in only when no ordinary helper is on that list.
  const crewHasOrdinary = rows.some((r) => !r.optIn && r.jobWork && authOf(r.seat) !== 'signed_out');
  if (defaultPick && !crewHasOrdinary) return { using: ready.filter((r) => r.optIn), off: ready.filter((r) => !r.optIn) };
  return { using: ready.filter((r) => r.picked), off: ready.filter((r) => !r.picked) };
}

/**
 * crew#1527: the delivery step, from crew's `GET /setup/known` `delivery` (`DeliveryReadiness`, api-types 0.214.0) and
 * studio's own "Open a PR when a build run finishes" preference (studio's composer always says which it wants).
 * `done`: pull requests can open, or studio delivers locally. `commands`: what to run when GitHub sign-in or the git
 * author is what stops it. Never gates setup: local delivery is a real choice.
 */
export interface DeliveryStep {
  done: boolean;
  /** `ready`: PRs open; `local`: no PR is asked for; `blocked`: a PR job would stop at its deliver step; `unknown`: not checked. */
  state: 'ready' | 'local' | 'blocked' | 'unknown';
  words: string;
  /** crew's own sentence (what it checked), shown beside studio's words; `null` when there is none. */
  detail: string | null;
  commands: string[];
}

interface DeliveryReadinessLike {
  ready?: unknown;
  reason?: unknown;
  github?: { status?: unknown } | null;
}

export function deliveryStep(delivery: unknown, deliverPr: boolean): DeliveryStep {
  if (!deliverPr) {
    return { done: true, state: 'local', words: 'Done. Finished work stays on its branch in your repository; studio opens no pull request. Change it in Settings.', detail: null, commands: [] };
  }
  const d = delivery !== null && typeof delivery === 'object' ? delivery as DeliveryReadinessLike : null;
  const reason = typeof d?.reason === 'string' && d.reason.trim() !== '' ? d.reason.trim() : null;
  if (d === null || d.ready === null || d.ready === undefined) {
    return { done: false, state: 'unknown', words: 'Not checked yet.', detail: d === null ? null : reason, commands: [] };
  }
  if (d.ready === true) return { done: true, state: 'ready', words: 'Done. Finished work opens a pull request on GitHub.', detail: reason, commands: [] };
  // The commands for the blockers crew's sentence names (setup/delivery-readiness.ts deliveryReadiness): a GitHub
  // sign-in delivery refuses (a missing gh is said in crew's words, with no command), and no git author.
  const commands: string[] = [];
  if (d.github?.status === 'missing' && !/\bgh is not installed\b/.test(reason ?? '')) commands.push('gh auth login');
  if (/\bno git (?:author|committer)\b[^.;]*\bidentity\b/.test(reason ?? '')) {
    commands.push('git config --global user.name "Your Name"', 'git config --global user.email you@example.com');
  }
  return {
    done: false, state: 'blocked',
    words: 'Not done. Sign in to GitHub for pull requests, or choose local delivery.',
    detail: reason, commands,
  };
}

/** Projects that count: the synthesized "Unfiled" default (`id: 'default'`) never does. */
export function realProjects(projects: readonly { id: string }[]): number {
  return projects.filter((p) => p.id !== 'default').length;
}

export interface SetupFacts { rows: readonly AgentRow[]; repos: number; projects: number; checks?: SetupChecks }

export function goodEnough(f: SetupFacts): boolean {
  return setupAgents(f.rows).length >= 1 && (f.repos >= 1 || f.projects >= 1)
    && f.checks?.skills === true && f.checks.estate === true
    && (f.checks.runtimeRequired === false || f.checks.runtimeRequired === true && f.checks.runtime === true);
}

/** One setup step's state, read from the same predicates as the completion rule (§5.1). */
export interface SetupSteps {
  ready: number;
  total: number;
  agentsDone: boolean;
  placeDone: boolean;
  repos: number;
  projects: number;
}

export function setupSteps(f: SetupFacts): SetupSteps {
  const ready = setupAgents(f.rows).length;
  return { ready, total: f.rows.length, agentsDone: ready >= 1, placeDone: f.repos >= 1 || f.projects >= 1, repos: f.repos, projects: f.projects };
}

/** The one move step 1 offers for an agent, from its top issue (§5.2). `null` = it already counts. */
export function setupMove(r: AgentRow, counted: readonly AgentRow[]): { kind: 'sign-in' | 'fix' | 'use'; label: string } | null {
  if (counted.some((c) => c.key === r.key)) return null;
  if (r.optIn) return null;
  // A helper that can't be used on this floor can't be signed in yet: its modal says what to install.
  if (helperNotInstalled(r)) return { kind: 'fix', label: `Fix ${r.name}` };
  // The top issue decides (issues are sorted): a sign-in offered first only when signing in is the next move (codex #759 r1).
  if (r.issues[0]?.code === 'signed_out') return { kind: 'sign-in', label: `Sign in ${r.name}` };
  if (!r.picked && r.usable && r.jobWork && r.issues.every((i) => i.severity === 'note')) return { kind: 'use', label: `Use ${r.name} for new work` };
  return { kind: 'fix', label: `Fix ${r.name}` };
}
