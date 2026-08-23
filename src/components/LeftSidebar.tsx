import { useEffect, useRef, useState } from 'react';
import type { RepoEntry, SessionView } from '../api/types.js';
import { UNFILED_MOUNT, type DocSummary } from '../api/interactive.js';
import { ambientProjectId, launchPath, registerRepoPath } from '../hooks/ambientProject.js';
import { useBoardModel, type BoardProject } from '../hooks/useBoardModel.js';
import { modePath, projectPath, versionPath, type Mode } from '../hooks/useRoute.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';
import { useLiveChatsStore } from '../store/liveChats.js';
import { useProjectsStore } from '../store/projects.js';
import { AppChrome } from './AppChrome.js';
import { isChatRun } from './ChatsPage.js';
import { HealthRailSection } from './HealthRailSection.js';
import { MODE_SPECS } from './ModeSwitcher.js';
import { NewProjectModal } from './NewProjectModal.js';
import { NotificationBell } from './NotificationBell.js';
import { ATTENTION_DOT } from './ProjectCard.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';
import { phaseWord, RUN_DOT } from './RunsSection.js';
import { SettingsShortcutRows } from './SettingsRailSection.js';

/**
 * The rail, re-architected around FIVE PRIMARY PATHS (DES-FEEDBACK-003 §2/§3,
 * slice M): Projects / Make / Chat / Repositories / Settings, each a heading
 * row with a strict ONE-OPEN accordion (EC26). Each heading (except Settings —
 * the operator: "setting won't have the dashboard/icons") carries a ▦ dashboard
 * link and a ＋ create action at heading level (EC20 as amended: heading-level
 * ＋ icons are the sanctioned spelling; no `+` inside accordion contents).
 *
 * What the rail STOPPED being (§1.2/§8.1): a launcher shelf (QUICK gone — the
 * verbs live on the headings' ＋ and in the palette), a second home board (the
 * inline runs section gone — run awareness moves to the bottom panel, slice N;
 * until N lands the flat `/runs` route is the interim home of run lists), and
 * a junk drawer (both standalone taxonomies fold into their headings).
 *
 * Fetch discipline (§3.3): the accordion fetches on EXPAND only — the repo 5s
 * poll RETIRED; the Repositories accordion shares the palette's session repo
 * cache (one `GET /repos` per session, gesture-driven). Everything else reads
 * data the app already holds (`runs` prop, board model, projects store).
 */

interface Props {
  runs: SessionView[];
  navigate: (path: string) => void;
  /** The current pathname — drives the route→heading map (§3.2). */
  pathname: string;
  /** DES-FEEDBACK-001 §1.4: where a run row navigates — the caller's same
   *  routing as `selectRun`. Defaults to the flat `/runs/:id` route. */
  runPath?: (id: string) => string;
  /** DES-FEEDBACK-001 §7.3: Document/Video are canvas-first, so entering them
   *  auto-collapses the rail to its icon state; leaving restores what the user had.
   *  Hover-peek still works, and the expand control stays live — auto, not locked. */
  immersive?: boolean;
}

// The rail is chrome (`--surface-rail`); the token dress is §3.1/§3.5's.
const S = {
  bg:      'var(--surface-rail)',
  border:  'var(--surface-raised)',
  ink:     'var(--ink-body)',
  high:    'var(--ink-high)',
  muted:   'var(--ink-muted)',
  faint:   'var(--ink-dim)',
  hover:   'var(--surface-card)',
  accent:  'var(--accent)',
};

// ── The five paths (§2.1) ─────────────────────────────────────────────────────

export type PathKey = 'projects' | 'make' | 'chat' | 'repos' | 'settings';

/** Heading word, collapsed-rail glyph (§3.2), ▦ target (§2.1; Settings' glyph
 *  links `/system` in the collapsed column — it has no dashboard). `noun` is
 *  the SINGULAR the ＋ affordance creates (DES-UX-001 §7.10's grammar fix:
 *  "New Project", never "New Projects"). */
