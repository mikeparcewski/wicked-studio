import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry, SessionView } from '../api/types.js';
import { useBoardModel, type BoardProject } from '../hooks/useBoardModel.js';
import { projectPath } from '../hooks/useRoute.js';
import { AppChrome } from './AppChrome.js';
import { MODE_SPECS } from './ModeSwitcher.js';
import { NewProjectModal } from './NewProjectModal.js';
import { NotificationBell } from './NotificationBell.js';
import { ATTENTION_DOT } from './ProjectCard.js';
import { RunsSection } from './RunsSection.js';
import { SettingsRailSection } from './SettingsRailSection.js';

/**
 * The rail, consolidated to TWO taxonomies (DES-UXFIX-001 §2.3, slice 3 — F4):
 *
 *   1. PROJECTS — the same axis as the board, attention-ordered (§2.1.3) off the
 *      SAME model the board reads (`useBoardModel`), so the rail and the board
 *      agree on which project needs you first. Clicking one enters its shell
 *      (last-used mode, Chat default — §1.5).
 *   2. REPOSITORIES — the one cross-project axis a coder genuinely browses by.
 *      Unchanged in behaviour; keeps its search.
 *
 * Chats and Work are GONE as rail sections: they were one object (a run) sliced
 * by an internal field (`workflow_id`, V5) into two visually identical truncated
 * lists. A run lives under its project now; the flat cross-project lists survive
 * only behind the single "All runs ›" escape hatch (§1.5).
 *
 * The creation verbs compress to one compact row in the mode spine's own words
 * (V9/V10: Build / Chat — the switcher's glyphs, not "Do Work" vs "New Chat")
 * plus Repository.
 */

interface Props {
  runs: SessionView[];
  navigate: (path: string) => void;
  /** DES-FEEDBACK-001 §1.4: where a runs-section row navigates — the caller's
   *  same routing as `selectRun`. Defaults to the flat `/runs/:id` route. */
  runPath?: (id: string) => string;
  /** DES-FEEDBACK-001 §7.3: Document/Video are canvas-first, so entering them
   *  auto-collapses the rail to its icon state; leaving restores what the user had.
   *  Hover-peek still works, and the expand control stays live — auto, not locked. */
  immersive?: boolean;
}

// The rail is chrome (§5.1's token table: `--surface-rail → rail, chrome`), so
// slice 3's chrome conversion moves the whole palette onto the semantic tokens
// (§2.11) — the legacy teal shell retires with it. Links and the creation verbs
// are the rail's interactive affordances: on-accent, the §5.3 "Add agents"
// precedent (low-key but on-accent to signal interactivity).
const S = {
  bg:        'var(--surface-rail)',
  border:    'var(--surface-raised)',
  ink:       'var(--ink-body)',
  muted:     'var(--ink-muted)',
  faint:     'var(--ink-dim)',
  hover:     'var(--surface-card)',
  active:    'var(--surface-raised)',
  accent:    'var(--accent)',
  accentInk: 'var(--accent-fg)',
  link:      'var(--accent)',
};

