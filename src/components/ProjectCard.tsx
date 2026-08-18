import type { SessionView } from '../api/types.js';
import { isLive, useRunHeadline } from '../hooks/useBoardHeadline.js';
import { modePath, type Mode, type Navigate } from '../hooks/useRoute.js';
import type { Attention, BoardProject } from '../hooks/useBoardModel.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { GateChip } from './GateChip.js';
import { edgeStateOf, LiveEdge } from './LiveEdge.js';
import { STATUS_STYLE } from './RunCard.js';

/**
 * One orchestrator-board card (DES-MERGE-001 §1.4). All regions are ALWAYS
 * present; an empty region renders an invitation, never a blank. The height is
 * FIXED (`CARD_H`) so the board stays legible at 20+ cards — nothing here may grow
 * with the run or doc count, which is why every list is capped with an overflow
 * count instead of scrolling.
 *
 * Live activity and the run chips subscribe to the SHARED runtime + gate stores
 * (slice 6) — the same stores the run view reads, fed by the app's ONE `/ws`
 * subscription (§3.5). A card therefore updates in place while the user is looking
 * at a different card, with no second socket and no polling anywhere on this route.
 */

/**
 * Fixed card height in px — the board's windowing math depends on it.
 *
 * Sized by the TALLEST variant, the empty card: header + three regions + the 2×2
 * quick-action grid. The actions are bottom-anchored (`marginTop: auto`) inside an
 * `overflow: hidden` box, so a height that merely fits would clip the primary
 * affordance the moment a font metric moved. This carries ~16px of slack.
 */
export const CARD_H = 352;

const MAX_TILES = 3;
const MAX_CHIPS = 2;
/** Live lines per card. Fixed height, so extra runs report as a count, not a list. */
const MAX_LINES = 2;

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
    // Anchors the live edge, and the radius above clips its ends (see LiveEdge).
    position: 'relative',
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
  line: {
    display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 2px',
    fontSize: '11px', color: S.muted,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  pulse: {
    width: '5px', height: '5px', borderRadius: '50%', background: '#79c0ff', flexShrink: 0,
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
 *
 * `when` is epoch millis (NaN = never edited): a relayed `status.posted` for this
 * doc dates the tile from the frame, because between `listDocs` calls that event IS
 * the document changing.
 */
function DocTile({ name, kind, when }: { name: string; kind: string; when: number }): React.ReactElement {
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

/**
 * One run's newest narration line (§1.4 live activity, derived per §3.4(b)). One
 * line, ellipsised, never scrolling — the card is scanned, not watched; the thread
 * is where a user goes to watch.
 */
function LiveLine({ view }: { view: SessionView }): React.ReactElement {
  const headline = useRunHeadline(view);
  return (
    <p
      data-testid="live-line"
      data-run-id={view.session.id}
      title={headline}
      style={CSS.line}
    >
      <span aria-hidden style={CSS.pulse} />
      {headline}
    </p>
  );
}

interface Props {
  item: BoardProject;
  navigate: Navigate;
}

export function ProjectCard({ item, navigate }: Props): React.ReactElement {
  const { project, repo, runs, docs, attention } = item;
  const gates = useGateStore((s) => s.gates);
  // Relayed interactive status for THIS project — one line, plus the tile date it implies.
  const activity = useRuntimeStore((s) => s.docActivity[project.id]);
  const live = runs.filter(isLive);
  const empty = runs.length === 0 && docs.length === 0;

  /** Every affordance on the card is a real link — deep-linkable, middle-clickable. */
  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  return (
    <section data-testid="project-card" data-project-id={project.id} data-attention={attention} style={CSS.card}>
      {/* The card's own state signal, read from the RUNS rather than from `attention`:
          a project bucketed as `failing` can still have something executing on it, and
          the edge answers "is work moving here", not "which bucket did this sort into". */}
      <LiveEdge state={edgeStateOf(runs.map((v) => v.session.status))} />

      {/* Header — name, repo binding, status dot. The dot stays for colour continuity
          with the sort bucket; it is no longer the thing that catches the eye. */}
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
              <DocTile
                key={d.name}
                name={d.name}
                kind={d.kind}
                when={
                  activity !== undefined && activity.docId === d.name
                    ? activity.at
                    : d.updated_at === null ? NaN : Date.parse(d.updated_at)
                }
              />
            ))}
            {docs.length > MAX_TILES && (
              <span data-testid="doc-overflow" style={{ alignSelf: 'center', fontSize: '11px', color: S.muted, flexShrink: 0 }}>
                {docs.length - MAX_TILES} more
              </span>
            )}
          </div>
        )}
      </Region>

      {/* Live activity — the newest narration line per in-flight run (§1.4, §3.4(b)),
          plus the newest relayed doc status. Both arrive on the shared `/ws` stream. */}
      <Region title="Live activity">
        {live.length === 0 && activity === undefined ? (
          <Invitation text="Nothing running." />
        ) : (
          <div data-testid="live-activity">
            {live.slice(0, MAX_LINES).map((v) => (
              <LiveLine key={v.session.id} view={v} />
            ))}
            {activity !== undefined && (
              <p data-testid="doc-activity" title={activity.message} style={CSS.line}>
                <span aria-hidden style={{ flexShrink: 0 }}>▤</span>
                {activity.message}
              </p>
            )}
            {live.length > MAX_LINES && (
              <span data-testid="live-overflow" style={{ fontSize: '11px', color: S.muted }}>
                {live.length - MAX_LINES} more running
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
                // A waiting gate is ANSWERABLE, not a badge (§1.4) — so the row is a row:
                // the run link, and beside it a chip carrying its own controls. Nesting
                // buttons inside the link would be neither valid nor operable.
                <div key={session.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <a
                    {...link(modePath(project.id, 'build', session.id))}
                    data-testid="run-chip"
                    data-run-id={session.id}
                    data-status={session.status}
                    style={{
                      ...CSS.chip, flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative',
                      // Clears the strip so a phase label never sits on top of it.
                      paddingLeft: '10px',
                      border: `1px solid ${waiting ? 'rgba(255,218,25,0.3)' : S.border}`,
                      background: waiting ? 'rgba(255,218,25,0.1)' : 'transparent',
                    }}
                  >
                    <LiveEdge state={edgeStateOf([session.status])} />
                    <span style={{ color: style?.color ?? S.faint }}>{phase}</span>
                    {/* Elapsed exists only where the wire carries a timestamp: `AgentSession`
                        has no `started_at`, so a gate's daemon-cached `receivedAt` is the one
                        honest clock on this surface. */}
                    <span style={{ marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {waiting ? (gate ? `waiting ${ago(gate.receivedAt)}` : 'needs you') : style?.label ?? session.status}
                    </span>
                  </a>
                  {waiting && (
                    <GateChip runId={session.id} projectId={project.id} gate={gate} navigate={navigate} />
                  )}
                </div>
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
