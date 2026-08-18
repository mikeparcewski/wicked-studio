import { modePath, type Mode, type Navigate } from '../hooks/useRoute.js';
import type { Attention, BoardProject } from '../hooks/useBoardModel.js';
import { useGateStore } from '../store/gates.js';
import { STATUS_STYLE } from './RunCard.js';

/**
 * One orchestrator-board card (DES-MERGE-001 §1.4). All four regions are ALWAYS
 * present; an empty region renders an invitation, never a blank. The height is
 * FIXED (`CARD_H`) so the board stays legible at 20+ cards — nothing here may grow
 * with the run or doc count, which is why every list is capped with an overflow
 * count instead of scrolling.
 */

/** Fixed card height in px. The board's windowing math depends on it. */
export const CARD_H = 264;

const MAX_TILES = 3;
const MAX_CHIPS = 2;

const S = {
  card:   '#161b22',
  border: 'rgba(230,237,243,0.1)',
  ink:    '#e6edf3',
  muted:  'rgba(230,237,243,0.55)',
  faint:  'rgba(230,237,243,0.3)',
  accent: '#ffda19',
};

const DOT: Record<Attention, string> = {
  gate:    '#ffda19',
  failing: '#f85149',
  running: '#79c0ff',
  drafts:  'rgba(230,237,243,0.45)',
  quiet:   'rgba(230,237,243,0.2)',
};

const ACTIONS: { mode: Mode; label: string; glyph: string }[] = [
  { mode: 'chat',     label: 'New chat',    glyph: '💬' },
  { mode: 'build',    label: 'Do work',     glyph: '⚙' },
  { mode: 'document', label: 'New doc',     glyph: '▤' },
  { mode: 'video',    label: 'Record demo', glyph: '▶' },
];

