import type { SessionView } from '../api/types.js';
import type { Diagnostics } from '../api/diagnostics.js';
import { statusCounts } from '../board/windowStats.js';
import { jobTitle } from '../board/deskWords.js';
import { PACK_OPENING } from '../board/askPack.js';
import { scopePackLines, type ScopeChip } from '../board/chatScopes.js';

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

/** The route sections (§2.1) — moved here from the classic rail (S18c). */
export type PathKey = 'projects' | 'execute' | 'test' | 'vibe' | 'demo' | 'chat' | 'repos' | 'testing' | 'skills' | 'mcp' | 'steering' | 'memory' | 'settings';

// `wiki`, `rules` and `policies` retired into Steering (they redirect to /steering); the
// retired `coverage` and `domain` panels redirect to /system — kept mapped here so the rail
// never flashes headless on the pre-redirect tick.
const SETTINGS_ROUTES = new Set(['system', 'theme', 'coverage', 'domain', 'workflows']);

/**
 * The route→heading map (§3.2): which primary path owns a pathname. `/` and
 * `/runs*` map to NONE — five closed headings, the rail's calmest reading.
 * Exported pure so the default-expansion contract is unit-pinned.
 */
export function headingForPath(pathname: string): PathKey | null {
  const [, first = '', second = ''] = pathname.split('/');
  if (first === 'projects' || first === 'p') return 'projects';
  // Execute / Vibe / Demo (nav-reorg). The retired `/make` maps to Execute so the rail never
  // flashes headless on the pre-redirect tick (useMakeRedirect replaces it with /execute).
  if (first === 'execute' || first === 'make') return 'execute';
  if (first === 'vibe') return 'vibe';
  if (first === 'demo') return 'demo';
  // `/chat/new` AND `/chat/:id` (J4/C6: a live session's real URL) are Chat's.
  if (first === 'chats' || (first === 'chat' && second !== '')) return 'chat';
  if (first === 'repos' || first === 'repo-detail') return 'repos';
  // The `/testing/*` surface splits into TWO rail sections (usability wave): Test (campaigns/recon,
  // a work section that needs no project) and Evals (steering-rule evals, a system section beside
  // Steering). Both are still panel `testing`; the rail heading is chosen by the sub-page. The
  // retired flat `/campaigns` addresses (which redirect onto `/testing/campaigns`) map to Test.
  if (first === 'campaigns') return 'test';
  // Bare `/testing` and the retired `/testing/harness` are page-less addresses `useTestingRedirect`
  // lands on the TEST landing (F-075 / F-7R2-009) — so the rail heading follows: only `/testing/evals`
  // is Evals.
  if (first === 'testing') return second === 'evals' ? 'testing' : 'test';
  // `/skills` (+ any sub-address) is the skills file manager — a system section beside Steering.
  if (first === 'skills') return 'skills';
  // `/mcp` is MCP tools — a system section between Skills and Steering.
  if (first === 'mcp') return 'mcp';
  // Memory (`/memory`, and the retired `/steering/memories` that redirects there) is its own section.
  if (first === 'memory' || (first === 'steering' && second === 'memories')) return 'memory';
  // The retired `/wiki` + `/policies` panels AND the retired standalone `/proposals` queue redirect
  // into Steer — map them there too, so the rail never flashes Settings open on the pre-redirect tick.
  if (first === 'steering' || first === 'wiki' || first === 'rules' || first === 'policies' || first === 'proposals') return 'steering';
  if (SETTINGS_ROUTES.has(first)) return 'settings';
  return null;
}


