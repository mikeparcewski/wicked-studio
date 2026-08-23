import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { GovernanceClaim, InteractionRequest, RepoEntry, SessionView } from '../api/types.js';
import { api } from '../api/client.js';
import { UNFILED_MOUNT } from '../api/interactive.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';
import { fuzzyMatch, type FuzzyResult } from '../palette/fuzzy.js';
import { launchPath } from '../hooks/ambientProject.js';
import { modePath, projectPath, type Navigate } from '../hooks/useRoute.js';
import type { ShortcutEntry } from '../hooks/useGlobalShortcuts.js';
import { useMembershipStore } from '../store/membership.js';
import { useProjectsStore } from '../store/projects.js';
import { useGateStore } from '../store/gates.js';
import { useAppearanceStore } from '../theming/appearance.js';
import { decideGate, GATE_HASH } from '../board/gateActions.js';
import { NewProjectModal } from './NewProjectModal.js';
import { Modal } from './Modal.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';
import { INTENT_MAX, runTitle, runWhenWord, WHEN_TITLE } from './runIdentity.js';
import { Terminal } from './Terminal.js';

/**
 * The universal command palette (DES-FEEDBACK-002 §1, slice G): Cmd+K / Ctrl+K /
 * Ctrl+P open it; fuzzy search over projects (`p:`), runs & open gates (`run:`),
 * repositories (`repo:`) and quick verbs (`>`); selecting navigates (the board's
 * real-link contract) or executes the verb.
 *
 * The corpus steals nothing (§1.4): projects and gates come from already-loaded
 * stores, runs from App's one `useRuns()`; only the repo list is fetched — once,
 * on the first OPEN (a user gesture, never a mount), then cached for the session.
 */

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'cancelled', 'failed']);
const ACTIVE: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);

type Group =
  | 'runs' | 'projects' | 'repos' | 'verbs'
  // §5.2 search mode's corpora — grouped exactly as the corpus label names them.
  | 'search-runs' | 'search-gates' | 'search-decisions' | 'search-repos' | 'search-prompts';

const GROUP_LABEL: Record<Group, string> = {
  runs: 'RUNS & GATES',
  projects: 'PROJECTS',
  repos: 'REPOSITORIES',
  verbs: 'VERBS',
  'search-runs': 'RUNS',
  'search-gates': 'OPEN GATES',
  'search-decisions': 'DECISIONS',
  'search-repos': 'REPOSITORIES',
  'search-prompts': 'PROMPTS: THIS PROJECT',
};

interface Entry {
  id: string;
  group: Group;
  /** Fuzzy-matched text. Verbs match on the name after the `>`. */
  label: string;
  /** Mono dim context (project/status/branch). */
  context: string;
  /** Real-link target (href + onClick-preventDefault, deep-linkable). */
  href?: string;
  /** Verb execution — runs instead of navigation. */
  action?: () => void;
  /** Group-internal rank: lower first (gates before active before terminal). */
  rank: number;
  /** Search hits: a status dot (token) or glyph before the label. */
  dot?: string;
  glyph?: string;
  /** Search hits: the mono snippet line (§5.3) + its matched positions. */
  snippet?: string;
  snippetPositions?: number[];
  /** Run rows only (§7.5, slice Y2): the attach-clock word — presence marks the
   *  row's label as the synthesized `run-title` (EC40). */
  when?: string;
}

/**
 * §5.2's prose matcher: a plain case-insensitive SUBSTRING pass for prose
 * fields (run problems, gate prompts, claim subjects) — subsequence matching
 * on prose produces false-positive noise; substring on prose + fuzzy on
 * identifiers is the honest pairing. Positions feed the same accent-render
 * seam the fuzzy scorer uses.
 */
export function substringMatch(needle: string, haystack: string): FuzzyResult | null {
  if (needle === '') return { score: 0, positions: [] };
  const at = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;
  return { score: 1, positions: Array.from({ length: needle.length }, (_, i) => at + i) };
}