/** Coarse, honest relative time — the board never needs second precision. */
export function ago(from: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.round((now - from) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

function Region({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ marginTop: '10px', minHeight: '46px' }}>
      <p style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', color: S.faint, margin: '0 0 4px' }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function Invitation({ text }: { text: string }): React.ReactElement {
  return <p style={{ fontSize: '11px', color: S.faint, margin: 0 }}>{text}</p>;
}

/**
 * A doc tile is a PLACEHOLDER — title, kind glyph, updated-at (§7.5). Live-rendered
 * thumbnails were explicitly deferred: 20 cards × 3 iframes is a browser's worth of
 * documents to keep mounted for a surface the user is only scanning.
 */
function DocTile({ name, kind, updatedAt }: { name: string; kind: string; updatedAt: string | null }): React.ReactElement {
  const when = updatedAt === null ? null : Date.parse(updatedAt);
  return (
    <div
      data-testid="doc-tile"
      data-doc-kind={kind}
      style={{
        flex: 1, minWidth: 0, background: 'rgba(230,237,243,0.04)', border: `1px solid ${S.border}`,
        borderRadius: '6px', padding: '5px 7px',
      }}
    >
      <p style={{ fontSize: '11px', color: S.ink, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span aria-hidden style={{ marginRight: '4px' }}>{kind === 'demo' ? '▶' : '▤'}</span>
        {name}
      </p>
      <p style={{ fontSize: '10px', color: S.faint, margin: '2px 0 0', fontFamily: 'monospace' }}>
        {when !== null && !Number.isNaN(when) ? `${ago(when)} ago` : 'not yet edited'}
      </p>
    </div>
  );
}

interface Props {
  item: BoardProject;
  navigate: Navigate;
}

export function ProjectCard({ item, navigate }: Props): React.ReactElement {
  const { project, repo, runs, docs, attention } = item;
  const gates = useGateStore((s) => s.gates);
  const empty = runs.length === 0 && docs.length === 0;

  function go(path: string, e: React.MouseEvent): void {
    e.preventDefault();
    navigate(path);
  }

  const action = (a: (typeof ACTIONS)[number], large: boolean): React.ReactElement => {
    const path = modePath(project.id, a.mode);
    return (
      <a
        key={a.mode}
        href={path}
        onClick={(e) => go(path, e)}
        data-testid="quick-action"
        data-mode={a.mode}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: large ? 'flex-start' : 'center',
          gap: '6px', textDecoration: 'none', background: 'rgba(230,237,243,0.05)',
          border: `1px solid ${S.border}`, borderRadius: '6px', color: S.ink,
          padding: large ? '10px 12px' : '6px 8px', fontSize: large ? '12px' : '11px',
          fontWeight: large ? 600 : 400,
        }}
      >
        <span aria-hidden>{a.glyph}</span> {a.label}
      </a>
    );
  };

  return (
    <section
      data-testid="project-card"
      data-project-id={project.id}
      data-attention={attention}
      style={{
        height: `${CARD_H}px`, boxSizing: 'border-box', overflow: 'hidden',
        background: S.card, border: `1px solid ${S.border}`, borderRadius: '10px', padding: '14px',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header — name, repo binding, status dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          data-testid="project-status-dot"
          aria-hidden
          style={{ width: '8px', height: '8px', borderRadius: '50%', background: DOT[attention], flexShrink: 0 }}
        />
        <a
          href={modePath(project.id, 'build')}
          onClick={(e) => go(modePath(project.id, 'build'), e)}
          style={{
            fontSize: '13px', fontWeight: 700, color: S.ink, textDecoration: 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {project.name}
        </a>
        <span
          data-testid="project-repo"
          style={{ marginLeft: 'auto', fontSize: '10px', fontFamily: 'monospace', color: S.faint, flexShrink: 0 }}
        >
          {repo ?? 'no repo'}
        </span>
      </div>

      {/* Documents — placeholder tiles only (§7.5), capped so the card cannot grow */}
      <Region title="Documents">
        {docs.length === 0 ? (
          <Invitation text="No documents yet." />
        ) : (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
            {docs.slice(0, MAX_TILES).map((d) => (
              <DocTile key={d.name} name={d.name} kind={d.kind} updatedAt={d.updated_at} />
            ))}
            {docs.length > MAX_TILES && (
              <span data-testid="doc-overflow" style={{ alignSelf: 'center', fontSize: '11px', color: S.muted, flexShrink: 0 }}>
                {docs.length - MAX_TILES} more
              </span>
            )}
          </div>
        )}
      </Region>

      {/* Crew runs — phase, gate state, elapsed */}
      <Region title="Crew runs">
        {runs.length === 0 ? (
          <Invitation text="No runs yet." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {runs.slice(0, MAX_CHIPS).map(({ session, units }) => {
              const style = STATUS_STYLE[session.status];
              const gate = gates[session.id];
              const phase = units[session.unit_ix]?.stage ?? units[units.length - 1]?.stage ?? 'planning';
              const waiting = session.status === 'awaiting_human';
              return (
                <a
                  key={session.id}
                  href={modePath(project.id, 'build', session.id)}
                  onClick={(e) => go(modePath(project.id, 'build', session.id), e)}
                  data-testid="run-chip"
                  data-run-id={session.id}
                  data-status={session.status}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none',
                    fontSize: '11px', fontFamily: 'monospace', color: S.muted,
                    border: `1px solid ${waiting ? 'rgba(255,218,25,0.3)' : S.border}`,
                    background: waiting ? 'rgba(255,218,25,0.1)' : 'transparent',
                    borderRadius: '5px', padding: '3px 7px',
                  }}
                >
                  <span style={{ color: style?.color ?? S.faint }}>{phase}</span>
                  {waiting && <span style={{ color: S.accent, fontWeight: 700 }}>gate</span>}
                  {/* Elapsed exists only where the wire carries a timestamp: `AgentSession`
                      has no `started_at`, so a gate's daemon-cached `receivedAt` is the one
                      honest clock on this surface. */}
                  {waiting && gate && <span style={{ marginLeft: 'auto' }}>waiting {ago(gate.receivedAt)}</span>}
                  {!waiting && <span style={{ marginLeft: 'auto' }}>{style?.label ?? session.status}</span>}
                </a>
              );
            })}
            {runs.length > MAX_CHIPS && (
              <span data-testid="run-overflow" style={{ fontSize: '11px', color: S.muted }}>
                {runs.length - MAX_CHIPS} more
              </span>
            )}
          </div>
        )}
      </Region>

      {/* Quick actions — large when the card IS the empty state (§1.4) */}
      {empty && (
        <p style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', color: S.faint, margin: '10px 0 0' }}>
          Start here
        </p>
      )}
      <div
        data-testid="quick-actions"
        style={{
          marginTop: 'auto', paddingTop: empty ? '4px' : '10px', display: 'grid', gap: '6px',
          gridTemplateColumns: empty ? '1fr 1fr' : 'repeat(4, minmax(0,1fr))',
        }}
      >
        {ACTIONS.map((a) => action(a, empty))}
      </div>
    </section>
  );
}
