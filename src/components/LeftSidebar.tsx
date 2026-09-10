import { useEffect, useRef, useState } from 'react';
import type { RepoEntry, SessionView } from '../api/types.js';
import { UNFILED_MOUNT, type DocSummary } from '../api/interactive.js';
import { ambientProjectId, launchPath, registerRepoPath } from '../hooks/ambientProject.js';
import { useBoardModel, type BoardProject } from '../hooks/useBoardModel.js';
import { modePath, projectPath, versionPath, type Mode } from '../hooks/useRoute.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';
import { useLiveChatsStore } from '../store/liveChats.js';
import { useProjectsStore } from '../store/projects.js';
import { memoriesPath, policiesPath, steeringDashboardPath, STEERING_SECTIONS, STEERING_SECTION_LABELS, type SteeringSection } from '../api/steering.js';
import { skillsPath } from '../api/skills.js';
import { testingLaunchPath, testingPath } from '../api/testing.js';
import { AppChrome } from './AppChrome.js';
import { isChatRun } from './ChatsPage.js';
import { HealthRailSection } from './HealthRailSection.js';
import { MODE_SPECS } from './ModeSwitcher.js';
import { NewProjectModal } from './NewProjectModal.js';
import { NotificationBell } from './NotificationBell.js';
import { humanTitle } from './runIdentity.js';
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
  /** Opens the app-wide ASK dock (the AskDock binding of the assist panel). Threaded
   *  into the chrome (AppChrome), where the Ask entry took the connection word's slot;
   *  it renders only when the app wires this — the chrome never paints a dead door. */
  onOpenAsk?: () => void;
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

export type PathKey = 'projects' | 'execute' | 'test' | 'vibe' | 'demo' | 'chat' | 'repos' | 'testing' | 'skills' | 'steering' | 'settings';

/** Heading word, collapsed-rail glyph (§3.2), ▦ target (§2.1; Settings' glyph
 *  links `/system` in the collapsed column — it has no dashboard). `noun` is
 *  the SINGULAR the ＋ affordance creates (DES-UX-001 §7.10's grammar fix:
 *  "New Project", never "New Projects"). */