/** Search-hit status dots — the board's status layer, read as tokens (EC15). */
const SEARCH_DOT: Record<string, string> = {
  awaiting_human: 'var(--status-gate)',
  failed: 'var(--status-fail)',
  planning: 'var(--status-run)',
  distributing: 'var(--status-run)',
  executing: 'var(--status-run)',
};

/** Session-scoped repo cache (§1.4) — SHARED with the rail's Repositories
 *  accordion since slice M (DES-FEEDBACK-003 §3.3): one gesture warms both. */
export { clearRepoCache as clearPaletteRepoCache } from '../store/repoCache.js';

/**
 * The two global chords App registers (§1.2) — exported so the wiring the app
 * mounts is the wiring the unit tests exercise. Order matters: the palette
 * toggle first (and it alone survives `paletteOpen`), the relocated kill-run
 * (Ctrl+Shift+K, same guards + silent-fail contract as the old `useKillShortcut`)
 * after it.
 */
export function paletteShortcutEntries(opts: {
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
  /** §5.2: open the palette in SEARCH mode (the `?` prefix pre-typed). */
  openSearch: () => void;
  killEligible: () => boolean;
  kill: () => void;
}): ShortcutEntry[] {
  const toggle = (e: KeyboardEvent): void => {
    e.preventDefault(); // Ctrl+P must suppress browser print
    opts.setOpen(!opts.isOpen());
  };
  return [
    {
      id: 'palette-toggle-k',
      group: 'palette',
      chord: { key: 'k', ctrlOrMeta: true },
      description: 'Open the command palette',
      handler: toggle,
      allowWhilePaletteOpen: true,
    },
    {
      id: 'palette-toggle-p',
      group: 'palette',
      chord: { key: 'p', ctrlOrMeta: true },
      description: 'Open the command palette',
      handler: toggle,
      allowWhilePaletteOpen: true,
    },
    {
      // §5.2: global search is the palette's DEEP MODE — Cmd+Shift+F opens the
      // palette with the `?` prefix pre-typed (registered in the §1.2 table).
      id: 'palette-search',
      group: 'palette',
      chord: { key: 'f', ctrlOrMeta: true, shift: true },
      description: 'Global search',
      handler: (e) => {
        e.preventDefault(); // suppress the browser's find-in-page variants
        opts.openSearch();
      },
    },
    {
      id: 'kill-run',
      group: 'palette',
      chord: { key: 'k', ctrlOrMeta: true, shift: true },
      description: 'Cancel the selected run',
      guard: opts.killEligible,
      handler: (e) => {
        e.preventDefault();
        opts.kill();
      },
    },
  ];
}

/** §5.3: snippet matches lift to `--ink-high` — the snippet line is muted mono,
 *  so the matched substring reads as the found thing, not as the accent. */
function highlightSnippet(text: string, positions: number[]): React.ReactNode {
  if (positions.length === 0) return text;
  const set = new Set(positions);
  return text.split('').map((ch, i) =>
    set.has(i) ? (
      <span key={i} style={{ color: 'var(--ink-high)' }}>
        {ch}
      </span>
    ) : (
      ch
    ),
  );
}