interface PathSpec { key: PathKey; title: string; noun: string; glyph: string; dash: string | null; collapsedHref: string }
const P_PROJECTS: PathSpec = { key: 'projects', title: 'Projects',     noun: 'Project',    glyph: '◇', dash: '/projects', collapsedHref: '/projects' };
const P_MAKE: PathSpec     = { key: 'make',     title: 'Make',         noun: 'Document',   glyph: '⚒', dash: '/make',     collapsedHref: '/make' };
const P_CHAT: PathSpec     = { key: 'chat',     title: 'Chat',         noun: 'Chat',       glyph: '💬', dash: '/chats',    collapsedHref: '/chats' };
const P_REPOS: PathSpec    = { key: 'repos',    title: 'Repositories', noun: 'Repository', glyph: '⬡', dash: '/repos',    collapsedHref: '/repos' };
const P_SETTINGS: PathSpec = { key: 'settings', title: 'Settings',     noun: 'Setting',    glyph: '⚙', dash: null,        collapsedHref: '/system' };
const PATHS: PathSpec[] = [P_PROJECTS, P_MAKE, P_CHAT, P_REPOS, P_SETTINGS];

const SETTINGS_ROUTES = new Set(['system', 'theme', 'coverage', 'domain', 'workflows', 'policies', 'rules']);

/**
 * The route→heading map (§3.2): which primary path owns a pathname. `/` and
 * `/runs*` map to NONE — five closed headings, the rail's calmest reading.
 * Exported pure so the default-expansion contract is unit-pinned.
 */
export function headingForPath(pathname: string): PathKey | null {
  const [, first = '', second = ''] = pathname.split('/');
  if (first === 'projects' || first === 'p') return 'projects';
  if (first === 'make') return 'make';
  // `/chat/new` AND `/chat/:id` (J4/C6: a live session's real URL) are Chat's.
  if (first === 'chats' || (first === 'chat' && second !== '')) return 'chat';
  if (first === 'repos' || first === 'repo-detail') return 'repos';
  if (SETTINGS_ROUTES.has(first)) return 'settings';
  return null;
}

// The Chat predicate — ChatsPage's filter VERBATIM (§3.3: runs with no
// workflow stamp are chats there and must not double-list under Make);
// imported from its one source so the partition cannot drift.

const RUN_TERMINAL = new Set(['completed', 'cancelled', 'failed']);

/** Active before terminal, incoming order preserved (the RunsSection contract). */
function orderRuns(runs: SessionView[]): SessionView[] {
  const active = runs.filter((v) => !RUN_TERMINAL.has(v.session.status));
  const terminal = runs.filter((v) => RUN_TERMINAL.has(v.session.status));
  return [...active, ...terminal];
}

// Accordion caps (§3.3): shortcuts, never a second dashboard.
const PROJECTS_MAX = 6;
const MADE_MAX = 5;
const CHATS_MAX = 5;
const REPOS_MAX = 4;
/** Of MADE_MAX, at most this many are doc/demo rows (per-project loaded docs
 *  only — §4.2.2's scoped rule; the complete census lives on `/make`). */
const MADE_DOCS_MAX = 2;

// ── Sub-components ────────────────────────────────────────────────────────────

/** One rail project row: the board's attention dot + the name — reused verbatim
 *  from the slice-3 taxonomy (§3.3: "ProjectRow, reused verbatim"). */
function ProjectRow({ item, onOpen }: { item: BoardProject; onOpen: () => void }): React.ReactElement {
  const { project, attention, score, band } = item;
  return (
    <button
      type="button"
      data-testid="rail-project"
      data-project-id={project.id}
      data-band={band}
      data-score={score.toFixed(2)}
      onClick={onOpen}
      title={project.name}
      className="w-full text-left px-3 py-1.5 rounded-md transition-colors"
      style={{ background: 'transparent' }}
      onMouseEnter={e => { e.currentTarget.style.background = S.hover; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: ATTENTION_DOT[attention] }}
        />
        <span className="flex-1 truncate text-xs leading-tight font-mono" style={{ color: S.muted }}>
          {project.name}
        </span>
      </div>
    </button>
  );
}

