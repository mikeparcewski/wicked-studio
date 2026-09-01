import type { Project, RepoEntry, SessionView } from '../api/types.js';
import type { Diagnostics } from '../api/diagnostics.js';
import { newestFailedRun, type NeedRow } from '../board/needsYou.js';
import { statusCounts } from '../board/windowStats.js';
import { headingForPath } from './LeftSidebar.js';
import { humanTitle } from './runIdentity.js';

/**
 * The ASK context pack (the app-wide Ask feature) — pure derivations, pinned by unit test.
 *
 * The pack is what the app KNOWS, spelled as plain text that rides the FIRST message of the
 * governed chat session (never sent on its own — nothing launches without the user's send):
 *
 *  - where the operator is standing (the rail's own route→section map — one derivation);
 *  - counts from the section folds the app already holds (`statusCounts` over the one runs
 *    list — zero new requests);
 *  - the daemon's self-description when `GET /api/v1/diagnostics` is SERVED — versions,
 *    stores, recent errors, ACP health — each cited as the wire's answer; when the route is
 *    absent (older crews) the pack SAYS SO honestly instead of fabricating, and instructs
 *    the answering agents to do the same.
 */

// ── Where am I — the route → section reading ──────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  projects: 'Projects',
  make: 'Make',
  chat: 'Chat',
  repos: 'Repositories',
  testing: 'Testing',
  steering: 'Steering',
  settings: 'Settings',
};

/** The current section, from the SAME route→heading map the rail navigates by. */
export function sectionLabel(pathname: string): string {
  const heading = headingForPath(pathname);
  if (heading !== null) return SECTION_LABELS[heading] ?? 'Studio';
  const [, first = ''] = pathname.split('/');
  if (first === '') return 'Home';
  if (first === 'work' || first === 'runs') return 'Work';
  return 'Studio';
}

// ── Formatting (display-honest: no invented precision) ───────────────────────────────────────

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function fmtUptime(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// ── The diagnostics presence gate ─────────────────────────────────────────────────────────────

export type DiagnosticsState =
  | { kind: 'loading' }
  | { kind: 'present'; diagnostics: Diagnostics }
  /** The route is absent/unserved on this daemon — older crews have no /diagnostics. */
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string };

/** The one-line summary the dock's empty state shows about the pack it will send. */
export function contextPackSummary(diag: DiagnosticsState): string {
  switch (diag.kind) {
    case 'present': {
      const d = diag.diagnostics;
      const clis = Object.keys(d.acp.byCli).length;
      return `Context pack ready: diagnostics cited (crew ${d.components.crew} · ${d.stores.length} stores · ACP health for ${clis} CLI${clis === 1 ? '' : 's'}) + route + run counts.`;
    }
    case 'unsupported':
      return 'Context pack ready: route + run counts. Diagnostics are NOT served by this daemon (older crew — no GET /api/v1/diagnostics), so versions, stores, and ACP health ride as honestly absent.';
    case 'failed':
      return `Context pack ready: route + run counts. The diagnostics read failed (${diag.message}) — versions, stores, and ACP health ride as honestly absent.`;
    case 'loading':
      return 'Assembling the context pack…';
  }
}

// ── The pack itself ───────────────────────────────────────────────────────────────────────────

function diagnosticsSection(diag: DiagnosticsState): string[] {
  if (diag.kind === 'unsupported') {
    return [
      'diagnostics: NOT SERVED — this daemon has no GET /api/v1/diagnostics (older crew).',
      '  Component versions, store sizes, recent errors, and ACP health are unavailable to this',
      '  pack; say so rather than guess.',
    ];
  }
  if (diag.kind === 'failed') {
    return [`diagnostics: the read failed (${diag.message}) — treat those facts as unavailable, never guessed.`];
  }
  if (diag.kind === 'loading') {
    return ['diagnostics: the read had not answered when this message was sent.'];
  }
  const d = diag.diagnostics;
  const lines: string[] = ['diagnostics (GET /api/v1/diagnostics):'];
  const engines = Object.entries(d.components.engineBinaries)
    .map(([name, v]) => `${name} ${v ?? '(unversioned)'}`)
    .join(', ');
  lines.push(
    `  components: crew ${d.components.crew}` +
      ` · studio bundle ${d.components.studioBundle ?? '(not reported)'}` +
      ` · core-ts ${d.components.coreTs ?? '(not reported)'}` +
      (engines !== '' ? ` · engines: ${engines}` : ''),
  );
  lines.push(
    `  daemon: up ${fmtUptime(d.daemon.uptimeMs)} on port ${d.daemon.port} (started ${new Date(d.daemon.startedAt).toISOString()})`,
  );
  if (d.stores.length > 0) {
    lines.push(
      `  stores: ${d.stores.map((s) => `${s.name} ${fmtBytes(s.bytes)} (${s.path})`).join(' · ')}`,
    );
  } else {
    lines.push('  stores: none reported');
  }
  if (d.recentErrors.length > 0) {
    const newest = d.recentErrors[0];
    lines.push(
      `  recent errors: ${d.recentErrors.length} recorded — newest [${newest?.source ?? '?'}] ${newest?.line ?? ''}`,
    );
  } else {
    lines.push('  recent errors: none recorded');
  }
  const acpEntries = Object.entries(d.acp.byCli);
  if (acpEntries.length > 0) {
    lines.push(
      `  acp (from the durable run event logs): ${acpEntries
        .map(([cli, a]) => {
          const last =
            a.lastFallbackTs !== null ? `, last fallback ${new Date(a.lastFallbackTs).toISOString().slice(0, 10)}` : '';
          return `${cli} ${a.sessionsStarted} sessions/${a.fallbacks} fallbacks${last}`;
        })
        .join(' · ')}`,
    );
  } else {
    lines.push('  acp: no session/fallback events recorded');
  }
  return lines;
}