const SECTION_MAX = 4;
/** Collapsed rail: at most this many project dots — a glance strip, not a list. */
const COLLAPSED_MAX = 12;

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function IconSearch(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <circle cx="10" cy="10" r="7" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </svg>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** One QUICK action: the spine glyph and the mode's own word, each on its own
 *  line (DES-FEEDBACK-001 §1.2 — the `+` glyphs are GONE, EC20). `hint` (the
 *  MODE_SPECS sublabel) teaches what the verb produces, on hover. */
function ActionLink({
  glyph,
  label,
  hint,
  testId,
  onClick,
  collapsed,
}: {
  glyph: React.ReactNode;
  label: string;
  hint?: string;
  testId?: string;
  onClick: () => void;
  collapsed: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-label={label}
      title={hint !== undefined ? `${label} — ${hint}` : label}
      className={`flex items-center gap-1.5 rounded text-sm font-semibold transition-opacity hover:opacity-70 ${
        collapsed ? 'w-9 h-9 justify-center mx-auto' : 'px-1 py-1'
      }`}
      style={{ color: S.accent, background: 'transparent' }}
    >
      <span aria-hidden>{glyph}</span>
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

function SectionLabel({
  label,
  asLink,
  onClick,
  withSearch,
  searchActive,
  onToggleSearch,
}: {
  label: string;
  asLink?: boolean;
  onClick?: () => void;
  withSearch?: boolean;
  searchActive?: boolean;
  onToggleSearch?: () => void;
}): React.ReactElement {
  const textEl = (
    <span
      className="text-[10px] font-semibold uppercase tracking-widest font-mono select-none"
      style={{ color: asLink ? S.link : S.muted }}
    >
      {label}
      {asLink && <span className="ml-1 opacity-70">›</span>}
    </span>
  );

  return (
    <div className="flex items-center px-3 pt-3 pb-1">
      {asLink && onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="transition-opacity hover:opacity-80"
          style={{ background: 'transparent' }}
        >
          {textEl}
        </button>
      ) : (
        textEl
      )}
      {withSearch && (
        <button
          type="button"
          onClick={onToggleSearch}
          aria-label="Search"
          className="ml-auto transition-opacity hover:opacity-100"
          style={{ color: searchActive ? S.accent : S.faint }}
        >
          <IconSearch />
        </button>
      )}
    </div>
  );
}

/** One rail project row: the board's attention dot + the name. The row is the
 *  board card's one-glance summary, never a second place that explains it. */
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

// ── Main component ────────────────────────────────────────────────────────────

const flatRunPath = (id: string): string => `/runs/${encodeURIComponent(id)}`;

export function LeftSidebar({ runs, navigate, runPath = flatRunPath, immersive = false }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  // DES-FEEDBACK-001 §1.3: the QUICK section's Project action opens the
  // new-project modal — an overlay, not a route.
  const [newProjectOpen, setNewProjectOpen] = useState(false);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  // The board's own model, attention-ordered (§2.1.3) — the rail's Projects list
  // is the board's first column, not a fourth taxonomy of its own.
  const { items, loading, error } = useBoardModel(runs);

  const isExpanded = !collapsed || hovered;

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    function load(): void {
      if (inFlight) return;
      inFlight = true;
      api.listRepos().then(({ repos: rs }) => {
        if (disposed) return;
        const sorted = [...rs].sort((a, b) => b.registered_at - a.registered_at);
        setRepos(sorted);
      }).catch(() => { /* sidebar — fail silently */ }).finally(() => { inFlight = false; });
    }
    load();
    const id = setInterval(load, 5_000);
    return () => { disposed = true; clearInterval(id); };
  }, []);

  const q = searchQuery.trim().toLowerCase();
  const filteredRepos = q ? repos.filter(r => r.name.toLowerCase().includes(q)) : repos;

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
          + connection dot + settings — the rail's header region, token-built. */}
      <div className={`flex shrink-0 ${isExpanded ? 'items-center pr-2' : 'flex-col items-center pt-2 gap-1'}`}>
        <AppChrome collapsed={!isExpanded} navigate={navigate} />
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

      {/* Notification bell — always visible (collapsed: icon-only with badge; expanded: label too) */}
      <div className={isExpanded ? 'px-4 pb-2' : 'flex justify-center pb-2'}>
        <NotificationBell navigate={navigate} collapsed={!isExpanded} />
      </div>

      {/* QUICK — the creation verbs, VERTICAL under one section header
          (DES-FEEDBACK-001 §1.2): Project first (opens the new-project flow),
          then the mode spine's own words. No `+` glyphs anywhere (EC20). */}
      {isExpanded && (
        <div
          data-testid="rail-quick"
          className="px-4 pt-2 select-none"
          style={{
            fontSize: 'var(--text-2xs)',
            fontWeight: 'var(--weight-medium)',
            fontFamily: 'var(--font-sans)',
            color: S.faint,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          QUICK
        </div>
      )}
      <div
        data-testid="rail-actions"
        className={`flex ${!isExpanded ? 'flex-col px-2 items-center gap-2 mt-1' : 'flex-col items-start px-4 pt-0.5 pb-1 gap-0.5'}`}
      >
        <ActionLink glyph="◻" label="Project" hint="start a new project" testId="new-project" onClick={() => setNewProjectOpen(true)} collapsed={!isExpanded} />
        <ActionLink glyph={MODE_SPECS.build.glyph} label="Build" hint={MODE_SPECS.build.sublabel} testId="new-run" onClick={() => navigate('/runs/new')} collapsed={!isExpanded} />
        <ActionLink glyph={MODE_SPECS.chat.glyph} label="Chat" hint={MODE_SPECS.chat.sublabel} onClick={() => navigate('/chat/new')} collapsed={!isExpanded} />
        <ActionLink glyph="⬡" label="Repository" onClick={() => navigate('/repos/new')} collapsed={!isExpanded} />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0 mt-2">
        {isExpanded ? (
          <>
            {/* Search input (repositories) */}
            {searchOpen && (
              <div className="px-4 pb-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search repositories…"
                  autoFocus
                  className="w-full bg-transparent text-xs font-mono outline-none border-b"
                  style={{ color: S.ink, borderColor: S.faint, caretColor: S.accent }}
                />
              </div>
            )}

            {/* ── Runs — the recent 5 inline, below QUICK (DES-FEEDBACK-001 §1.4),
                   active before terminal, with the ONE "All runs ›" escape hatch
                   riding at the section's bottom. Same `runs` prop — no new fetch. ── */}
            <SectionLabel label="Runs" />
            <RunsSection runs={runs} runPath={runPath} navigate={navigate} />

            {/* ── Taxonomy 1: Projects — the board's axis, attention-ordered ── */}
            <div data-testid="rail-section-projects">
              <SectionLabel
                label="Projects"
                asLink
                onClick={() => navigate('/projects')}
              />
              {/* Loading/error render nothing here — the board owns those states
                  (§3.1); the rail never narrates absence it cannot yet know. */}
              {!loading && error === null && (
                <SectionList empty="No projects yet" viewAllPath="/projects" navigate={navigate}>
                  {items.slice(0, SECTION_MAX).map(item => (
                    <ProjectRow key={item.project.id} item={item} onOpen={() => openProject(item.project.id)} />
                  ))}
                </SectionList>
              )}
              {items.length > SECTION_MAX && (
                <ViewAll onClick={() => navigate('/projects')} />
              )}
            </div>

            {/* ── Taxonomy 2: Repositories — the cross-project axis, with search ── */}
            <div data-testid="rail-section-repos">
              <SectionLabel
                label="Repositories"
                withSearch
                searchActive={searchOpen}
                onToggleSearch={() => { setSearchOpen(v => !v); if (searchOpen) setSearchQuery(''); }}
              />
              <SectionList
                empty="No repositories yet"
                viewAllPath="/repos"
                navigate={navigate}
              >
                {filteredRepos.slice(0, SECTION_MAX).map(repo => (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => navigate(`/repo-detail/${encodeURIComponent(repo.id)}`)}
                    title={repo.root_path}
                    className="w-full text-left px-3 py-2 rounded-md transition-colors"
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
              </SectionList>
              {filteredRepos.length > SECTION_MAX && (
                <ViewAll onClick={() => navigate('/repos')} />
              )}
            </div>

          </>
        ) : (
          /* Not expanded: attention dots for the top projects — same axis, same
             order, same colours as the expanded list and the board. */
          <div className="px-2 flex flex-col gap-0.5 mt-1">
            {items.slice(0, COLLAPSED_MAX).map(item => (
              <button
                key={item.project.id}
                type="button"
                onClick={() => openProject(item.project.id)}
                aria-label={item.project.name}
                title={item.project.name}
                className="w-9 h-9 mx-auto flex items-center justify-center rounded-md transition-colors"
                style={{ background: 'transparent' }}
                onMouseEnter={e => { e.currentTarget.style.background = S.hover; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${item.attention === 'gate' || item.attention === 'running' ? 'animate-pulse' : ''}`}
                  style={{ background: ATTENTION_DOT[item.attention] }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Settings — the expand/collapse section at the rail's bottom
             (DES-FEEDBACK-001 §1.2, §4.4): the retired AppChrome dropdown's
             entries as an in-rail shortcut list, collapsed by default. ── */}
      {isExpanded && <SettingsRailSection navigate={navigate} />}

      {/* The new-project flow (§1.3), opened from QUICK's Project action. */}
      {newProjectOpen && (
        <NewProjectModal navigate={navigate} onClose={() => setNewProjectOpen(false)} />
      )}
    </div>
  );
}

function SectionList({
  children,
  empty,
  viewAllPath,
  navigate,
}: {
  children: React.ReactNode;
  empty: string;
  viewAllPath: string;
  navigate: (p: string) => void;
}): React.ReactElement {
  const kids = Array.isArray(children) ? children.filter(Boolean) : (children ? [children] : []);
  return (
    <div className="px-2 flex flex-col gap-0.5">
      {kids.length === 0 ? (
        <button
          type="button"
          onClick={() => navigate(viewAllPath)}
          className="px-2 py-1 text-left text-[11px] italic font-mono transition-opacity hover:opacity-70"
          style={{ color: S.faint }}
        >
          {empty}
        </button>
      ) : kids}
    </div>
  );
}

function ViewAll({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-4 mb-1 text-left text-[11px] font-mono transition-opacity hover:opacity-80"
      style={{ color: S.link }}
    >
      view all
    </button>
  );
}