const SECTION_LABELS: Record<string, string> = {
  projects: 'Projects',
  make: 'Make',
  chat: 'Chat',
  repos: 'Repositories',
  testing: 'Testing',
  steering: 'Steering',
  memory: 'Memory',
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
      // studio#468: names and sizes only. The pack rides the operator's message and is stored with
      // it; a store's absolute path put the home directory in every transcript, and a seat that
      // needs one reads the diagnostics itself.
      `  stores: ${d.stores.map((s) => `${s.name} ${fmtBytes(s.bytes)}`).join(' · ')}`,
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

export { PACK_JOIN, PACK_OPENING, splitAskContext } from '../board/askPack.js';

/** The item a page chat's question is about, as pack lines (none without one). */
export function focusLines(focus: { label: string; lines: readonly string[] } | null): string[] {
  if (focus === null) return [];
  return [`the question is about: ${focus.label}`, ...focus.lines.map((l) => `  ${l}`)];
}

/** A later page-chat message that owes no full pack but asks about an item: just the item. */
export function focusPack(focus: { label: string; lines: readonly string[] }, now?: number): string {
  return [`${PACK_OPENING}${new Date(now ?? Date.now()).toISOString()}]`, ...focusLines(focus)].join('\n');
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
  /** The system chat's scope chips (DES-SYSTEM-CHAT §6): when given, the pack carries EXACTLY what
   *  they choose — the page (where, live chats, diagnostics) only with This page on, the run counts
   *  only with Recent runs on — plus their scope lines. */
  chips?: readonly ScopeChip[];
  /** The page in words ("the Desk", a run's title) for the `where` line. */
  pageLabel?: string;
  /** A later message's pack: the diagnostics already rode the first one. */
  omitDiagnostics?: boolean;
  /** A page chat (DES-LEARN §6.2): what the page on screen shows, in lines — it rides with This page. */
  pageLines?: readonly string[];
  /** A page chat: the one item the operator asked about (a number, a chart, a row) and its data. It rides
   *  whatever the chips say: the question is about it. */
  focus?: { label: string; lines: readonly string[] } | null;
}): string {
  const { pathname, runs, liveChatCount, diagnostics } = args;
  const at = new Date(args.now ?? Date.now()).toISOString();
  const c = statusCounts(runs);
  const runsLine = `runs (the studio's live list): ${c.total} total — ${c.active} active, ${c.gates} awaiting a human, ${c.failed} failed, ${c.done} done, ${c.cancelled} cancelled`;
  if (args.chips !== undefined) {
    const chips = args.chips;
    const page = chips.some((x) => x.kind === 'page' && x.on);
    const recent = chips.some((x) => x.kind === 'runs' && x.on);
    const newest = [...runs]
      .sort((a, b) => Number((b.session as { created_at?: number }).created_at ?? 0) - Number((a.session as { created_at?: number }).created_at ?? 0))
      .slice(0, 5)
      .map((v) => ({ id: v.session.id, title: jobTitle(v.session), status: v.session.status }));
    return [
      `${PACK_OPENING}${at}]`,
      ...(page ? [
        `where: ${args.pageLabel ?? sectionLabel(pathname)} (${pathname})`,
        ...(args.pageLines !== undefined && args.pageLines.length > 0 ? ['what this page shows:', ...args.pageLines.map((l) => `  ${l}`)] : []),
        `live chat sessions this client knows about: ${liveChatCount}`,
        ...(args.omitDiagnostics === true ? [] : diagnosticsSection(diagnostics)),
      ] : []),
      ...focusLines(args.focus ?? null),
      ...(recent ? [runsLine] : []),
      ...scopePackLines(chips, recent ? newest : []),
      'Answer from what you can actually read (the estate/garden tooling reaches the code graph,',
      'stores, and run record) within what the user chose above; when a fact is not reachable, say so instead of guessing.',
    ].join('\n');
  }
  const lines: string[] = [
    `${PACK_OPENING}${at}]`,
    `where: ${sectionLabel(pathname)} (${pathname})`,
    runsLine,
    `live chat sessions this client knows about: ${liveChatCount}`,
    ...diagnosticsSection(diagnostics),
    'Answer from what you can actually read (the estate/garden tooling reaches the code graph,',
    'stores, and run record); when a fact is not reachable, say so instead of guessing.',
  ];
  return lines.join('\n');
}
