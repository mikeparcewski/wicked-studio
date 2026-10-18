import { isAskTurnRun } from '../board/askTurn.js';
import { waitsOnYou } from '../board/attention.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, FileText, Folder, GitBranch, History, MessageSquareText, Play, Search, ShieldCheck } from 'lucide-react';
import type { RepoEntry, SessionView } from '../api/types.js';
import { api } from '../api/client.js';
import { isRouteAbsent } from '../api/errors.js';
import { MIN_SEARCH_CHARS, SEARCH_TYPES, SEARCH_TYPE_WORDS, type SearchGroup, type SearchHit, type SearchResponse, type SearchSpan, type SearchType } from '../api/search.js';
import { UNFILED_MOUNT } from '../api/interactive.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';
import { fuzzyMatch, type FuzzyResult } from '../palette/fuzzy.js';
import { runTargetHits } from '../palette/runTargets.js';
import type { Navigate } from '../hooks/useRoute.js';
import type { ShortcutEntry } from '../hooks/useGlobalShortcuts.js';
import { useMembershipStore } from '../store/membership.js';
import { useLiveChatsStore } from '../store/liveChats.js';
import { useCampaignsStore } from '../store/campaigns.js';
import { useCapabilities } from '../store/capabilities.js';
import { routeTargets } from '../palette/routeTargets.js';
import { useProjectsStore } from '../store/projects.js';
import { useGateStore } from '../store/gates.js';
import { toggledTheme, useAppearanceStore } from '../theming/appearance.js';
import { decideGate, GATE_HASH } from '../board/gateActions.js';
import { statusWord } from '../board/statusWords.js';
import { relTime } from '../board/relTime.js';
import { readRecentSearches, rememberSearch, searchHitHref } from '../board/searchModel.js';
import { NewProjectModal } from './NewProjectModal.js';
import { PAGE_NAMES } from '../board/pageNames.js';
import { Modal } from './Modal.js';
import { runTitle, runWhenWord, WHEN_TITLE } from './runIdentity.js';
import { Terminal } from './Terminal.js';
import { everythingPath } from '../board/everythingModel.js';
import { seedNewChat } from '../board/chatMoves.js';
import { DEMO_VIDEO_ID, openLaunchWizard } from '../store/launchWizard.js';
import { pageComposerKey } from '../store/composerSeed.js';

/**
 * THE search modal — one component, opened from the rail's Search, the phone top bar and ⌘K /
 * Ctrl+K anywhere (there is no second implementation on the Desk).
 *
 * Two jobs in one box:
 *  - SEARCH: two or more letters ask crew's `GET /search` (debounced, the superseded request
 *    aborted) and the answer is tabbed — All · Runs · Projects · Repos · Transcripts · Rules ·
 *    Memories · Docs. All shows each type's best few with "See all"; a tab pages its type.
 *    A daemon without the route falls back to what studio already holds (runs, projects, repos),
 *    and says so.
 *  - COMMANDS: the verbs (`>`), the GO TO destinations (`go:`), the pointed object's actions, and
 *    the scoped jumps (`p:` / `run:` / `repo:`) stay local and instant, and lead the list, so a
 *    typed page name or verb is still one Enter away.
 *
 * Nothing is fetched on open except the repo list, once per session (§1.4); a search fetches only
 * once something is typed.
 */

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'cancelled', 'failed']);
const ACTIVE: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);
/** Keystrokes coalesce for this long before a search goes out. */
const SEARCH_DEBOUNCE_MS = 150;
/** A source still reading: ask again after this long, at most {@link INDEXING_RETRIES} times. */
const INDEXING_RETRY_MS = 900;
const INDEXING_RETRIES = 3;
/** Hits per type on All; per page on a type's own tab. */
const ALL_LIMIT = 5;
const TAB_LIMIT = 20;
/** Commands kept per group while searching (they lead; hits follow). */
const COMMANDS_WHILE_SEARCHING = 4;

type Tab = 'all' | SearchType;

type Group =
  | 'recent' | 'actions' | 'runs' | 'projects' | 'repos' | 'verbs' | 'go' | 'more'
  | `hit-${SearchType}`;

const GROUP_LABEL: Record<Exclude<Group, `hit-${SearchType}`>, string> = {
  recent: 'Recent searches',
  actions: 'Actions for this',
  runs: 'Runs & gates',
  projects: 'Projects',
  repos: 'Repositories',
  verbs: 'Commands',
  go: 'Go to',
  more: '',
};

const HIT_ICON: Record<SearchType, typeof Play> = {
  run: Play, project: Folder, repo: GitBranch, transcript: MessageSquareText, rule: ShieldCheck, memory: Brain, doc: FileText,
};