interface PathSpec { key: PathKey; title: string; noun: string; glyph: string; dash: string | null; collapsedHref: string }
const P_PROJECTS: PathSpec = { key: 'projects', title: 'Projects',     noun: 'Project',    glyph: '◇', dash: '/projects', collapsedHref: '/projects' };
// The nav-reorg promoted each of Make's three forks (build|document|video) to a top-level path,
// each reusing the Make/Chat rail grammar (▦ dashboard + ＋ create + accordion list + view-all):
// Execute ← build, Vibe ← document, Demo ← video. Execute's ＋ launches a build run directly
// (like Chat's ＋); Vibe/Demo's ＋ open a project-picker popover locked to their mode.
const P_EXECUTE: PathSpec  = { key: 'execute',  title: 'Execute',      noun: 'Run',        glyph: '▸', dash: '/execute',  collapsedHref: '/execute' };
const P_VIBE: PathSpec      = { key: 'vibe',     title: 'Vibe',         noun: 'Document',   glyph: '▤', dash: '/vibe',     collapsedHref: '/vibe' };
const P_DEMO: PathSpec      = { key: 'demo',     title: 'Demo',         noun: 'Demo',       glyph: '▶', dash: '/demo',     collapsedHref: '/demo' };
const P_CHAT: PathSpec     = { key: 'chat',     title: 'Chat',         noun: 'Chat',       glyph: '💬', dash: '/chats',    collapsedHref: '/chats' };
const P_REPOS: PathSpec    = { key: 'repos',    title: 'Repositories', noun: 'Repository', glyph: '⬡', dash: '/repos',    collapsedHref: '/repos' };
// Evals (the nav-reorg): the top-level Testing section became Evals — a NORMAL section (▦
// dashboard + ＋ create-new + list) whose surface is the steering-rule eval runner (the one QE
// capability with no project home). Campaigns moved into the project shell (`/p/:id/campaigns`),
// so they are no longer a top-level nav item; the unscoped cross-project sweep keeps its own
// `/testing/campaigns` route. The key + routes stay `testing`; only the display + list changed.
// Test — the campaign/recon testing capability as a standalone WORK section (usability wave):
// project-optional (recon takes an optional project), placed right below Execute. Routes to the
// existing `/testing/campaigns` page; the rail split (headingForPath) keeps it distinct from Evals.
// The noun is the DISPLAY word (＋ = "New Test", #203) — the route keeps the backend's `campaigns`.
const P_TEST: PathSpec      = { key: 'test',     title: 'Test',         noun: 'Test',       glyph: '✓', dash: testingPath('campaigns'), collapsedHref: testingPath('campaigns') };
// Evals — steering-rule evals, moved beside Steering (a SYSTEM concept, not a work one). Glyph ◈.
const P_TESTING: PathSpec  = { key: 'testing',  title: 'Evals',        noun: 'Eval',       glyph: '◈', dash: testingPath('evals'), collapsedHref: testingPath('evals') };
// Steering (DES-MEM-FACETED-001, unified surface): the governed-knowledge home, a PRIMARY path
// placed immediately BEFORE Settings. The nav-reorg moved its Dashboard from a sub-row to the
// heading's ▦ (dash → the dashboard, same affordance Projects/Execute/Chat/Repos use); it keeps
// NO ＋. Its accordion rows are the TWO management sub-sections (Policies / Memories).
// Skills (the skills keystone): the file manager over the daemon's effective plugin root — the
// skills its workers actually run. A SYSTEM section placed immediately BEFORE Steering, wearing the
// Steering/Evals grammar: ▦ (the catalog) and NO ＋ — a skill is added from the page's own verb,
// with the daemon's guards, never from a bare rail affordance.
const P_SKILLS: PathSpec   = { key: 'skills',   title: 'Skills',       noun: 'Skill',      glyph: '◆', dash: skillsPath(), collapsedHref: skillsPath() };
const P_STEERING: PathSpec = { key: 'steering', title: 'Steering',     noun: 'Rule',       glyph: '☸', dash: steeringDashboardPath(), collapsedHref: steeringDashboardPath() };
const P_SETTINGS: PathSpec = { key: 'settings', title: 'Settings',     noun: 'Setting',    glyph: '⚙', dash: null,        collapsedHref: '/system' };
// Order (nav-reorg): Execute / Vibe / Demo replace Make and sit before Evals; Chat / Repos /
// Skills / Steering / Settings tail.
const PATHS: PathSpec[] = [P_PROJECTS, P_EXECUTE, P_TEST, P_VIBE, P_DEMO, P_CHAT, P_REPOS, P_SKILLS, P_STEERING, P_TESTING, P_SETTINGS];

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
  if (first === 'testing') return second === 'campaigns' ? 'test' : 'testing';
  // `/skills` (+ any sub-address) is the skills file manager — a system section beside Steering.
  if (first === 'skills') return 'skills';
  // The retired `/wiki` + `/rules` + `/policies` panels AND the retired standalone `/proposals`
  // queue redirect into Steering (proposals now live inside its two sub-sections) — map them
  // there too, so the rail never flashes Settings open on the pre-redirect tick.
  if (first === 'steering' || first === 'wiki' || first === 'rules' || first === 'policies' || first === 'proposals') return 'steering';
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
/** Cap for the Execute run list and each of the Vibe / Demo doc lists (per-project
 *  loaded docs only — §4.2.2's scoped rule; the complete census lives on each dashboard). */
const MADE_MAX = 5;
const CHATS_MAX = 5;
const REPOS_MAX = 4;

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
          {humanTitle(view.session.problem)}
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
            // Keep the mousedown out of a picker's outside-close listener (Vibe/Demo),
            // so ＋ is a true toggle (open picker + click ＋ again = closed, not
            // close-then-reopen).
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

// ── The project-mode picker (nav-reorg): Vibe/Demo's ＋ opens straight to the ──
//    project stage, locked to one mode. A doc (Document) / demo (Video) lives in
//    a project, so the ＋ picks the project first, then opens the mode surface
//    there. (Execute's ＋ needs no picker — it launches a build run directly.)