/**
 * Assemble the pack that rides the first send. Everything in it is something the app
 * actually holds or the wire actually answered — counts from the one runs list, the
 * route section, and the diagnostics answer (or its honest absence).
 */
export function buildContextPack(args: {
  pathname: string;
  runs: SessionView[];
  liveChatCount: number;
  diagnostics: DiagnosticsState;
  now?: number;
}): string {
  const { pathname, runs, liveChatCount, diagnostics } = args;
  const at = new Date(args.now ?? Date.now()).toISOString();
  const c = statusCounts(runs);
  const lines: string[] = [
    `[studio context pack — assembled ${at}]`,
    `where: ${sectionLabel(pathname)} (${pathname})`,
    `runs (the studio's live list): ${c.total} total — ${c.active} active, ${c.gates} awaiting a human, ${c.failed} failed, ${c.done} done, ${c.cancelled} cancelled`,
    `live chat sessions this client knows about: ${liveChatCount}`,
    ...diagnosticsSection(diagnostics),
    'Answer from what you can actually read (the estate/garden tooling reaches the code graph,',
    'stores, and run record); when a fact is not reachable, say so instead of guessing.',
  ];
  return lines.join('\n');
}

// ── Quick prompts (prefill-only chips — nothing sends without the user) ──────────────────────

export interface AskPromptSeed {
  runs: SessionView[];
  /** THE home-queue fold's rows (`needsYouRows` — the caller computes it from
   *  the stores the app already holds). The failed-run chip seeds from its
   *  first failed-run row via {@link newestFailedRun} — the queue's own
   *  newest-first ordering, never a second recency derivation (E1). */
  needRows: readonly NeedRow[];
  projects: Project[];
  repos: RepoEntry[];
}

/** The quick-prompt chips. Chips whose referent the app does not hold are OMITTED, never
 *  fabricated (no failed run ⇒ no "why did it fail" chip). */
export function askPrompts({ runs, needRows, projects, repos }: AskPromptSeed): { label: string; text: string }[] {
  const prompts: { label: string; text: string }[] = [];
  const failed = newestFailedRun(needRows, runs);
  if (failed !== undefined) {
    const title = humanTitle(failed.session.problem);
    prompts.push({
      label: `Why did run ${failed.session.id.slice(0, 8)} fail?`,
      text: `Why did run ${failed.session.id} ("${title}") fail? Walk the run record and its evidence.`,
    });
  }
  const project = projects.find((p) => p.id !== 'default');
  if (project !== undefined) {
    prompts.push({
      label: `What's in project ${project.name}?`,
      text: `What's in project "${project.name}" (${project.id}) — runs, docs, repos, and how healthy is it?`,
    });
  }
  const repo = repos[0];
  if (repo !== undefined) {
    prompts.push({
      label: `What changed in repo ${repo.name}?`,
      text: `What changed in repo "${repo.name}" recently? Use its code graph and run history.`,
    });
  }
  prompts.push({
    label: 'Diagnose studio',
    text: 'Diagnose this studio installation — the app, its daemon, and its dependencies. Anything unhealthy in the context pack or the stores?',
  });
  prompts.push({
    label: 'Is ACP healthy across the CLIs?',
    text: 'Is ACP healthy across the CLIs? Compare sessions started vs fallbacks per CLI and flag anything degrading.',
  });
  return prompts;
}