interface Entry {
  id: string;
  group: Group;
  /** Fuzzy-matched text. Verbs match on the name after the `>`. */
  label: string;
  /** Dim context (project/status/branch). */
  context: string;
  /** Real-link target (href + onClick-preventDefault, deep-linkable). */
  href?: string;
  /** Verb execution — runs instead of navigation. */
  action?: () => void;
  /** The row acts inside the modal (switch tab, load more, reuse a recent search): it stays open. */
  keepOpen?: boolean;
  /** Group-internal rank: lower first (gates before active before terminal). */
  rank: number;
  /** A search hit: its type (the icon), its title spans and snippet. */
  hit?: SearchHit;
  /** Run rows only (§7.5, slice Y2): the attach-clock word — presence marks the
   *  row's label as the synthesized `run-title` (EC40). */
  when?: string;
}

interface Row { en: Entry; m: FuzzyResult }

/** The modal's view of one query's answers. */
interface SearchState {
  q: string;
  status: 'loading' | 'ok' | 'absent' | 'error';
  /** The All answer (every type's best few, and the totals the tabs show). */
  all: SearchResponse | null;
  /** A type tab's own pages. */
  tabs: Partial<Record<SearchType, { hits: SearchHit[]; next: string | null; total: number; loading: boolean }>>;
  error: string | null;
}

/** Session-scoped repo cache (§1.4) — SHARED with the rail's Repositories
 *  accordion since slice M (DES-FEEDBACK-003 §3.3): one gesture warms both. */
export { clearRepoCache as clearPaletteRepoCache } from '../store/repoCache.js';

/**
 * The two global chords App registers (§1.2) — exported so the wiring the app
 * mounts is the wiring the unit tests exercise. Order matters: the modal
 * toggle first (and it alone survives `paletteOpen`), the relocated kill-run
 * (Ctrl+Shift+K, same guards + silent-fail contract as the old `useKillShortcut`)
 * after it.
 */
