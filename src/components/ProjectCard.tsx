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

const CSS = {
  card: {
    height: `${CARD_H}px`, boxSizing: 'border-box', overflow: 'hidden', background: '#161b22',
    border: `1px solid ${S.border}`, borderRadius: '10px', padding: '14px',
    display: 'flex', flexDirection: 'column',
  },
  header: { display: 'flex', alignItems: 'center', gap: '8px' },
  name: {
    fontSize: '13px', fontWeight: 700, color: S.ink, textDecoration: 'none',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  repo: { marginLeft: 'auto', fontSize: '10px', fontFamily: 'monospace', color: S.faint, flexShrink: 0 },
  label: { fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', color: S.faint },
  tile: {
    flex: 1, minWidth: 0, background: 'rgba(230,237,243,0.04)',
    border: `1px solid ${S.border}`, borderRadius: '6px', padding: '5px 7px',
  },
  tileName: { fontSize: '11px', color: S.ink, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chip: {
    display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none',
    fontSize: '11px', fontFamily: 'monospace', color: S.muted, borderRadius: '5px', padding: '3px 7px',
  },
  quick: {
    display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none',
    background: 'rgba(230,237,243,0.05)', border: `1px solid ${S.border}`,
    borderRadius: '6px', color: S.ink,
  },
} as const satisfies Record<string, React.CSSProperties>;

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
      <p style={{ ...CSS.label, margin: '0 0 4px' }}>{title}</p>
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
  const when = updatedAt === null ? NaN : Date.parse(updatedAt);
  return (
    <div data-testid="doc-tile" data-doc-kind={kind} style={CSS.tile}>
      <p style={CSS.tileName}>
        <span aria-hidden style={{ marginRight: '4px' }}>{kind === 'demo' ? '▶' : '▤'}</span>
        {name}
      </p>
      <p style={{ fontSize: '10px', color: S.faint, margin: '2px 0 0', fontFamily: 'monospace' }}>
        {Number.isNaN(when) ? 'not yet edited' : `${ago(when)} ago`}
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

  /** Every affordance on the card is a real link — deep-linkable, middle-clickable. */
  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  return (
    <section data-testid="project-card" data-project-id={project.id} data-attention={attention} style={CSS.card}>
      {/* Header — name, repo binding, status dot */}
      <div style={CSS.header}>
        <span
          data-testid="project-status-dot"
          aria-hidden
          style={{ width: '8px', height: '8px', borderRadius: '50%', background: DOT[attention], flexShrink: 0 }}
        />
        <a {...link(modePath(project.id, 'build'))} style={CSS.name}>{project.name}</a>
        <span data-testid="project-repo" style={CSS.repo}>{repo ?? 'no repo'}</span>
      </div>

      {/* Documents — placeholder tiles only (§7.5), capped so the card cannot grow */}
      <Region title="Documents">
        {docs.length === 0 ? <Invitation text="No documents yet." /> : (
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
        {runs.length === 0 ? <Invitation text="No runs yet." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {runs.slice(0, MAX_CHIPS).map(({ session, units }) => {
              const style = STATUS_STYLE[session.status];
              const gate = gates[session.id];
              const phase = units[session.unit_ix]?.stage ?? units[units.length - 1]?.stage ?? 'planning';
              const waiting = session.status === 'awaiting_human';
              return (
                <a
                  key={session.id}
                  {...link(modePath(project.id, 'build', session.id))}
                  data-testid="run-chip"
                  data-run-id={session.id}
                  data-status={session.status}
                  style={{
                    ...CSS.chip,
                    border: `1px solid ${waiting ? 'rgba(255,218,25,0.3)' : S.border}`,
                    background: waiting ? 'rgba(255,218,25,0.1)' : 'transparent',
                  }}
                >
                  <span style={{ color: style?.color ?? S.faint }}>{phase}</span>
                  {waiting && <span style={{ color: S.accent, fontWeight: 700 }}>gate</span>}
                  {/* Elapsed exists only where the wire carries a timestamp: `AgentSession`
                      has no `started_at`, so a gate's daemon-cached `receivedAt` is the one
                      honest clock on this surface. */}
                  <span style={{ marginLeft: 'auto' }}>
                    {waiting ? (gate ? `waiting ${ago(gate.receivedAt)}` : 'needs you') : style?.label ?? session.status}
                  </span>
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
      {empty && <p style={{ ...CSS.label, margin: '10px 0 0' }}>Start here</p>}
      <div
        data-testid="quick-actions"
        style={{
          marginTop: 'auto', paddingTop: empty ? '4px' : '10px', display: 'grid', gap: '6px',
          gridTemplateColumns: empty ? '1fr 1fr' : 'repeat(4, minmax(0,1fr))',
        }}
      >
        {ACTIONS.map((a) => (
          <a
            key={a.mode}
            {...link(modePath(project.id, a.mode))}
            data-testid="quick-action"
            data-mode={a.mode}
            style={{
              ...CSS.quick, justifyContent: empty ? 'flex-start' : 'center',
              padding: empty ? '10px 12px' : '6px 8px',
              fontSize: empty ? '12px' : '11px', fontWeight: empty ? 600 : 400,
            }}
          >
            <span aria-hidden>{a.glyph}</span> {a.label}
          </a>
        ))}
      </div>
    </section>
  );
}