/** Accent-highlight the fuzzy-matched characters (§1.5 — the row's only accent). */
function highlight(label: string, positions: number[]): React.ReactNode {
  if (positions.length === 0) return label;
  const set = new Set(positions);
  return label.split('').map((ch, i) =>
    set.has(i) ? (
      <span key={i} style={{ color: 'var(--accent)', fontWeight: 'var(--weight-semi)' }}>
        {ch}
      </span>
    ) : (
      ch
    ),
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  runs: SessionView[];
  navigate: Navigate;
  runPath: (id: string) => string;
  projectId: string | null;
  selectedRun: SessionView | null;
  onKill: (id: string) => void;
  /** Pre-typed query on OPEN (§5.2: Cmd+Shift+F seeds `?` — search mode). */
  seed?: string;
}

export function CommandPalette({
  open, onClose, runs, navigate, runPath, projectId, selectedRun, onKill, seed = '',
}: Props): React.ReactElement | null {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [repos, setRepos] = useState<RepoEntry[]>(getCachedRepos() ?? []);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  // `> New Document` / `> New Video` outside a project (DES-FEEDBACK-003 §8.4):
  // a doc lives in a project, so the verb opens the same project-picker stage
  // the Make ＋ fork uses (§3.4) before navigating into the mode.
  const [pickProjectFor, setPickProjectFor] = useState<'document' | 'video' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const projects = useProjectsStore((s) => s.projects);
  const gates = useGateStore((s) => s.gates);

  // Open: remember focus and focus the input; fetch the repo list only when the
  // cache is cold (§1.4 — first open fires exactly one GET /repos; a warm cache
  // fetches nothing at all). The query resets on CLOSE, not open, so a reopen
  // renders empty from its first frame — a keystroke racing the open can never
  // append to the previous session's text.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setSel(0);
      return;
    }
    restoreRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    // §5.2: Cmd+Shift+F opens WITH the `?` prefix pre-typed — same overlay,
    // deep mode. A plain toggle seeds '' and lands in the normal grammar.
    if (seed !== '') setQuery(seed);
    fetchReposCached()
      .then(setRepos)
      .catch(() => {
        /* no repo surface — the group just stays empty this session */
      });
    // `seed` is read only at the open edge — a re-render must not re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (): void => {
    onClose();
    restoreRef.current?.focus?.();
  };

  // ── The corpus (§1.3/§1.4): stores + props only — zero fetching here ────────
  const { scope, needle } = useMemo(() => {
    const q = query.trimStart();
    if (q.startsWith('?')) return { scope: 'search' as const, needle: q.slice(1).trim() };
    if (q.startsWith('>')) return { scope: 'verbs' as const, needle: q.slice(1).trim() };
    if (q.startsWith('p:')) return { scope: 'projects' as const, needle: q.slice(2).trim() };
    if (q.startsWith('run:')) return { scope: 'runs' as const, needle: q.slice(4).trim() };
    if (q.startsWith('repo:')) return { scope: 'repos' as const, needle: q.slice(5).trim() };
    return { scope: 'all' as const, needle: q.trim() };
  }, [query]);

  // ── §5.2 search mode: the gesture-fetched legs ──────────────────────────────
  // ENTERING search mode fires at most two GETs (`/governance/claims`, plus
  // `/repos` if the palette cache was cold — already handled by the open
  // effect above), both cached for the session and refreshed on the next
  // entry. Keystrokes fire nothing — filtering below is in-memory. Inside a
  // project shell it ALSO queries the CURRENT project's prompt inbox (one
  // request, labeled) — the per-project wire used the way it scales, never a
  // cross-project fan-out.
  const searchMode = open && scope === 'search';
  const [claims, setClaims] = useState<GovernanceClaim[]>([]);
  const [prompts, setPrompts] = useState<InteractionRequest[]>([]);
  const [showWhy, setShowWhy] = useState(false);
  const projectNameByRun = useMembershipStore((s) => s.projectNameByRun);
  // §7.5 (slice Y2): the attach clock for run rows — the mirror the board
  // model already writes; a store read, never a fetch (§1.4's budget holds).
  const attachedAtByRun = useMembershipStore((s) => s.attachedAtByRun);
  useEffect(() => {
    if (!searchMode) {
      setShowWhy(false);
      return;
    }
    let cancelled = false;
    api.listClaims()
      .then(({ claims: got }) => { if (!cancelled) setClaims(got); })
      .catch(() => { /* no conformance store — the decisions group stays empty */ });
    if (projectId !== null) {
      api.listProjectPrompts(projectId)
        .then(({ prompts: got }) => { if (!cancelled) setPrompts(got); })
        .catch(() => { /* inbox unreadable — the prompts group stays empty */ });
    } else {
      setPrompts([]);
    }
    return () => { cancelled = true; };
  }, [searchMode, projectId]);

  const rows = useMemo(() => {
    // ── §5.2 search mode: the honest v1 corpus, grouped as the label names it.
    // Substring on prose (problems, prompts, claim subjects), fuzzy on names
    // (repos) — and NOTHING is fetched from here: claims/prompts arrived on
    // entry, runs/gates/repos are the already-held stores.
    if (scope === 'search') {
      const hits: Array<{ en: Entry; m: FuzzyResult }> = [];
      // Runs — all non-archived (the default `GET /runs` listing; archived
      // runs are named in the not-searched clause).
      runs.forEach((v, i) => {
        if (v.session.archived_at != null) return;
        const m = substringMatch(needle, v.session.problem);
        if (m === null) return;
        const id = v.session.id;
        // §7.5 (slice Y2): the row displays the SYNTHESIZED title while the
        // match stays on the full problem (prose corpus, §5.2). Highlight
        // positions survive only when they land inside the displayed intent
        // fragment — a hit past the truncation is a real hit with no honest
        // highlight, never a misplaced one.
        const intentLen = Math.min(v.session.problem.length, INTENT_MAX);
        hits.push({
          en: {
            id: `s-run-${id}`,
            group: 'search-runs',
            label: runTitle(v.session),
            context: projectNameByRun[id] ?? v.session.status,
            href: runPath(id),
            rank: i,
            dot: SEARCH_DOT[v.session.status] ?? 'var(--ink-dim)',
            when: runWhenWord(attachedAtByRun[id], Date.now()),
          },
          m: m.positions.every((p) => p < intentLen) ? m : { score: m.score, positions: [] },
        });
      });
      // Open gates — the event-sourced `awaitingHuman` prompts (§5.1).
      Object.values(gates).forEach((g, i) => {
        const m = substringMatch(needle, g.prompt);
        if (m === null) return;
        hits.push({
          en: {
            id: `s-gate-${g.runId}`,
            group: 'search-gates',
            label: g.prompt,
            context: projectNameByRun[g.runId] ?? 'gate',
            href: `${runPath(g.runId)}${GATE_HASH}`,
            rank: i,
            glyph: '⏸',
          },
          m,
        });
      });
      // Decisions — governance claims: substring on the subject (criteria),
      // fuzzy on the policy ids (identifiers); the hit navigates to the run
      // when the claim names one the client holds, else to /policies.
      claims.forEach((c, i) => {
        const subject = substringMatch(needle, c.criteria);
        const ident = subject === null ? fuzzyMatch(needle, c.policy_ids.join(' ')) : null;
        if (subject === null && ident === null) return;
        const named = runs.find(
          (v) => c.scope.includes(v.session.id) || c.evaluated_context_ref.includes(v.session.id),
        );
        hits.push({
          en: {
            id: `s-claim-${c.claim_id}`,
            group: 'search-decisions',
            label: `${c.policy_ids[0] ?? c.claim_id} · ${c.decision}`,
            context: c.phase,
            href: named !== undefined ? runPath(named.session.id) : '/policies',
            rank: i,
            glyph: '§',
            snippet: c.criteria,
            snippetPositions: subject?.positions ?? [],
          },
          m: subject ?? { score: ident?.score ?? 0, positions: [] },
        });
      });
      // Repos — names are identifiers: the §1.5 fuzzy scorer.
      repos.forEach((r) => {
        const m = fuzzyMatch(needle, r.name);
        if (m === null) return;
        hits.push({
          en: {
            id: `s-repo-${r.id}`,
            group: 'search-repos',
            label: r.name,
            context: r.default_branch,
            href: `/repo-detail/${encodeURIComponent(r.id)}`,
            rank: 0,
            glyph: '⬡',
          },
          m,
        });
      });
      // Prompts — THIS project only (the scoped wire, §5.2).
      prompts.forEach((p, i) => {
        if (p.status !== 'open') return;
        const m = substringMatch(needle, p.prompt);
        if (m === null) return;
        hits.push({
          en: {
            id: `s-prompt-${p.id}`,
            group: 'search-prompts',
            label: p.prompt,
            context: p.kind,
            href: `${runPath(p.session_id)}${p.kind === 'gate' ? GATE_HASH : ''}`,
            rank: i,
            glyph: '✉',
          },
          m,
        });
      });
      const searchOrder: Group[] = [
        'search-runs', 'search-gates', 'search-decisions', 'search-repos', 'search-prompts',
      ];
      hits.sort((a, b) => {
        const g = searchOrder.indexOf(a.en.group) - searchOrder.indexOf(b.en.group);
        if (g !== 0) return g;
        if (b.m.score !== a.m.score) return b.m.score - a.m.score;
        return a.en.rank - b.en.rank;
      });
      return hits;
    }

    const status = selectedRun?.session.status ?? '';
    const entries: Entry[] = [];

    // Runs & gates — a gated run IS its gate row (deep link to #gate); rank:
    // gates first (attention order — the list is already daemon-sorted), then
    // active runs, terminal runs after (§1.3 prefix table).
    for (const v of runs) {
      const id = v.session.id;
      const gated = v.session.status === 'awaiting_human' || gates[id] !== undefined;
      entries.push({
        id: `run-${id}`,
        group: 'runs',
        // §7.5 (slice Y2, EC40): the synthesized title IS the matched label
        // here — typing a short-id now finds its run.
        label: runTitle(v.session),
        context: gated ? 'gate' : v.session.status,
        href: gated ? `${runPath(id)}${GATE_HASH}` : runPath(id),
        rank: gated ? 0 : ACTIVE.has(v.session.status) ? 1 : 2,
        when: runWhenWord(attachedAtByRun[id], Date.now()),
      });
    }

    // Projects — the store the board/shell already loaded; the synthesized
    // Unfiled bucket never renders (F5). Recency-ordered (`updated_at`): the
    // store-reachable order — the board's decayed attention needs membership
    // joins the palette must not fetch.
    const visible = projects.filter((p) => p.id !== 'default' && p.status === 'active');
    const byRecency = [...visible].sort((a, b) => b.updated_at - a.updated_at);
    byRecency.forEach((p, i) =>
      entries.push({
        id: `project-${p.id}`,
        group: 'projects',
        label: p.name,
        context: 'project',
        href: projectPath(p.id),
        rank: i,
      }),
    );

    for (const r of repos) {
      entries.push({
        id: `repo-${r.id}`,
        group: 'repos',
        label: r.name,
        context: r.default_branch,
        href: `/repo-detail/${encodeURIComponent(r.id)}`,
        rank: 0,
      });
    }

    // Verbs (§1.3's table — each names its existing mechanism, none invents one).
    const verbs: Array<{ name: string; action: () => void; when?: boolean }> = [
      // Slice S: the pre-bound-vs-flat fork is the shared `launchPath` spelling
      // (DES-UX-001 §2.3 rule 1) — the palette may not hand-roll it.
      {
        name: 'New Build',
        action: () => navigate(launchPath(projectId, 'build')),
      },
      {
        name: 'New Chat',
        action: () => navigate(launchPath(projectId, 'chat')),
      },
      // The §3.4 fork's other two tines (DES-FEEDBACK-003 §8.4, slice N): the
      // palette and Make's ＋ agree on what can be made. Inside a project shell
      // the verb lands directly in the mode; outside, a doc cannot be Unfiled,
      // so the same project-picker mechanism as the Make ＋ runs first.
      {
        name: 'New Document',
        action: () => {
          if (projectId !== null) navigate(modePath(projectId, 'document'));
          else {
            if (projects.length === 0) void useProjectsStore.getState().load();
            setPickProjectFor('document');
          }
        },
      },
      {
        name: 'New Video',
        action: () => {
          if (projectId !== null) navigate(modePath(projectId, 'video'));
          else {
            if (projects.length === 0) void useProjectsStore.getState().load();
            setPickProjectFor('video');
          }
        },
      },
      { name: 'New Project', action: () => setShowNewProject(true) },
      {
        name: 'Toggle Theme',
        action: () => {
          const cur = useAppearanceStore.getState().appearance.theme;
          useAppearanceStore.getState().update({ theme: cur === 'dark' ? 'light' : 'dark' });
        },
      },
      { name: 'Open Terminal', action: () => setShowTerminal(true) },
      {
        name: 'Cancel run',
        when: selectedRun !== null && !TERMINAL.has(status),
        action: () => {
          if (selectedRun !== null) onKill(selectedRun.session.id);
        },
      },
      // The gate verbs answer through the ONE shared action module (slice H,
      // §2.3): same POST, same double-submit guard, same §3.3 states as the
      // GateChip's buttons and the triage keys.
      {
        name: 'Approve gate',
        when: status === 'awaiting_human',
        action: () => {
          if (selectedRun !== null) void decideGate(selectedRun.session.id, { approve: true });
        },
      },
      {
        name: 'Reject gate',
        when: status === 'awaiting_human',
        action: () => {
          if (selectedRun !== null) void decideGate(selectedRun.session.id, { approve: false });
        },
      },
    ];
    verbs.forEach((v, i) => {
      if (v.when === false) return;
      entries.push({ id: `verb-${v.name}`, group: 'verbs', label: v.name, context: 'verb', action: v.action, rank: i });
    });

    // Scope, fuzzy-rank, group (§1.3's group order; §1.5's scorer).
    const scoped = scope === 'all' ? entries : entries.filter((en) => en.group === scope);
    const matched = scoped
      .map((en) => ({ en, m: fuzzyMatch(needle, en.label) }))
      .filter((x): x is { en: Entry; m: { score: number; positions: number[] } } => x.m !== null);
    const order: Group[] = ['runs', 'projects', 'repos', 'verbs'];
    matched.sort((a, b) => {
      const g = order.indexOf(a.en.group) - order.indexOf(b.en.group);
      if (g !== 0) return g;
      if (b.m.score !== a.m.score) return b.m.score - a.m.score;
      return a.en.rank - b.en.rank;
    });
    return matched;
  }, [runs, projects, repos, gates, claims, prompts, projectNameByRun, attachedAtByRun, scope, needle, runPath, navigate, projectId, selectedRun, onKill]);

  // Clamp the selection whenever the row set changes.
  const selIx = Math.min(sel, Math.max(0, rows.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selIx, rows]);

  const activate = (row: (typeof rows)[number] | undefined): void => {
    if (row === undefined) return;
    close();
    if (row.en.action !== undefined) row.en.action();
    else if (row.en.href !== undefined) navigate(row.en.href);
  };

  // §1.2 precedence: list-navigation keys are handled by the palette's focused
  // input — including the toggle chords, which the registry cannot see from
  // inside a typing context.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'k' || e.key === 'p')) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel(Math.min(selIx + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(Math.max(selIx - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(rows[selIx]);
    } else if (e.key === 'Tab') {
      // Cycle to the next group's first row (the hint row's "tab cycle groups").
      e.preventDefault();
      const cur = rows[selIx]?.en.group;
      const next = rows.findIndex((r, i) => i > selIx && r.en.group !== cur);
      setSel(next >= 0 ? next : 0);
    }
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-center"
          style={{ background: 'var(--scrim)', paddingTop: '15vh' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            data-testid="command-palette"
            className="wk-palette-in flex flex-col self-start overflow-hidden"
            style={{
              // §5.2: search is the palette's deep mode — wider result rows.
              width: searchMode ? 680 : 560,
              maxHeight: 420,
              background: 'var(--surface-overlay)',
              boxShadow: 'var(--shadow-overlay)',
              borderRadius: 'var(--radius-xl)',
            }}
          >
            {/* input row */}
            <div
              className="flex items-center gap-2 px-4 py-3 shrink-0"
              style={{ background: 'var(--surface-raised)' }}
            >
              <Search size={14} style={{ color: 'var(--ink-dim)' }} aria-hidden />
              <input
                ref={inputRef}
                data-testid="palette-input"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSel(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="type to search…  p: run: repo: > ?"
                aria-label="Command palette search"
                className="flex-1 bg-transparent outline-none"
                style={{
                  fontSize: 'var(--text-md)',
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--ink-high)',
                }}
              />
              <span
                className="font-mono"
                style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}
              >
                esc
              </span>
            </div>

            {/* §5.2/EC24: the corpus label is a first-class UI element, ALWAYS
                visible in search mode — what IS and IS NOT searched, with the
                wire truth one [why?] away. The not-searched clause earns the
                attention color: an honesty marker. */}
            {searchMode && (
              <div
                data-testid="search-corpus-label"
                style={{
                  padding: '6px 16px', flexShrink: 0,
                  fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-sans)',
                  borderBottom: '1px solid var(--surface-raised)',
                }}
              >
                <p style={{ margin: 0, color: 'var(--ink-dim)' }}>
                  Searching: runs (all non-archived) · open gates · decisions (governance claims) · repos
                  {projectId !== null ? ' · prompts: this project' : ''}
                </p>
                <p style={{ margin: 0, color: 'var(--status-gate)' }}>
                  Not searched: archived runs, transcripts, historical events —{' '}
                  <button
                    type="button"
                    data-testid="search-why"
                    aria-expanded={showWhy}
                    onClick={() => setShowWhy((v) => !v)}
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      color: 'var(--status-gate)', cursor: 'pointer',
                      fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-sans)',
                      textDecoration: 'underline',
                    }}
                  >
                    [why?]
                  </button>
                </p>
                {showWhy && (
                  <p
                    data-testid="search-why-popover"
                    style={{ margin: '4px 0 0', color: 'var(--ink-muted)' }}
                  >
                    The crew daemon has no search index yet; the studio searches what it holds.
                  </p>
                )}
              </div>
            )}

            {/* grouped results */}
            <div ref={listRef} role="listbox" aria-label="Palette results" className="flex-1 overflow-y-auto py-1">
              {rows.length === 0 && (
                <p
                  className="px-4 py-3"
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-dim)' }}
                >
                  nothing matches
                </p>
              )}
              {rows.map((row, i) => {
                const first = i === 0 || rows[i - 1]?.en.group !== row.en.group;
                const shared = {
                  'data-testid': 'palette-row',
                  'data-group': row.en.group,
                  'data-selected': i === selIx ? 'true' : 'false',
                  role: 'option',
                  'aria-selected': i === selIx,
                  onClick: (e: React.MouseEvent) => {
                    e.preventDefault();
                    activate(row);
                  },
                  onMouseEnter: () => setSel(i),
                  className: 'block w-full px-4 py-1.5 text-left',
                  style: {
                    background: i === selIx ? 'var(--accent-subtle)' : 'transparent',
                    outline: i === selIx ? '2px solid var(--accent)' : 'none',
                    outlineOffset: -2,
                  } as React.CSSProperties,
                } as const;
                const body = (
                  <>
                    <span className="flex w-full min-w-0 items-baseline gap-3">
                      {/* §5.2 hit anatomy: a status dot for runs, a glyph for
                          gates/decisions/repos/prompts — before the label. */}
                      {row.en.dot !== undefined && (
                        <span
                          aria-hidden
                          style={{
                            width: '6px', height: '6px', flexShrink: 0,
                            borderRadius: 'var(--radius-full)', alignSelf: 'center',
                            background: row.en.dot,
                          }}
                        />
                      )}
                      {row.en.glyph !== undefined && (
                        <span aria-hidden className="shrink-0" style={{ color: 'var(--ink-dim)' }}>
                          {row.en.glyph}
                        </span>
                      )}
                      <span
                        {...(row.en.when !== undefined ? { 'data-testid': 'run-title' } : {})}
                        className="min-w-0 flex-1 truncate"
                        style={{
                          fontSize: 'var(--text-sm)',
                          fontFamily: 'var(--font-sans)',
                          color: 'var(--ink-high)',
                        }}
                      >
                        {row.en.group === 'verbs' ? '> ' : ''}
                        {highlight(row.en.label, row.m.positions)}
                      </span>
                      {/* §7.5 (slice Y2): run rows carry the attach clock. */}
                      {row.en.when !== undefined && (
                        <span
                          data-testid="run-when"
                          title={WHEN_TITLE}
                          className="shrink-0 font-mono"
                          style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}
                        >
                          {row.en.when}
                        </span>
                      )}
                      <span
                        className="shrink-0 font-mono"
                        style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}
                      >
                        {row.en.context}
                      </span>
                    </span>
                    {/* §5.3: the snippet line — muted mono, matches in --ink-high. */}
                    {row.en.snippet !== undefined && (
                      <span
                        data-testid="search-snippet"
                        className="block w-full truncate"
                        style={{
                          fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                          color: 'var(--ink-muted)',
                        }}
                      >
                        {highlightSnippet(row.en.snippet, row.en.snippetPositions ?? [])}
                      </span>
                    )}
                  </>
                );
                return (
                  <div key={row.en.id}>
                    {first && (
                      <p
                        className="px-4 pt-2 pb-1 uppercase"
                        style={{
                          fontSize: 'var(--text-2xs)',
                          fontWeight: 'var(--weight-medium)',
                          color: 'var(--ink-dim)',
                          letterSpacing: '0.08em',
                        }}
                      >
                        {GROUP_LABEL[row.en.group]}
                      </p>
                    )}
                    {row.en.href !== undefined ? (
                      <a {...shared} href={row.en.href}>
                        {body}
                      </a>
                    ) : (
                      <button {...shared} type="button">
                        {body}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* hint row */}
            <p
              className="px-4 py-2 shrink-0 font-mono"
              style={{
                fontSize: 'var(--text-2xs)',
                color: 'var(--ink-dim)',
                borderTop: '1px solid var(--surface-raised)',
              }}
            >
              ↑↓ navigate · ↵ open · tab cycle groups · esc close
            </p>
          </div>
        </div>
      )}

      {/* `> New Project` — the slice-A modal, unchanged */}
      {showNewProject && (
        <NewProjectModal navigate={(p: string) => navigate(p)} onClose={() => setShowNewProject(false)} />
      )}

      {/* `> New Document` / `> New Video` outside a project — the Make ＋ fork's
          project-picker stage (§3.4/§8.4): pick a project, land in its mode. */}
      {pickProjectFor !== null && (
        <Modal
          title={pickProjectFor === 'video' ? 'New video' : 'New document'}
          onClose={() => setPickProjectFor(null)}
        >
          <div className="flex flex-col gap-2" data-testid="palette-project-stage">
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-sans)', margin: 0 }}>
              Pick a project — or keep it Unfiled:
            </p>
            <ProjectSwitcher
              current={null}
              projects={projects}
              onSelect={(pid) => {
                // DES-UX-001 §6.2 (slice U): Unfiled routes to the `default`
                // project's mount — the daemon's unfiled home — never a silent
                // close (the same repair as the Make ＋ picker's stage).
                const m = pickProjectFor;
                setPickProjectFor(null);
                navigate(modePath(pid ?? UNFILED_MOUNT, m));
              }}
            />
          </div>
        </Modal>
      )}

      {/* `> Open Terminal` — the RightPanel pair (Modal + governed Terminal) */}
      {showTerminal && (
        <Modal title="Operator shell" onClose={() => setShowTerminal(false)}>
          <Terminal cwd={selectedRun?.session.workdir ?? '.'} governed />
        </Modal>
      )}
    </>
  );
}