/** One run row — the RunsSection row grammar (status dot + intent + phase word),
 *  reused for the Make and Chat accordions (§3.3). */
function RunRow({ view, onOpen }: { view: SessionView; onOpen: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      data-testid="rail-run"
      data-run-id={view.session.id}
      data-status={view.session.status}
      onClick={onOpen}
      title={view.session.problem}
      className="w-full text-left px-3 py-1 rounded-md transition-colors"
      style={{ background: 'transparent' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = S.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: RUN_DOT[view.session.status] ?? 'var(--ink-dim)' }}
        />
        <span
          className="truncate leading-tight"
          style={{ maxWidth: '24ch', fontSize: 'var(--text-xs)', color: S.ink, fontFamily: 'var(--font-sans)' }}
        >
          {view.session.problem}
        </span>
        <span
          className="ml-auto shrink-0"
          style={{ fontSize: 'var(--text-2xs)', color: S.faint, fontFamily: 'var(--font-mono)' }}
        >
          {phaseWord(view)}
        </span>
      </div>
    </button>
  );
}

/** `view all ›` — the SAME target as the heading's ▦, spelled for the reader
 *  (§3.3); a real link, like every navigation affordance here. */
function ViewAll({ href, navigate }: { href: string; navigate: (p: string) => void }): React.ReactElement {
  return (
    <a
      href={href}
      data-testid="rail-view-all"
      onClick={(e) => { e.preventDefault(); navigate(href); }}
      className="block px-3 pt-1 pb-1 text-[11px] font-mono transition-opacity hover:opacity-80"
      style={{ color: S.accent, textDecoration: 'none' }}
    >
      view all ›
    </a>
  );
}

function EmptyRow({ label, href, navigate }: { label: string; href: string; navigate: (p: string) => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className="px-3 py-1 text-left text-[11px] italic font-mono transition-opacity hover:opacity-70"
      style={{ color: S.faint }}
    >
      {label}
    </button>
  );
}

/** A doc/demo row in the Make accordion: `▤/▶ name · vN` (§3.1's anatomy),
 *  from the doc lists the board model already loaded — never a new fetch. */
