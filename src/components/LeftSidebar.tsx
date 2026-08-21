import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry, SessionView } from '../api/types.js';
import { useBoardModel, type BoardProject } from '../hooks/useBoardModel.js';
import { lastMode, modePath } from '../hooks/useRoute.js';
import { useConnectionStore } from '../store/connection.js';
import { MODE_SPECS } from './ModeSwitcher.js';
import { NotificationBell } from './NotificationBell.js';
import { ATTENTION_DOT } from './ProjectCard.js';
import { SettingsMenu } from './SettingsMenu.js';
import { WickedLogo } from './WickedLogo.js';

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
}

const S = {
  bg:        '#1c4053',
  border:    'rgba(0,0,0,0.25)',
  ink:       '#e6edf3',
  muted:     'rgba(230,237,243,0.55)',
  faint:     'rgba(230,237,243,0.3)',
  hover:     'rgba(0,0,0,0.2)',
  active:    'rgba(0,0,0,0.35)',
  accent:    '#ffda19',
  accentInk: '#0d1117',
  link:      '#79c0ff',
};

const SECTION_MAX = 4;
/** Collapsed rail: at most this many project dots — a glance strip, not a list. */
const COLLAPSED_MAX = 12;

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function IconPlus(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 11h-6V5a1 1 0 0 0-2 0v6H5a1 1 0 0 0 0 2h6v6a1 1 0 0 0 2 0v-6h6a1 1 0 0 0 0-2z" />
    </svg>
  );
}

function IconSearch(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <circle cx="10" cy="10" r="7" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </svg>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** One creation verb: a faint "+" (create), the spine glyph, the mode's own word.
 *  `hint` (the MODE_SPECS sublabel) teaches what the verb produces, on hover. */
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
      {!collapsed && <span aria-hidden style={{ color: S.faint, fontWeight: 400 }}>+</span>}
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

// ── Connection status pill + health popover ───────────────────────────────────

interface HealthInfo {
  status: string;
  version: string;
  ping: string;
}

function ConnectionPill(): React.ReactElement {
  const wsStatus = useConnectionStore((s) => s.status);
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setHealth(null);
    setHealthError(false);
    api.getHealth()
      .then((h) => setHealth(h))
      .catch(() => setHealthError(true));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [open]);

  const dotColor =
    wsStatus === 'connected' ? '#3fb950' :
    wsStatus === 'connecting' ? '#ffda19' : '#f85149';

  const pillLabel =
    wsStatus === 'connected' ? 'Connected' :
    wsStatus === 'connecting' ? 'Connecting' : 'Disconnected';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Connection status"
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(230,237,243,0.1)',
          borderRadius: '20px', padding: '2px 8px 2px 6px', cursor: 'pointer',
        }}
      >
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: dotColor, flexShrink: 0,
          boxShadow: wsStatus === 'connected' ? `0 0 5px ${dotColor}` : 'none',
        }} />
        <span style={{ fontSize: '10px', fontFamily: 'monospace', color: dotColor, whiteSpace: 'nowrap' }}>
          {pillLabel}
        </span>
        <span style={{ fontSize: '9px', color: 'rgba(230,237,243,0.35)', marginLeft: '1px' }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
          background: '#1b222e', border: '1px solid rgba(230,237,243,0.12)',
          borderRadius: '10px', padding: '12px 14px', minWidth: '220px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <p style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(230,237,243,0.4)', marginBottom: '8px', fontFamily: 'monospace' }}>
            Health checks
          </p>
          <CheckRow label="WebSocket" ok={wsStatus === 'connected'} detail={pillLabel} />
          {healthError ? (
            <CheckRow label="API server" ok={false} detail="unreachable" />
          ) : health ? (
            <>
              <CheckRow label="API server" ok={health.status === 'ok'} detail={health.status} />
              <CheckRow label="wicked-core" ok detail={health.version} />
            </>
          ) : (
            <CheckRow label="API server" ok={null} detail="checking…" />
          )}
        </div>
      )}
    </div>
  );
}

function CheckRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }): React.ReactElement {
  const icon = ok === null ? '·' : ok ? '✓' : '✗';
  const color = ok === null ? 'rgba(230,237,243,0.3)' : ok ? '#3fb950' : '#f85149';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
      <span style={{ width: '12px', fontSize: '11px', color, fontFamily: 'monospace', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: '11px', color: '#e6edf3', fontFamily: 'monospace', flex: 1 }}>{label}</span>
      <span style={{ fontSize: '10px', color: 'rgba(230,237,243,0.45)', fontFamily: 'monospace' }}>{detail}</span>
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
        <span className="flex-1 truncate text-xs leading-tight font-mono" style={{ color: 'rgba(230,237,243,0.7)' }}>
          {project.name}
        </span>
      </div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LeftSidebar({ runs, navigate }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  /** Enter a project's shell: last-used mode, Chat default (§1.5, §2.3). */
  const openProject = (projectId: string): void => {
    navigate(modePath(projectId, lastMode(projectId)));
  };

  return (
    <div
      className={`flex flex-col shrink-0 transition-all duration-200 ${isExpanded ? 'w-[280px]' : 'w-14'}`}
      style={{ background: S.bg, borderRight: `1px solid ${S.border}` }}
      onMouseEnter={() => { if (collapsed) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-5 pb-3 shrink-0">
        <button type="button" onClick={() => navigate('/')} className="shrink-0" aria-label="Home">
          <WickedLogo size={26} />
        </button>
        {isExpanded && (
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex-1 text-left text-sm font-semibold font-mono truncate transition-opacity hover:opacity-70"
            style={{ color: S.ink, background: 'transparent' }}
          >
            wicked-studio
          </button>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`text-xs font-mono shrink-0 leading-none ${isExpanded ? 'ml-auto' : ''}`}
          style={{ color: S.faint }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* Connection pill — below logo, matching the gap between action links and section headers */}
      {isExpanded && (
        <div className="px-4 pt-1 pb-3">
          <ConnectionPill />
        </div>
      )}

      {/* Notification bell — always visible (collapsed: icon-only with badge; expanded: label too) */}
      <div className={isExpanded ? 'px-4 pb-2' : 'flex justify-center pb-2'}>
        <NotificationBell navigate={navigate} collapsed={!isExpanded} />
      </div>

      {/* Creation verbs — ONE compact row in the mode spine's words (§2.3, V9/V10):
          Build and Chat are the switcher's verbs with the switcher's glyphs, so
          they are differentiable (F2); Repository keeps its plus. */}
      <div
        data-testid="rail-actions"
        className={`flex ${!isExpanded ? 'flex-col px-2 items-center gap-2 mt-1' : 'flex-wrap items-center px-4 pt-1 pb-1 gap-x-3 gap-y-0.5'}`}
      >
        <ActionLink glyph={MODE_SPECS.build.glyph} label="Build" hint={MODE_SPECS.build.sublabel} testId="new-run" onClick={() => navigate('/runs/new')} collapsed={!isExpanded} />
        <ActionLink glyph={MODE_SPECS.chat.glyph} label="Chat" hint={MODE_SPECS.chat.sublabel} onClick={() => navigate('/chat/new')} collapsed={!isExpanded} />
        <ActionLink glyph={<IconPlus />} label="Repository" onClick={() => navigate('/repos/new')} collapsed={!isExpanded} />
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
                      <span className="flex-1 truncate text-xs leading-tight font-mono" style={{ color: 'rgba(230,237,243,0.7)' }}>
                        {repo.name}
                      </span>
                    </div>
                    <p className="text-[10px] mt-0.5 font-mono truncate" style={{ color: 'rgba(230,237,243,0.3)' }}>
                      {repo.root_path}
                    </p>
                  </button>
                ))}
              </SectionList>
              {filteredRepos.length > SECTION_MAX && (
                <ViewAll onClick={() => navigate('/repos')} />
              )}
            </div>

            {/* ── The ONE escape hatch to the flat cross-project run lists (§2.3):
                   Chats and Work are not rail taxonomies any more — a run lives
                   under its project, and the power-user lists live behind this. ── */}
            <div className="px-3 pt-3 pb-1">
              <a
                href="/runs"
                data-testid="rail-all-runs"
                onClick={(e) => { e.preventDefault(); navigate('/runs'); }}
                className="text-[11px] font-mono transition-opacity hover:opacity-80"
                style={{ color: S.link, textDecoration: 'none' }}
              >
                All runs ›
              </a>
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

      {/* Footer */}
      <div className={`px-2 pb-3 shrink-0 ${!isExpanded ? 'flex flex-col items-center gap-1' : ''}`}>
        <div className="relative">
          <button
            type="button"
            onClick={() => setSettingsOpen(v => !v)}
            onMouseDown={e => e.stopPropagation()}
            aria-label="Settings"
            className={`rounded transition-colors ${
              !isExpanded
                ? 'w-9 h-9 flex items-center justify-center text-base'
                : 'w-full flex items-center gap-2 px-2 py-1.5 text-xs'
            }`}
            style={{ color: S.faint }}
            onMouseEnter={e => { e.currentTarget.style.background = S.hover; e.currentTarget.style.color = S.ink; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = S.faint; }}
          >
            <span>⚙</span>
            {isExpanded && (
              <>
                <span>Settings</span>
                <span className="ml-auto text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.25)' }}>v0.3.2</span>
              </>
            )}
          </button>
          {settingsOpen && (
            <SettingsMenu onNavigate={navigate} onClose={() => setSettingsOpen(false)} />
          )}
        </div>
      </div>
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