export function ProjectModePicker({ mode, navigate, onClose }: {
  /** The mode this picker is locked to — 'document' (Vibe) or 'video' (Demo). */
  mode: 'document' | 'video';
  navigate: (p: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const projects = useProjectsStore((s) => s.projects);

  // Entering the picker is the gesture that loads the project list if cold.
  useEffect(() => {
    if (projects.length === 0) void useProjectsStore.getState().load();
  }, [projects.length]);

  useEffect(() => {
    function onOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [onClose]);

  const real = projects.filter((p) => p.id !== 'default');

  return (
    <div
      ref={ref}
      data-testid="project-mode-picker"
      data-mode={mode}
      role="menu"
      className="absolute right-0 top-8 z-30 w-60 py-1"
      style={{
        background: 'var(--surface-raised)',
        boxShadow: 'var(--shadow-raised)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div className="px-3 py-1.5 flex flex-col gap-1.5" data-testid="project-mode-picker-stage">
        <p style={{ fontSize: 'var(--text-2xs)', color: S.faint, fontFamily: 'var(--font-sans)', margin: 0 }}>
          {real.length === 0
            ? `No projects yet — a ${MODE_SPECS[mode].label.toLowerCase()} can start Unfiled, or create one:`
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
            navigate(modePath(pid ?? UNFILED_MOUNT, mode));
          }}
        />
      </div>
    </div>
  );
}

/** The Evals accordion's single shortcut row (nav-reorg): Evals has no persistent list entity —
 *  the eval runner produces a report, not a stored corpus of "evals" — so the accordion is one
 *  "Run evals" shortcut into the runner (the ▦ links the same page; the ＋ launches a new run).
 *  The row grammar is SettingsShortcutRows'. (A future eval-run store is the natural list
 *  source; until then this is the honest surface — see the nav-reorg risk note.) */
function EvalsRailRows({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  return (
    <div role="menu" className="flex flex-col pt-0.5">
      <button
        type="button"
        role="menuitem"
        data-testid="rail-evals-run"
        onClick={() => navigate(testingPath('evals'))}
        className="w-full text-left px-6 py-1.5 rounded text-xs font-mono transition-colors hover:bg-surface-raised hover:text-ink-body focus-visible:outline-none focus-visible:bg-surface-raised focus-visible:text-ink-body"
        style={{ color: 'var(--ink-muted)' }}
      >
        Run evals
      </button>
    </div>
  );
}

/** The Test accordion's shortcut row (usability wave): a "Run recon" launcher into the test
 *  landing WITH the recon panel open (`?new=recon` — a launcher launches, #203) — Test works
 *  WITHOUT a project (recon takes an optional one), so it lives here as a standalone work
 *  section. The ▦ links the test dashboard; this row is the create verb's sibling. Same grammar
 *  as {@link EvalsRailRows}. */
function TestRailRows({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  return (
    <div role="menu" className="flex flex-col pt-0.5">
      <button
        type="button"
        role="menuitem"
        data-testid="rail-test-recon"
        onClick={() => navigate(testingLaunchPath('recon'))}
        className="w-full text-left px-6 py-1.5 rounded text-xs font-mono transition-colors hover:bg-surface-raised hover:text-ink-body focus-visible:outline-none focus-visible:bg-surface-raised focus-visible:text-ink-body"
        style={{ color: 'var(--ink-muted)' }}
      >
        Run recon
      </button>
    </div>
  );
}

/** The Skills accordion's single shortcut row: Skills has no persistent per-item list worth
 *  mirroring on the rail (the catalog is ~140 skills — a dashboard, not a shortcut list), so the
 *  accordion is one "Browse skills" shortcut into the file manager (the ▦ links the same page).
 *  Same grammar as {@link EvalsRailRows}. */
function SkillsRailRows({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  return (
    <div role="menu" className="flex flex-col pt-0.5">
      <button
        type="button"
        role="menuitem"
        data-testid="rail-skills-browse"
        onClick={() => navigate(skillsPath())}
        className="w-full text-left px-6 py-1.5 rounded text-xs font-mono transition-colors hover:bg-surface-raised hover:text-ink-body focus-visible:outline-none focus-visible:bg-surface-raised focus-visible:text-ink-body"
        style={{ color: 'var(--ink-muted)' }}
      >
        Browse skills
      </button>
    </div>
  );
}

/** The Steering accordion's rows: one per MANAGEMENT sub-section (Policies / Memories), each a
 *  navigate() shortcut to its page — the SettingsShortcutRows grammar. The nav-reorg moved the
 *  Dashboard from a sub-row to the heading's ▦ (same affordance Projects/Execute/Chat/Repos use),
 *  so it is FILTERED out here — leaving the two "manage existing" deep-dives (the seven types are
 *  a `?type=` filter inside Policies). `STEERING_SECTIONS` itself is unchanged (the route
 *  vocabulary + test-pinned); the filter is at the render site only. */
function SteeringSectionRows({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  const href = (s: SteeringSection): string =>
    s === 'memories' ? memoriesPath() : s === 'policies' ? policiesPath() : steeringDashboardPath();
  return (
    <div role="menu" className="flex flex-col pt-0.5">
      {STEERING_SECTIONS.filter((s) => s !== 'dashboard').map((s) => (
        <button
          key={s}
          type="button"
          role="menuitem"
          data-testid="rail-steering-section"
          data-section={s}
          onClick={() => navigate(href(s))}
          className="w-full text-left px-6 py-1.5 rounded text-xs font-mono transition-colors hover:bg-surface-raised hover:text-ink-body focus-visible:outline-none focus-visible:bg-surface-raised focus-visible:text-ink-body"
          style={{ color: 'var(--ink-muted)' }}
        >
          {STEERING_SECTION_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const flatRunPath = (id: string): string => `/runs/${encodeURIComponent(id)}`;

export function LeftSidebar({ runs, navigate, pathname, runPath = flatRunPath, immersive = false, onOpenAsk }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // Vibe / Demo each fork their ＋ into a project-picker popover locked to their mode.
  // Vibe's and Demo's ＋ pickers are ONE mutually-exclusive popover (not two independent booleans):
  // each ＋ stops its mousedown from reaching the OTHER picker's outside-close listener (so ＋ stays a
  // clean toggle), which means opening one could otherwise leave the other open (Copilot #197). A
  // single `openPicker` closes the sibling by construction — only one is ever mounted.
  const [openPicker, setOpenPicker] = useState<'vibe' | 'demo' | null>(null);
  // The rail-foot health section (§6.2, slice O) — controlled here; it toggles
  // from its own header (the chrome connection dot that used to expand it was
  // removed in nav-ui-tweaks).
  const [healthOpen, setHealthOpen] = useState(false);
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

  // The Execute/Chat partition invariant (§3.3): every run under exactly ONE path.
  const chatRuns = orderRuns(runs.filter(isChatRun)).slice(0, CHATS_MAX);
  // Live pool sessions this client knows about (J4 round 2): deposited by
  // GroupChat's open/rejoin and by chat frames on the app's /ws fold — never
  // a fetch (the rail's zero-request budget holds). The Chat accordion must
  // not claim "no chats" while one of these is live.
  const liveChatSessions = useLiveChatsStore((s) => s.sessions);
  const liveChats = Object.values(liveChatSessions)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, CHATS_MAX);
  // Execute ← the non-chat (build) runs, needs-you-first (orderRuns = active before terminal).
  const executeRuns = orderRuns(runs.filter((v) => !isChatRun(v))).slice(0, MADE_MAX);
  // Vibe ← documents, Demo ← demos — the board model's per-project docs, split by kind, newest
  // first. Each list is capped independently (they are peer sections now, not one Make list).
  const allDocs = items
    .flatMap((item) => item.docs.map((doc) => ({ doc, projectId: item.project.id, projectName: item.project.name })))
    .sort((a, b) => (b.doc.updated_at ?? '').localeCompare(a.doc.updated_at ?? ''));
  const vibeDocs = allDocs.filter(({ doc }) => doc.kind !== 'demo').slice(0, MADE_MAX);
  const demoDocs = allDocs.filter(({ doc }) => doc.kind === 'demo').slice(0, MADE_MAX);

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
      {/* The app chrome (DES-VISION-001 §6.3 slice 3): logo slot + product name,
          and — in the connection word's old slot — the Ask entry (a compact
          `?` circle, rail-header restyle; the connection dot was removed in
          nav-ui-tweaks). `gap-2` gives the chrome cluster (Ask) and the
          collapse/expand "menu" control clear separation — distinct actions,
          not one cluster (item 1). */}
      <div className={`flex shrink-0 ${isExpanded ? 'items-center gap-2 pr-2' : 'flex-col items-center pt-2 gap-2'}`}>
        <AppChrome collapsed={!isExpanded} navigate={navigate} {...(onOpenAsk !== undefined ? { onOpenAsk } : {})} />
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

      {/* Notification bell — stays in its slot below the chrome (§6.1). The top
          spacing (pt-3 expanded / pt-2 collapsed) separates it from the chrome
          cluster above: Notifications reads as its own distinct action, not part
          of the header cluster (item 1). */}
      <div className={isExpanded ? 'px-4 pt-3 pb-3' : 'flex justify-center pt-2 pb-2'}>
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

          {/* ── Execute ← build runs (nav-reorg): ＋ launches a build run directly ── */}
          <RailHeading
            path={P_EXECUTE}
            open={openHeading === 'execute'}
            onToggle={() => toggle('execute')}
            onNew={() => navigate(launchPath(ambient, 'build'))}
            navigate={navigate}
          >
            {executeRuns.length === 0
              ? <EmptyRow label="Nothing run yet" href="/execute" navigate={navigate} />
              : executeRuns.map((view) => (
                  <RunRow key={view.session.id} view={view} onOpen={() => navigate(runPath(view.session.id))} />
                ))}
            <ViewAll href="/execute" navigate={navigate} />
          </RailHeading>

          {/* ── Test — tests/recon as a standalone work section (usability wave): below Execute,
                 works with or without a project. ＋ ("New Test") lands on the test landing with the
                 New-test panel OPEN (`?new=test`, #203) — a create affordance creates. ── */}
          <RailHeading
            path={P_TEST}
            open={openHeading === 'test'}
            onToggle={() => toggle('test')}
            onNew={() => navigate(testingLaunchPath('campaign'))}
            navigate={navigate}
          >
            <TestRailRows navigate={navigate} />
          </RailHeading>

          {/* ── Vibe ← documents (nav-reorg): ＋ opens a project-picker locked to Document ── */}
          <RailHeading
            path={P_VIBE}
            open={openHeading === 'vibe'}
            onToggle={() => toggle('vibe')}
            onNew={() => setOpenPicker(p => (p === 'vibe' ? null : 'vibe'))}
            navigate={navigate}
            extra={openPicker === 'vibe'
              ? <ProjectModePicker mode="document" navigate={navigate} onClose={() => setOpenPicker(null)} />
              : undefined}
          >
            {vibeDocs.length === 0
              ? <EmptyRow label="No documents yet" href="/vibe" navigate={navigate} />
              : vibeDocs.map(({ doc, projectId, projectName }) => (
                  <DocRow key={`${projectId}:${doc.name}`} doc={doc} projectId={projectId} projectName={projectName} navigate={navigate} />
                ))}
            <ViewAll href="/vibe" navigate={navigate} />
          </RailHeading>

          {/* ── Demo ← demos (nav-reorg): ＋ opens a project-picker locked to Video ── */}
          <RailHeading
            path={P_DEMO}
            open={openHeading === 'demo'}
            onToggle={() => toggle('demo')}
            onNew={() => setOpenPicker(p => (p === 'demo' ? null : 'demo'))}
            navigate={navigate}
            extra={openPicker === 'demo'
              ? <ProjectModePicker mode="video" navigate={navigate} onClose={() => setOpenPicker(null)} />
              : undefined}
          >
            {demoDocs.length === 0
              ? <EmptyRow label="No demos yet" href="/demo" navigate={navigate} />
              : demoDocs.map(({ doc, projectId, projectName }) => (
                  <DocRow key={`${projectId}:${doc.name}`} doc={doc} projectId={projectId} projectName={projectName} navigate={navigate} />
                ))}
            <ViewAll href="/demo" navigate={navigate} />
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

          {/* ── The work/system boundary (usability wave): a bar separating the work sections above
                 from the governance/system sections (Steering, Evals) below. ── */}
          <div aria-hidden data-testid="rail-divider" style={{ borderTop: '1px solid var(--surface-raised)', margin: '8px 12px' }} />

          {/* ── Skills — the file manager over the daemon's effective plugin root (the skills its
                workers run): browse, edit, enable/disable, reset. Sits before Steering. ── */}
          <RailHeading
            path={P_SKILLS}
            open={openHeading === 'skills'}
            onToggle={() => toggle('skills')}
            navigate={navigate}
          >
            <SkillsRailRows navigate={navigate} />
          </RailHeading>

          {/* ── Steering — the governed-knowledge home. Its three rows: Dashboard (the review-forward
                home, on the ▦) + the Policies / Memories deep-dives. ─ */}
          <RailHeading
            path={P_STEERING}
            open={openHeading === 'steering'}
            onToggle={() => toggle('steering')}
            navigate={navigate}
          >
            <SteeringSectionRows navigate={navigate} />
          </RailHeading>

          {/* ── Evals — steering-rule evals, moved beside Steering (similar system concepts): the
                eval runner + its run history. ── */}
          <RailHeading
            path={P_TESTING}
            open={openHeading === 'testing'}
            onToggle={() => toggle('testing')}
            navigate={navigate}
          >
            <EvalsRailRows navigate={navigate} />
          </RailHeading>

          {/* ── The bar below Steering/Evals, with Settings under it (usability wave). ── */}
          <div aria-hidden data-testid="rail-divider" style={{ borderTop: '1px solid var(--surface-raised)', margin: '8px 12px' }} />

          {/* ── Settings — title only, no ＋ (the operator's word, §3.1) ───── */}
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