function DocRow({ doc, projectId, projectName, navigate }: {
  doc: DocSummary; projectId: string; projectName: string; navigate: (p: string) => void;
}): React.ReactElement {
  const mode: Mode = doc.kind === 'demo' ? 'video' : 'document';
  return (
    <button
      type="button"
      data-testid="rail-doc"
      data-doc-kind={doc.kind}
      onClick={() => navigate(versionPath(projectId, doc.name, null, mode))}
      title={`${doc.name} · ${projectName}`}
      className="w-full text-left px-3 py-1 rounded-md transition-colors"
      style={{ background: 'transparent' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = S.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden className="shrink-0" style={{ fontSize: 'var(--text-2xs)', color: S.faint }}>
          {doc.kind === 'demo' ? '▶' : '▤'}
        </span>
        <span
          className="truncate leading-tight"
          style={{ maxWidth: '24ch', fontSize: 'var(--text-xs)', color: S.ink, fontFamily: 'var(--font-sans)' }}
        >
          {doc.name}
        </span>
        <span
          className="ml-auto shrink-0"
          style={{ fontSize: 'var(--text-2xs)', color: S.faint, fontFamily: 'var(--font-mono)' }}
        >
          v{doc.head}
        </span>
      </div>
    </button>
  );
}

/** The heading row (§3.1): title button (chevron + word, toggles), ▦ dashboard
 *  link, ＋ create — Settings renders the title only. The container carries the
 *  testid + `aria-expanded` the EC26 assertions read. */
function RailHeading({ path, open, onToggle, onNew, navigate, children, extra }: {
  path: PathSpec;
  open: boolean;
  onToggle: () => void;
  onNew?: () => void;
  navigate: (p: string) => void;
  /** Accordion contents, rendered only while open. */
  children?: React.ReactNode;
  /** Anchored popover slot (Make's picker) — rendered inside the relative row. */
  extra?: React.ReactNode;
}): React.ReactElement {
  const iconStyle: React.CSSProperties = {
    color: S.faint,
    fontSize: 'var(--text-xs)',
    textDecoration: 'none',
    outlineColor: S.accent,
  };
  const lift = (e: React.MouseEvent<HTMLElement>): void => { e.currentTarget.style.color = S.high; };
  const drop = (e: React.MouseEvent<HTMLElement>): void => { e.currentTarget.style.color = S.faint; };
  return (
    <div data-testid={`rail-heading-${path.key}`} data-open={open} aria-expanded={open}>
      <div className="relative flex items-center px-2 rounded-md transition-colors"
        onMouseEnter={e => { e.currentTarget.style.background = S.hover; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <button
          type="button"
          data-testid={`rail-title-${path.key}`}
          aria-expanded={open}
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2 px-1 py-1.5 text-left"
          style={{
            background: 'transparent',
            color: open ? S.high : S.muted,
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-sans)',
            fontWeight: 'var(--weight-semi)',
            outlineColor: S.accent,
          }}
        >
          <span
            aria-hidden
            data-testid="rail-chevron"
            className="inline-block leading-none"
            style={{
              transition: 'transform var(--dur-fast)',
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            ›
          </span>
          <span className="truncate">{path.title}</span>
        </button>
        {path.dash !== null && (
          <a
            href={path.dash}
            data-testid="heading-dashboard"
            aria-label={`${path.title} dashboard`}
            title={`${path.title} dashboard`}
            onClick={(e) => { e.preventDefault(); navigate(path.dash as string); }}
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded transition-colors"
            style={iconStyle}
            onMouseEnter={lift}
            onMouseLeave={drop}
          >
            ▦
          </a>
        )}
        {onNew && (
          <button
            type="button"
            data-testid="heading-new"
            aria-label={`New ${path.noun}`}
            title={`New ${path.noun}`}
            // Keep the mousedown out of the make-picker's outside-close
            // listener, so ＋ is a true toggle (open picker + click ＋ again
            // = closed, not close-then-reopen).
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onNew}
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded transition-colors"
            style={{ ...iconStyle, background: 'transparent' }}
            onMouseEnter={lift}
            onMouseLeave={drop}
          >
            ＋
          </button>
        )}
        {extra}
      </div>
      {open && (
        <div className="flex flex-col pb-1" style={{ paddingLeft: 'var(--space-4)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── The make-picker (§3.4): Make's ＋ forks three ways ─────────────────────────

const MAKE_MODES: Mode[] = ['build', 'document', 'video'];

function MakePicker({ navigate, onClose, ambient }: {
  navigate: (p: string) => void;
  onClose: () => void;
  /** The ambient project (shared derivation, DES-UX-001 §2.3 rule 1) — Build
   *  from inside a project context opens the PRE-BOUND form, never Unfiled. */
  ambient: string | null;
}): React.ReactElement {
  /** null = the three rows; a mode = the project-picker stage (Document/Video). */
  const [stage, setStage] = useState<Mode | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const projects = useProjectsStore((s) => s.projects);

  useEffect(() => {
    function onOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [onClose]);

  const pick = (m: Mode): void => {
    if (m === 'build') {
      // Slice S (DES-UX-001 §2.3 rule 1): inside a project context the launch
      // form opens PRE-BOUND (`/p/:id/build/new`, the slice-B lock); outside
      // one, the flat Unfiled-default form — the old slice-B semantics (§3.4).
      onClose();
      navigate(launchPath(ambient, 'build'));
      return;
    }
    // A doc lives in a project — the bridge mounts per project (§3.4): pick one
    // first. Entering the stage is the gesture that loads the list if cold.
    if (projects.length === 0) void useProjectsStore.getState().load();
    setStage(m);
  };

  const real = projects.filter((p) => p.id !== 'default');

  return (
    <div
      ref={ref}
      data-testid="make-picker"
      role="menu"
      className="absolute right-0 top-8 z-30 w-60 py-1"
      style={{
        background: 'var(--surface-raised)',
        boxShadow: 'var(--shadow-raised)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {stage === null ? (
        MAKE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="menuitem"
            data-testid="make-picker-row"
            data-mode={m}
            onClick={() => pick(m)}
            className="w-full flex items-baseline gap-2 px-3 py-1.5 text-left transition-colors"
            style={{ background: 'transparent', outlineColor: S.accent }}
            onMouseEnter={e => { e.currentTarget.style.background = S.hover; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span aria-hidden style={{ fontSize: 'var(--text-xs)' }}>{MODE_SPECS[m].glyph}</span>
            <span style={{ fontSize: 'var(--text-xs)', color: S.ink, fontFamily: 'var(--font-sans)', fontWeight: 'var(--weight-semi)' }}>
              {MODE_SPECS[m].label}
            </span>
            <span className="truncate" style={{ fontSize: 'var(--text-2xs)', color: S.faint, fontFamily: 'var(--font-sans)' }}>
              {MODE_SPECS[m].sublabel}
            </span>
          </button>
        ))
      ) : (
        <div className="px-3 py-1.5 flex flex-col gap-1.5" data-testid="make-picker-project-stage">
          <p style={{ fontSize: 'var(--text-2xs)', color: S.faint, fontFamily: 'var(--font-sans)', margin: 0 }}>
            {real.length === 0
              ? `No projects yet — a ${MODE_SPECS[stage].label.toLowerCase()} can start Unfiled, or create one:`
              : 'Pick a project — or keep it Unfiled:'}
          </p>
          <ProjectSwitcher
            current={null}
            projects={projects}
            onSelect={(pid) => {
              // DES-UX-001 §6.2 (slice U): Unfiled is NO dead end — it routes to
              // the `default` project's mount, the daemon's own unfiled home
              // (crew synthesizes that mount; the doc is created UNBOUND there).
              onClose();
              navigate(modePath(pid ?? UNFILED_MOUNT, stage));
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const flatRunPath = (id: string): string => `/runs/${encodeURIComponent(id)}`;

export function LeftSidebar({ runs, navigate, pathname, runPath = flatRunPath, immersive = false }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [makePickerOpen, setMakePickerOpen] = useState(false);
  // The rail-foot health section (§6.2, slice O) — controlled here so the
  // chrome's connection dot can expand it (its old popover retired, §8.2).
  const [healthOpen, setHealthOpen] = useState(false);
  const onDotClick = (): void => {
    setCollapsed(false);
    setHealthOpen(true);
  };
  // §7.3 auto-collapse: entering an immersive mode stashes the user's state and
  // collapses; leaving restores it. `null` = nothing stashed. The user can still
  // re-expand mid-mode — this fires only on the transition, never per render.
  const stashed = useRef<boolean | null>(null);
  useEffect(() => {
    if (immersive) {
      setCollapsed((prev) => { stashed.current = prev; return true; });
    } else if (stashed.current !== null) {
      const prev = stashed.current;
      stashed.current = null;
      setCollapsed(prev);
    }
  }, [immersive]);

  // ── The one-open accordion (§3.2, EC26): zero or one heading expanded. ──────
  // Default derives from the route; the map re-fires ONLY when the mapped
  // heading changes, so a manual collapse survives moves within one territory.
  // The ambient project (slice S, DES-UX-001 §2.3 rule 1): every "+" verb on
  // this rail derives "which project am I standing in" from the ONE shared
  // helper — inside `/p/:id/*` the new-run / new-chat / register-repo gestures
  // carry the binding instead of resetting to Unfiled (the review's J5 resets).
  const ambient = ambientProjectId(pathname);
  const mapped = headingForPath(pathname);
  const [openHeading, setOpenHeading] = useState<PathKey | null>(mapped);
  const lastMapped = useRef(mapped);
  useEffect(() => {
    if (mapped !== lastMapped.current) {
      lastMapped.current = mapped;
      setOpenHeading(mapped);
    }
  }, [mapped]);
  const toggle = (k: PathKey): void => setOpenHeading((cur) => (cur === k ? null : k));

  const [searchQuery, setSearchQuery] = useState('');
  const [repos, setRepos] = useState<RepoEntry[]>(() => getCachedRepos() ?? []);
  // The board's own model, attention-ordered — the Projects accordion is the
  // board's first column, not a taxonomy of its own (C3: reads, never re-sorts).
  const { items, loading, error } = useBoardModel(runs);

  const isExpanded = !collapsed || hovered;

  // Fetch-on-expand (§3.3): expansion is the gesture; the 5s poll retired.
  // The session cache is shared with the palette — cold: one GET; warm: none.
  useEffect(() => {
    if (openHeading !== 'repos') return;
    let disposed = false;
    fetchReposCached()
      .then((rs) => {
        if (disposed) return;
        setRepos([...rs].sort((a, b) => b.registered_at - a.registered_at));
      })
      .catch(() => { /* rail — fail silently */ });
    return () => { disposed = true; };
  }, [openHeading]);

  const q = searchQuery.trim().toLowerCase();
  const filteredRepos = q ? repos.filter(r => r.name.toLowerCase().includes(q)) : repos;

  // The Make/Chat partition invariant (§3.3): every run under exactly ONE path.
  const chatRuns = orderRuns(runs.filter(isChatRun)).slice(0, CHATS_MAX);
  // Live pool sessions this client knows about (J4 round 2): deposited by
  // GroupChat's open/rejoin and by chat frames on the app's /ws fold — never
  // a fetch (the rail's zero-request budget holds). The Chat accordion must
  // not claim "no chats" while one of these is live.
  const liveChatSessions = useLiveChatsStore((s) => s.sessions);
  const liveChats = Object.values(liveChatSessions)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, CHATS_MAX);
  const madeDocs = items
    .flatMap((item) => item.docs.map((doc) => ({ doc, projectId: item.project.id, projectName: item.project.name })))
    .sort((a, b) => (b.doc.updated_at ?? '').localeCompare(a.doc.updated_at ?? ''))
    .slice(0, MADE_DOCS_MAX);
  const madeRuns = orderRuns(runs.filter((v) => !isChatRun(v))).slice(0, MADE_MAX - madeDocs.length);

  /** Enter a project: its DASHBOARD (DES-FEEDBACK-001 §4.1) — context before actions. */
  const openProject = (projectId: string): void => {
    navigate(projectPath(projectId));
  };

  return (
    <div
      data-testid="left-rail"
      className={`flex flex-col shrink-0 transition-all duration-200 ${isExpanded ? 'w-[280px]' : 'w-14'}`}
      style={{ background: S.bg, borderRight: `1px solid ${S.border}` }}
      onMouseEnter={() => { if (collapsed) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
    >
      {/* The app chrome (DES-VISION-001 §6.3 slice 3): logo slot + product name
          + connection dot — untouched by the round-4 re-architecture (§8.2). */}
      <div className={`flex shrink-0 ${isExpanded ? 'items-center pr-2' : 'flex-col items-center pt-2 gap-1'}`}>
        <AppChrome collapsed={!isExpanded} navigate={navigate} onDotClick={onDotClick} />
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="text-xs font-mono shrink-0 leading-none"
          style={{ color: S.faint }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* Notification bell — stays exactly where it is (§6.1, the operator's word). */}
      <div className={isExpanded ? 'px-4 pb-2' : 'flex justify-center pb-2'}>
        <NotificationBell navigate={navigate} collapsed={!isExpanded} />
      </div>

      {isExpanded ? (
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0 px-2 pt-1" style={{ borderTop: `1px solid ${S.border}` }}>
          {/* ── Projects ─────────────────────────────────────────────────────── */}
          <RailHeading
            path={P_PROJECTS}
            open={openHeading === 'projects'}
            onToggle={() => toggle('projects')}
            onNew={() => setNewProjectOpen(true)}
            navigate={navigate}
          >
            {/* Loading/error render nothing — the board owns those states; the
                rail never narrates absence it cannot yet know. */}
            {!loading && error === null && (
              items.length === 0
                ? <EmptyRow label="No projects yet" href="/projects" navigate={navigate} />
                : items.slice(0, PROJECTS_MAX).map(item => (
                    <ProjectRow key={item.project.id} item={item} onOpen={() => openProject(item.project.id)} />
                  ))
            )}
            <ViewAll href="/projects" navigate={navigate} />
          </RailHeading>

          {/* ── Make — Build ∪ Document ∪ Video (§2.2 Reading 1) ─────────────── */}
          <RailHeading
            path={P_MAKE}
            open={openHeading === 'make'}
            onToggle={() => toggle('make')}
            onNew={() => setMakePickerOpen(v => !v)}
            navigate={navigate}
            extra={makePickerOpen
              ? <MakePicker navigate={navigate} onClose={() => setMakePickerOpen(false)} ambient={ambient} />
              : undefined}
          >
            {madeRuns.length === 0 && madeDocs.length === 0
              ? <EmptyRow label="Nothing made yet" href="/make" navigate={navigate} />
              : (
                <>
                  {madeRuns.map((view) => (
                    <RunRow key={view.session.id} view={view} onOpen={() => navigate(runPath(view.session.id))} />
                  ))}
                  {madeDocs.map(({ doc, projectId, projectName }) => (
                    <DocRow key={`${projectId}:${doc.name}`} doc={doc} projectId={projectId} projectName={projectName} navigate={navigate} />
                  ))}
                </>
              )}
            <ViewAll href="/make" navigate={navigate} />
          </RailHeading>

          {/* ── Chat ─────────────────────────────────────────────────────────── */}
          <RailHeading
            path={P_CHAT}
            open={openHeading === 'chat'}
            onToggle={() => toggle('chat')}
            onNew={() => navigate(launchPath(ambient, 'chat'))}
            navigate={navigate}
          >
            {/* Live pool sessions first (J4 round 2): a warm conversation is
                findable from the rail at its real URL — and the empty label
                below may only render when there is truly NOTHING to show. */}
            {liveChats.map((c) => (
              <button
                key={c.chatId}
                type="button"
                data-testid="rail-live-chat"
                data-chat-id={c.chatId}
                onClick={() => navigate(`/chat/${encodeURIComponent(c.chatId)}`)}
                title={`Open live chat session ${c.chatId}`}
                className="w-full text-left px-3 py-1.5 rounded-md transition-colors flex items-center gap-2"
                style={{ background: 'transparent' }}
                onMouseEnter={e => { e.currentTarget.style.background = S.hover; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span
                  aria-hidden
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: 'var(--status-run)' }}
                />
                <span className="truncate" style={{ fontSize: 'var(--text-xs)', color: S.ink, fontFamily: 'var(--font-mono)' }}>
                  {c.seats.length > 0 ? c.seats.join(' · ') : c.chatId.slice(0, 8)}
                </span>
                <span className="shrink-0" style={{ fontSize: 'var(--text-2xs)', color: S.faint, fontFamily: 'var(--font-sans)' }}>
                  live
                </span>
              </button>
            ))}
            {chatRuns.length === 0 && liveChats.length === 0
              // "Recorded" keeps this row's claim true beside a LIVE session
              // (J4/C6 one-truth) — and with live rows above, the label never
              // renders beside a live conversation at all (round 2, J4/3).
              ? <EmptyRow label="No recorded chats yet" href="/chats" navigate={navigate} />
              : chatRuns.map((view) => (
                  <RunRow key={view.session.id} view={view} onOpen={() => navigate(runPath(view.session.id))} />
                ))}
            <ViewAll href="/chats" navigate={navigate} />
          </RailHeading>

          {/* ── Repositories — rows + search moved inside (§3.3) ─────────────── */}
          <RailHeading
            path={P_REPOS}
            open={openHeading === 'repos'}
            onToggle={() => toggle('repos')}
            onNew={() => navigate(registerRepoPath(ambient))}
            navigate={navigate}
          >
            <div className="px-3 pb-1">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search repositories…"
                className="w-full bg-transparent text-xs font-mono outline-none border-b"
                style={{ color: S.ink, borderColor: S.faint, caretColor: S.accent }}
              />
            </div>
            {filteredRepos.length === 0
              ? <EmptyRow label="No repositories yet" href="/repos" navigate={navigate} />
              : filteredRepos.slice(0, REPOS_MAX).map(repo => (
                  <button
                    key={repo.id}
                    type="button"
                    data-testid="rail-repo"
                    onClick={() => navigate(`/repo-detail/${encodeURIComponent(repo.id)}`)}
                    title={repo.root_path}
                    className="w-full text-left px-3 py-1.5 rounded-md transition-colors"
                    style={{ background: 'transparent' }}
                    onMouseEnter={e => { e.currentTarget.style.background = S.hover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-xs leading-tight font-mono" style={{ color: S.muted }}>
                        {repo.name}
                      </span>
                    </div>
                    <p className="text-[10px] mt-0.5 font-mono truncate" style={{ color: S.faint }}>
                      {repo.root_path}
                    </p>
                  </button>
                ))}
            <ViewAll href="/repos" navigate={navigate} />
          </RailHeading>

          {/* ── Settings — title only, no ▦/＋ (the operator's word, §3.1) ───── */}
          <RailHeading
            path={P_SETTINGS}
            open={openHeading === 'settings'}
            onToggle={() => toggle('settings')}
            navigate={navigate}
          >
            <SettingsShortcutRows navigate={navigate} />
          </RailHeading>
        </div>
      ) : (
        /* Collapsed rail (§3.2): the five path glyphs stacked, each an icon
           LINK to its dashboard route (Settings → /system); accordions don't
           exist at this width. */
        <div className="flex-1 px-2 flex flex-col gap-0.5 mt-1">
          {PATHS.map((path) => (
            <a
              key={path.key}
              href={path.collapsedHref}
              data-testid="rail-collapsed-glyph"
              aria-label={path.title}
              title={path.title}
              onClick={(e) => { e.preventDefault(); navigate(path.collapsedHref); }}
              className="w-9 h-9 mx-auto flex items-center justify-center rounded-md transition-colors"
              style={{ color: S.muted, textDecoration: 'none' }}
              onMouseEnter={e => { e.currentTarget.style.background = S.hover; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span aria-hidden style={{ fontSize: 'var(--text-sm)' }}>{path.glyph}</span>
            </a>
          ))}
        </div>
      )}

      {/* The rail's FOOT — the slot Settings vacated (§8.1): the health
          registry, dressed exactly like the section it replaces (§6.2). */}
      {isExpanded && (
        <HealthRailSection open={healthOpen} onToggle={() => setHealthOpen((v) => !v)} />
      )}

      {/* The new-project flow (§1.3), opened from Projects' ＋ (§3.1). */}
      {newProjectOpen && (
        <NewProjectModal navigate={navigate} onClose={() => setNewProjectOpen(false)} />
      )}
    </div>
  );
}