export function paletteShortcutEntries(opts: {
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
  /** Ctrl/⌘+Shift+F: open the modal ready to search (the same modal). */
  openSearch: () => void;
  killEligible: () => boolean;
  kill: () => void;
}): ShortcutEntry[] {
  const toggle = (e: KeyboardEvent): void => {
    // studio#473: the chords reach the modal from a focused field too (a modifier chord is never
    // typed text). A field that handled the chord itself — the modal's own input closes on it, an
    // editor may bind ⌘K — said so with preventDefault, and keeps it.
    if (e.defaultPrevented) return;
    e.preventDefault(); // Ctrl+P must suppress browser print
    opts.setOpen(!opts.isOpen());
  };
  return [
    {
      id: 'palette-toggle-k',
      group: 'palette',
      chord: { key: 'k', ctrlOrMeta: true },
      description: 'Search, or run a command',
      handler: toggle,
      allowWhilePaletteOpen: true,
      allowInTypingContext: true,
    },
    {
      id: 'palette-toggle-p',
      group: 'palette',
      chord: { key: 'p', ctrlOrMeta: true },
      description: 'Search, or run a command',
      handler: toggle,
      allowWhilePaletteOpen: true,
      allowInTypingContext: true,
    },
    {
      id: 'palette-search',
      group: 'palette',
      chord: { key: 'f', ctrlOrMeta: true, shift: true },
      description: 'Search everything',
      handler: (e) => {
        if (e.defaultPrevented) return; // studio#473: a field that handled the chord keeps it
        e.preventDefault(); // suppress the browser's find-in-page variants
        opts.openSearch();
      },
      allowInTypingContext: true,
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

/** The modal has the width for a longer title than a rail row (UX gate S1: WRAP). */
const PALETTE_INTENT = 80;

/** A run title's " · ab12cd · #2" tail (runTitle): searchable, not shown. */
const RUN_ID_SUFFIX = / · [0-9a-z]{4,12} · #\d+$/u;

/** Accent the fuzzy-matched characters (§1.5 — the row's only accent). */
function highlight(label: string, positions: number[]): React.ReactNode {
  if (positions.length === 0) return label;
  const set = new Set(positions);
  return label.split('').map((ch, i) =>
    set.has(i) ? (
      <span key={i} className="wk-palette-match">
        {ch}
      </span>
    ) : (
      ch
    ),
  );
}

/** Mark the daemon's matched ranges (`<mark>`, so the match is said, not only coloured). */
function marked(text: string, spans: readonly SearchSpan[], cls: string): React.ReactNode {
  if (spans.length === 0) return text;
  const out: React.ReactNode[] = [];
  let at = 0;
  spans.forEach(([s, e], i) => {
    if (s < at || e > text.length) return;
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={i} className={cls}>{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function hitContext(hit: SearchHit, projectName: (id: string) => string | null): string {
  const parts: string[] = [];
  if (hit.project_id !== null) {
    const name = projectName(hit.project_id);
    if (name !== null) parts.push(name);
  }
  if (hit.status !== null && hit.type !== 'project') parts.push(hit.status === 'awaiting_human' ? 'waiting on you' : hit.status.replace(/_/g, ' '));
  if (hit.updated_at !== null) parts.push(relTime(hit.updated_at));
  return parts.join(' · ');
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
  /** Pre-typed query on OPEN (the rail's Search, a seeded search). */
  seed?: string;
  /** S11: the object ⌘K was pressed on (the open sheet's, else the pointed one) — its actions lead. */
  object?: { title: string; rows: Array<{ id: string; label: string; run: () => void; disabled: string | null }> } | null;
}

export function CommandPalette({
  open, onClose, runs, navigate, runPath, projectId, selectedRun, onKill, seed = '', object = null,
}: Props): React.ReactElement | null {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<Tab>('all');
  const [repos, setRepos] = useState<RepoEntry[]>(getCachedRepos() ?? []);
  const [recent, setRecent] = useState<string[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [found, setFound] = useState<SearchState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const inflight = useRef<AbortController | null>(null);

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
      setTab('all');
      setFound(null);
      inflight.current?.abort();
      inflight.current = null;
      return;
    }
    restoreRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    setRecent(readRecentSearches());
    // `?` was the old search-mode prefix: searching is the default now, so a `?` seed is no seed.
    if (seed !== '' && seed !== '?') setQuery(seed);
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
    // preventScroll: handing focus back must not scroll the view the operator left (wave 1 —
    // the board's toggle sat above the scrolled-to cards, and focusing it jumped to the top).
    restoreRef.current?.focus?.({ preventScroll: true });
  };

  // ── The grammar: a prefix scopes to one local group; plain words search ──────────────────────
  const { scope, needle } = useMemo(() => {
    const q = query.trimStart();
    if (q.startsWith('>')) return { scope: 'verbs' as const, needle: q.slice(1).trim() };
    if (q.startsWith('p:')) return { scope: 'projects' as const, needle: q.slice(2).trim() };
    if (q.startsWith('run:')) return { scope: 'runs' as const, needle: q.slice(4).trim() };
    if (q.startsWith('repo:')) return { scope: 'repos' as const, needle: q.slice(5).trim() };
    if (q.startsWith('go:')) return { scope: 'go' as const, needle: q.slice(3).trim() };
    // A leading `?` (the retired search-mode prefix, still in fingers) is just a search.
    return { scope: 'all' as const, needle: q.replace(/^\?/u, '').trim() };
  }, [query]);
  const searching = open && scope === 'all' && needle.length >= MIN_SEARCH_CHARS;
  const searchingRef = useRef(searching);
  searchingRef.current = searching;
  // Leaving search (a prefix, a cleared box) returns to All.
  useEffect(() => { if (!searching) setTab('all'); }, [searching]);

  // ── The search: debounced, the superseded request aborted, a still-reading source asked again ─
  useEffect(() => {
    inflight.current?.abort();
    inflight.current = null;
    if (!searching) { setFound(null); return undefined; }
    const q = needle;
    setFound((prev) => (prev !== null && prev.q === q ? prev : { q, status: 'loading', all: prev?.all ?? null, tabs: {}, error: null }));
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = (): void => {
      const ac = new AbortController();
      inflight.current = ac;
      api.search(q, { limit: ALL_LIMIT, signal: ac.signal })
        .then((res) => {
          if (ac.signal.aborted) return;
          setFound((prev) => ({ q, status: 'ok', all: res, tabs: prev?.q === q ? prev.tabs : {}, error: null }));
          if (Array.isArray(res.sources) && res.sources.some((s) => s.state === 'indexing') && retries < INDEXING_RETRIES) {
            retries += 1;
            timer = setTimeout(ask, INDEXING_RETRY_MS);
          }
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted) return;
          setFound({ q, status: isRouteAbsent(e) ? 'absent' : 'error', all: null, tabs: {}, error: e instanceof Error ? e.message : String(e) });
        });
    };
    timer = setTimeout(ask, SEARCH_DEBOUNCE_MS);
    return () => {
      if (timer !== null) clearTimeout(timer);
      inflight.current?.abort();
      inflight.current = null;
    };
  }, [searching, needle]);

  /** A type tab's page: the first one when the tab opens, the next on "Load more". */
  const foundRef = useRef(found);
  foundRef.current = found;
  const tabAbort = useRef<AbortController | null>(null);
  const loadTab = useCallback((type: SearchType, more: boolean): void => {
    const prev = foundRef.current;
    if (prev === null || prev.status !== 'ok') return;
    const page = prev.tabs[type];
    if (page?.loading === true || (!more && page !== undefined) || (more && (page === undefined || page.next === null))) return;
    const q = prev.q;
    const settle = (next: { hits: SearchHit[]; next: string | null; total: number; loading: boolean }): void =>
      setFound((cur) => (cur === null || cur.q !== q ? cur : { ...cur, tabs: { ...cur.tabs, [type]: next } }));
    settle({ hits: page?.hits ?? [], next: page?.next ?? null, total: page?.total ?? 0, loading: true });
    tabAbort.current?.abort();
    const ac = new AbortController();
    tabAbort.current = ac;
    api.search(q, { types: [type], limit: TAB_LIMIT, ...(more && page !== undefined ? { cursor: page.next } : {}), signal: ac.signal })
      .then((res) => {
        if (ac.signal.aborted) return;
        const g: SearchGroup | undefined = (res.groups ?? []).find((x) => x.type === type);
        const before = more ? page?.hits ?? [] : [];
        settle({ hits: [...before, ...(g?.hits ?? [])], next: g?.next_cursor ?? null, total: g?.total ?? before.length, loading: false });
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        settle({ hits: page?.hits ?? [], next: null, total: page?.total ?? 0, loading: false });
      });
  }, []);
  useEffect(() => {
    if (tab !== 'all' && found !== null && found.q === needle && found.status === 'ok') loadTab(tab, false);
  }, [tab, found, needle, loadTab]);
  useEffect(() => () => tabAbort.current?.abort(), []);

  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  // §7.5 (slice Y2): the attach clock for run rows — the mirror the board
  // model already writes; a store read, never a fetch (§1.4's budget holds).
  const attachedAtByRun = useMembershipStore((s) => s.attachedAtByRun);
  const liveChats = useLiveChatsStore((s) => s.sessions);
  const campaigns = useCampaignsStore((s) => s.campaigns);
  const runChatId = useCapabilities((s) => s.runChatId);
  const projectName = useCallback((id: string): string | null => projects.find((p) => p.id === id)?.name ?? null, [projects]);

  // GO TO's rows, rebuilt only when what they are made of changes — never per keystroke.
  const goTargets = useMemo(() => routeTargets({
    projects: projects.filter((p) => p.status === 'active'),
    runs,
    projectIdByRun,
    chats: Object.entries(liveChats).map(([id, c]) => ({ id, title: c.title ?? 'a chat' })),
    campaigns: campaigns.map((c) => ({ id: c.id, label: c.def?.name ?? c.id })),
    runChatId,
  }), [projects, runs, projectIdByRun, liveChats, campaigns, runChatId]);

  const openAs = useCallback((hit: SearchHit): string => searchHitHref(hit, { runChatId, runs }), [runChatId, runs]);

  const rows = useMemo((): Row[] => {
    const status = selectedRun?.session.status ?? '';
    const entries: Entry[] = [];

    // Runs & gates — a gated run IS its gate row (deep link to #gate); rank:
    // gates first (attention order — the list is already daemon-sorted), then
    // active runs, terminal runs after (§1.3 prefix table).
    for (const v of runs) {
      const id = v.session.id;
      // One definition of waiting (`waitsOnYou`): an answered ask at its turn gate is not, whatever the gate store holds.
      const gated = waitsOnYou(v.session) || (gates[id] !== undefined && !isAskTurnRun(v.session));
      const w = runWhenWord(attachedAtByRun[id], Date.now(), v.session.created_at);
      entries.push({
        id: `run-${id}`,
        group: 'runs',
        // §7.5 (slice Y2, EC40): the synthesized title IS the matched label
        // here — typing a short-id now finds its run.
        label: runTitle(v.session, PALETTE_INTENT),
        context: gated ? 'Waiting on you' : statusWord(v).word,
        href: gated ? `${runPath(id)}${GATE_HASH}` : runPath(id),
        rank: gated ? 0 : ACTIVE.has(v.session.status) ? 1 : 2,
        ...(w !== 'time unknown' ? { when: w } : {}),
      });
    }

    // Projects — the store the board/shell already loaded; the synthesized
    // Unfiled bucket never renders (F5). Recency-ordered (`updated_at`).
    const visible = projects.filter((p) => p.id !== 'default' && p.status === 'active');
    const byRecency = [...visible].sort((a, b) => b.updated_at - a.updated_at);
    byRecency.forEach((p, i) =>
      entries.push({
        id: `project-${p.id}`,
        group: 'projects',
        label: p.name,
        context: 'project',
        href: everythingPath({ tab: 'sessions', project: p.id }),
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

    // S11: the pointed object's actions lead (DESIGN-interaction rule 9). A row that cannot run now
    // says why in its context and does nothing.
    object?.rows.forEach((r, i) => {
      entries.push({
        id: `act-${r.id}`, group: 'actions', label: r.label, context: r.disabled ?? '',
        action: r.disabled === null ? r.run : () => {}, rank: i,
      });
    });

    // Verbs (§1.3's table — each names its existing mechanism, none invents one).
    const verbs: Array<{ name: string; action: () => void; when?: boolean }> = [
      {
        // The launch wizard (operator 2026-10-11): a new job opens the one modal where you are — it
        // asks for the kind of job first; a session page's composer is the one it launches from.
        // Nothing is sent until Launch.
        name: 'New job',
        action: () => {
          onClose();
          openLaunchWizard({ projectId, composerKey: pageComposerKey() ?? 'desk' });
        },
      },
      {
        // S16a-4e: a new chat — the Ask dock, in the ambient project when there is one.
        name: 'New Chat',
        action: () => {
          onClose();
          seedNewChat(projectId);
        },
      },
      {
        // S16a-4d: the Made list with its "New document" door open, the ambient project preselected
        // (the door picks the project itself — no picker modal first).
        name: 'New Document',
        action: () => {
          onClose();
          navigate(everythingPath({ tab: 'made', ...(projectId !== null && projectId !== 'default' ? { project: projectId } : {}), new: 'document' }));
        },
      },
      {
        // studio#664: a demo video is its own job — the New job wizard opens on its form (the app's
        // address, who it is for, what it shows), in the ambient project when there is one.
        name: 'New Demo',
        action: () => {
          onClose();
          // codex r2: a page that names Unfiled (`?project=default`) opens the form unfiled, named, like
          // the videos door — so a draft saved for another project never resumes there. With no
          // project in view, the saved draft resumes (the wizard's rule).
          // codex r3: so does a route that IS the unfiled project (`/projects/default`).
          const unfiledHere = projectId === UNFILED_MOUNT
            || (projectId === null && new URLSearchParams(window.location.search).get('project') === UNFILED_MOUNT);
          openLaunchWizard({ workflowId: DEMO_VIDEO_ID, projectId: unfiledHere ? UNFILED_MOUNT : projectId, composerKey: pageComposerKey() ?? 'desk' });
        },
      },
      { name: 'New Project', action: () => setShowNewProject(true) },
      {
        name: 'Toggle Theme',
        action: () => {
          const cur = useAppearanceStore.getState().appearance.theme;
          useAppearanceStore.getState().chooseTheme(toggledTheme(cur));
        },
      },
      { name: 'Open Terminal', action: () => setShowTerminal(true) },
      // Wave 1: the daemon's configuration surface, one verb away (a route — Back returns). The page is
      // "General" since the rail restructure (2026-10-13); the verb still starts "Configure", so `>config`
      // finds it, and the GO TO row ("General — settings for …") answers "settings".
      { name: `Configure studio — ${PAGE_NAMES.system}`, action: () => navigate('/system') },
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
      entries.push({ id: `verb-${v.name}`, group: 'verbs', label: v.name, context: 'command', action: v.action, rank: i });
    });

    // GO TO — every route the router serves, so each is reachable by ⌘K (the skin contract;
    // COVERAGE.md finding 1). With nothing typed only the destinations list; the per-item rows
    // (a run's events, a project's chronicle, …) are found by a word, so the open list stays short.
    goTargets.forEach((t, i) => {
      // Searching: an item's own pages (a project's documents, a run's events…) are the daemon's hits
      // now, one row per item; `go:` still lists every one.
      if ((needle === '' || searching) && t.perItem) return;
      entries.push({ id: `go-${t.href}`, group: 'go', label: t.label, context: t.href, href: t.href, rank: i });
    });

    const order: Group[] = ['actions', 'runs', 'projects', 'repos', 'verbs', 'go'];
    const rank = (list: Entry[]): Row[] => list
      .map((en) => ({ en, m: fuzzyMatch(needle, en.label) }))
      .filter((x): x is Row => x.m !== null)
      .sort((a, b) => {
        const g = order.indexOf(a.en.group) - order.indexOf(b.en.group);
        if (g !== 0) return g;
        if (b.m.score !== a.m.score) return b.m.score - a.m.score;
        return a.en.rank - b.en.rank;
      });

    // ── A scoped prefix: one local group, as before ──
    if (scope !== 'all') {
      const matched = rank(entries.filter((en) => en.group === scope));
      // Wave 1 ("raw in one step"): `>events r1` / `>files <name>` — a raw target for ANY
      // run, resolved by the palette model and listed ahead of the plain verbs.
      if (scope === 'verbs') {
        const targeted = runTargetHits(needle, runs).map((hit, i): Row => ({
          en: {
            id: `target-${hit.target.key}-${hit.run.session.id}`,
            group: 'verbs',
            label: `${hit.target.name} · ${runTitle(hit.run.session)}`,
            context: hit.run.session.status,
            href: hit.href,
            rank: i,
          },
          m: { score: 0, positions: [] },
        }));
        return [...targeted, ...matched];
      }
      return matched;
    }

    // ── Nothing (or one letter) typed: recent searches, then the jump list ──
    if (!searching) {
      const lead: Row[] = needle === '' ? recent.map((r, i) => ({
        en: { id: `recent-${r}`, group: 'recent', label: r, context: '', action: () => { setQuery(r); setSel(0); }, keepOpen: true, rank: i },
        m: { score: 0, positions: [] },
      })) : [];
      return [...lead, ...rank(entries)];
    }

    // ── Searching ──
    const commands = rank(entries.filter((en) => en.group === 'actions' || en.group === 'verbs' || en.group === 'go'));
    const capped: Row[] = [];
    const perGroup = new Map<Group, number>();
    for (const r of commands) {
      const n = perGroup.get(r.en.group) ?? 0;
      if (r.en.group !== 'actions' && n >= COMMANDS_WHILE_SEARCHING) continue;
      perGroup.set(r.en.group, n + 1);
      capped.push(r);
    }
    const hitRow = (hit: SearchHit, i: number): Row => ({
      en: { id: `hit-${hit.type}-${hit.id}`, group: `hit-${hit.type}`, label: hit.title, context: hitContext(hit, projectName), href: openAs(hit), rank: i, hit },
      m: { score: 0, positions: [] },
    });
    // While the next answer is on its way, the last one stays up (no flicker between keystrokes).
    const daemonAnswers = found !== null && found.all !== null && (found.status === 'ok' || found.status === 'loading');
    if (tab !== 'all') {
      const page = found?.tabs[tab];
      const hits = page?.hits ?? [];
      const out = hits.map(hitRow);
      if (page !== undefined && page.next !== null) {
        out.push({ en: { id: `more-${tab}`, group: 'more', label: page.loading ? 'Loading more…' : `Load more ${SEARCH_TYPE_WORDS[tab].tab.toLowerCase()}`, context: `${hits.length} of ${page.total}`, action: () => loadTab(tab, true), keepOpen: true, rank: 0 }, m: { score: 0, positions: [] } });
      }
      return out;
    }
    if (daemonAnswers) {
      const out: Row[] = [...capped];
      for (const g of found.all!.groups ?? []) {
        g.hits.forEach((h, i) => out.push(hitRow(h, i)));
        if (g.total > g.hits.length) {
          const t = g.type;
          out.push({ en: { id: `more-${t}`, group: 'more', label: `See all ${g.total} ${SEARCH_TYPE_WORDS[t].tab.toLowerCase()}`, context: '', action: () => { setTab(t); setSel(0); }, keepOpen: true, rank: 0 }, m: { score: 0, positions: [] } });
        }
      }
      return out;
    }
    // Before the daemon answers, or without its search: what studio already holds, matched here.
    const local = rank(entries.filter((en) => en.group === 'runs' || en.group === 'projects' || en.group === 'repos'));
    return [...capped, ...local];
  }, [runs, projects, repos, gates, attachedAtByRun, goTargets, object, scope, needle, searching, recent, found, tab, runPath, navigate, projectId, selectedRun, onKill, onClose, projectName, openAs, loadTab]);

  // Clamp the selection whenever the row set changes.
  const selIx = Math.min(sel, Math.max(0, rows.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selIx, rows]);

  const activate = (row: Row | undefined): void => {
    if (row === undefined) return;
    if (row.en.keepOpen === true) {
      row.en.action?.();
      inputRef.current?.focus();
      return;
    }
    if (searchingRef.current) setRecent(rememberSearch(needle));
    close();
    if (row.en.action !== undefined) row.en.action();
    else if (row.en.href !== undefined) navigate(row.en.href);
  };

  const tabs: Tab[] = ['all', ...SEARCH_TYPES];
  const totalOf = (t: SearchType): number | null => {
    if (found === null || found.status !== 'ok' || found.all === null) return null;
    return (found.all.groups ?? []).find((g) => g.type === t)?.total ?? 0;
  };
  const moveTab = (dir: 1 | -1): void => {
    const i = tabs.indexOf(tab);
    setTab(tabs[(i + dir + tabs.length) % tabs.length]!);
    setSel(0);
  };
  const tabsShown = searching && found !== null && found.status !== 'absent' && found.status !== 'error';

  // §1.2 precedence: list-navigation keys are handled by the modal's focused
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
      e.preventDefault();
      // Searching: Tab / Shift+Tab move between the tabs. Otherwise: the next group's first row.
      if (tabsShown) { moveTab(e.shiftKey ? -1 : 1); return; }
      const cur = rows[selIx]?.en.group;
      const next = rows.findIndex((r, i) => i > selIx && r.en.group !== cur);
      setSel(next >= 0 ? next : 0);
    }
  };

  // The one status line under the tabs: what the search did, said plainly.
  const statusLine = ((): { text: string; tone: 'quiet' | 'warn' } | null => {
    if (!searching || found === null) return null;
    if (found.status === 'absent') return { text: 'This daemon can’t search everything yet (it needs a newer wicked-crew), so this matches what studio already holds.', tone: 'warn' };
    if (found.status === 'error') return { text: `Search didn’t answer (${found.error ?? 'unknown error'}), so this matches what studio already holds.`, tone: 'warn' };
    if (found.status === 'loading' || found.all === null) return { text: 'Searching…', tone: 'quiet' };
    const sources = found.all.sources ?? [];
    const reading = sources.filter((s) => s.state === 'indexing').map((s) => SEARCH_TYPE_WORDS[s.type].tab.toLowerCase());
    const down = sources.filter((s) => s.state === 'unavailable' && s.note !== 'This daemon has no source for it.');
    const parts: string[] = [];
    if (reading.length > 0) parts.push(`Still reading ${reading.join(', ')}: more may appear.`);
    if (down.length > 0) parts.push(`Couldn’t search ${down.map((s) => SEARCH_TYPE_WORDS[s.type].tab.toLowerCase()).join(', ')}${down[0]!.note !== null ? ` (${down[0]!.note})` : ''}.`);
    if (found.all.partial) parts.push('Took too long to look at everything: counts are at least these.');
    return parts.length > 0 ? { text: parts.join(' '), tone: 'warn' } : null;
  })();
  const hitCount = rows.filter((r) => r.en.hit !== undefined).length;
  const emptyText = searching && found !== null && found.status === 'ok' && found.all !== null && hitCount === 0
    && (tab === 'all' || found.tabs[tab]?.loading === false)
    ? tab === 'all' ? `Nothing matches “${needle}”.` : `No ${SEARCH_TYPE_WORDS[tab].tab.toLowerCase()} match “${needle}”.`
    : null;

  return (
    <>
      {open && (
        <div
          className="wk-palette-scrim fixed inset-0 z-50 flex justify-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            data-testid="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="wk-palette wk-palette-in flex flex-col self-start overflow-hidden"
          >
            {/* input row */}
            <div className="wk-palette-input-row flex items-center gap-2 px-4 py-3 shrink-0">
              <Search size={16} className="wk-palette-input-icon" aria-hidden />
              <input
                ref={inputRef}
                data-testid="palette-input"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSel(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search runs, projects, repos, transcripts, rules… or type > for commands"
                aria-label="Search everything, or type > for commands"
                aria-controls="palette-results"
                aria-activedescendant={rows[selIx] !== undefined ? `palette-opt-${selIx}` : undefined}
                role="combobox"
                aria-expanded="true"
                autoComplete="off"
                spellCheck={false}
                className="wk-palette-input flex-1 bg-transparent outline-none"
              />
              <kbd className="font-mono wk-palette-esc">esc</kbd>
              {/* Phone: a visible way out (UX gate S1: AFF); desktop keeps the esc keycap. */}
              <button type="button" data-testid="palette-close" aria-label="Close" title="Close" onClick={close} className="wk-btn wk-btn--icon wk-btn--quiet wk-palette-close">✕</button>
            </div>

            {tabsShown && (
              <div role="tablist" aria-label="What to search" data-testid="search-tabs" className="wk-palette-tabs">
                {tabs.map((t) => {
                  const n = t === 'all' ? null : totalOf(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      tabIndex={-1}
                      data-testid="search-tab"
                      data-type={t}
                      aria-selected={tab === t}
                      className="wk-palette-tab"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setTab(t); setSel(0); inputRef.current?.focus(); }}
                    >
                      {t === 'all' ? 'All' : SEARCH_TYPE_WORDS[t].tab}
                      {n !== null && <span className="wk-palette-tab-count" data-testid="search-tab-count">{n > 99 ? '99+' : n}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {statusLine !== null && (
              <p data-testid="search-status" data-tone={statusLine.tone} className="wk-palette-status" aria-live="polite">{statusLine.text}</p>
            )}

            {/* grouped results */}
            <div ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="wk-palette-list flex-1 overflow-y-auto py-1">
              {emptyText !== null && (
                <div data-testid="search-empty" className="wk-palette-empty">
                  <p className="wk-palette-empty-title">{emptyText}</p>
                  <p className="wk-palette-empty-line">Try fewer or shorter words — every word has to match.</p>
                </div>
              )}
              {rows.length === 0 && emptyText === null && (
                <p className="wk-palette-empty-line px-4 py-3">
                  {searching && found?.status === 'loading' ? 'Searching…' : 'nothing matches'}
                </p>
              )}
              {rows.map((row, i) => {
                const first = i === 0 || rows[i - 1]?.en.group !== row.en.group;
                const hit = row.en.hit;
                const isRun = row.en.group === 'runs';
                const shared = {
                  id: `palette-opt-${i}`,
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
                  className: `wk-palette-row block w-full px-4 py-1.5 text-left${row.en.group === 'more' ? ' wk-palette-row--more' : ''}`,
                  ...(isRun || hit !== undefined ? { title: row.en.label } : {}),
                } as const;
                const Icon = hit !== undefined ? HIT_ICON[hit.type] : row.en.group === 'recent' ? History : null;
                const body = (
                  <>
                    <span className="wk-palette-line flex w-full min-w-0 items-baseline gap-3">
                      {Icon !== null && <Icon size={14} aria-hidden className="wk-palette-row-icon shrink-0" />}
                      <span
                        {...(row.en.when !== undefined ? { 'data-testid': 'run-title' } : {})}
                        className="wk-palette-title min-w-0 flex-1 truncate"
                      >
                        {row.en.group === 'verbs' ? '> ' : ''}
                        {hit !== undefined
                          ? marked(row.en.label, hit.title_spans, 'wk-palette-mark')
                          : (() => {
                            // A run's short id and attempt stay searchable (the matched label) but the row
                            // shows the title in words (UX gate S1: JARGON); the id is the row's tooltip.
                            const shown = row.en.when !== undefined || isRun ? row.en.label.replace(RUN_ID_SUFFIX, '') : row.en.label;
                            return highlight(shown, row.m.positions.filter((p) => p < shown.length));
                          })()}
                      </span>
                      {/* §7.5 (slice Y2): run rows carry the attach clock. */}
                      {row.en.when !== undefined && (
                        <span data-testid="run-when" title={WHEN_TITLE} className="shrink-0 wk-palette-meta">
                          {row.en.when}
                        </span>
                      )}
                      {row.en.context !== '' && <span className="shrink-0 wk-palette-meta">{row.en.context}</span>}
                    </span>
                    {/* The matched words in context — muted, the match marked. */}
                    {hit !== undefined && hit.snippet !== null && (
                      <span data-testid="search-snippet" className="wk-palette-snippet block w-full truncate">
                        {marked(hit.snippet, hit.snippet_spans, 'wk-palette-snippet-mark')}
                      </span>
                    )}
                  </>
                );
                const heading = row.en.group === 'more' ? null
                  : row.en.group.startsWith('hit-') ? (tab === 'all' ? SEARCH_TYPE_WORDS[row.en.group.slice(4) as SearchType].tab : null)
                    : row.en.group === 'actions' && object !== null ? `Actions for ${object.title}`
                      : GROUP_LABEL[row.en.group as Exclude<Group, `hit-${SearchType}`>];
                return (
                  <div key={row.en.id}>
                    {first && heading !== null && <p className="wk-palette-group px-4 pt-2 pb-1">{heading}</p>}
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
            <p className="wk-palette-hint px-4 py-2 shrink-0">
              {tabsShown ? '↑↓ move · ↵ open · tab next tab · esc close' : '↑↓ move · ↵ open · > commands · esc close'}
            </p>
          </div>
        </div>
      )}

      {/* `> New Project` — the slice-A modal, unchanged */}
      {showNewProject && (
        <NewProjectModal navigate={(p: string) => navigate(p)} onClose={() => setShowNewProject(false)} />
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
