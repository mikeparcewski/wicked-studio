import type { SessionView } from '../api/types.js';
import type { SignalKind } from '../board/boardAttention.js';
import { isLive, useRunHeadline } from '../hooks/useBoardHeadline.js';
import { modePath, MODES, type Navigate } from '../hooks/useRoute.js';
import type { Attention, BoardProject } from '../hooks/useBoardModel.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { ExportMenu } from './ExportMenu.js';
import { GateChip } from './GateChip.js';
import { edgeStateOf, LiveEdge } from './LiveEdge.js';
import { MODE_SPECS } from './ModeSwitcher.js';
import { STATUS_STYLE } from './RunCard.js';

/**
 * One orchestrator-board card, in TWO variants chosen by the decayed attention
 * band (DES-UXFIX-001 §2.1.1, slice 2):
 *
 *   ACTIVE (band `needs-you`) — rich: header + attention pill, live headline,
 *   answerable run/gate chips, doc tiles. A region with no content is OMITTED,
 *   never filled with a "nothing" line — the empty-state budget (§2.1.2, F1).
 *   QUIET (band `quiet`) — calm, not empty: ONE line of absence
 *   (`quiet-summary`) plus a compact action row. A brand-new empty project's
 *   one line is the first-run invitation instead (§2.1.2's single exception).
 *
 * Heights stay FIXED per variant so each band's windowing math holds — nothing
 * here may grow with the run or doc count, which is why every list is capped
 * with an overflow count instead of scrolling.
 *
 * Live activity and the run chips subscribe to the SHARED runtime + gate stores
 * (slice 6) — the same stores the run view reads, fed by the app's ONE `/ws`
 * subscription (§3.5). A card therefore updates in place while the user is looking
 * at a different card, with no second socket and no polling anywhere on this route.
 */

/** ACTIVE-card slot height in px — the NEEDS YOU band's windowing depends on it.
 *  Sized by the fullest card the caps allow (2 live lines + doc activity + 2 run
 *  chips + a tile row + the action row), so the bottom-anchored actions inside
 *  `overflow: hidden` are never clipped. The card itself sizes to content and
 *  treats this as a `maxHeight`, so a light card is short, not hollow — the
 *  SLOT stays fixed for the windowing math, the pixels do not. */
export const ACTIVE_CARD_H = 330;

/** QUIET-card slot height in px — one summary line plus the action row, with
 *  room for the first-run 2×2 sublabelled grid (§2.2) in the same slot. Also a
 *  `maxHeight`: a compact quiet card renders at its natural ~one-line height. */
export const QUIET_CARD_H = 112;

/** How recently a project must have been created for its empty card to read as
 *  "a genuinely brand-new project a user just created" (§2.1.2) and show the
 *  first-run invitation. An empty project OLDER than this is debris, not a
 *  beginning — it gets the plain quiet line so the eye can skip it (W2). */
export const FIRST_RUN_MS = 24 * 3_600_000;

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

/** Attention → dot colour — shared with the rail (slice 3), so the same signal
 *  reads as the same colour on the board card and the sidebar's project list. */
export const ATTENTION_DOT: Record<Attention, string> = {
  gate:    '#ffda19',
  failing: '#f85149',
  running: '#79c0ff',
  drafts:  'rgba(230,237,243,0.45)',
  quiet:   'rgba(230,237,243,0.2)',
};

/** The pill's word for the signal that put the card in NEEDS YOU — user words
 *  (V3: an executing run reads "working", never a scheduler word). */
const PILL: Record<SignalKind, string> = {
  gate: 'gate',
  failing: 'failed',
  running: 'working',
  drafts: 'draft',
};

const CSS = {
  card: {
    boxSizing: 'border-box', overflow: 'hidden', background: '#161b22',
    border: `1px solid ${S.border}`, borderRadius: '10px', padding: '14px',
    display: 'flex', flexDirection: 'column',
    // Anchors the live edge, and the radius above clips its ends (see LiveEdge).
    position: 'relative',
  },
  header: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
  name: {
    fontSize: '13px', fontWeight: 700, color: S.ink, textDecoration: 'none',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  repo: { fontSize: '10px', fontFamily: 'monospace', color: S.faint, flexShrink: 0 },
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
    display: 'flex', alignItems: 'center', gap: '5px', textDecoration: 'none',
    background: 'rgba(230,237,243,0.05)', border: `1px solid ${S.border}`,
    borderRadius: '6px', color: S.ink, fontSize: '11px',
    overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0,
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

type Link = (path: string) => { href: string; onClick: (e: React.MouseEvent) => void };

/**
 * The four quick actions, relabelled to the mode spine (§2.2, V9/V10/V23): each
 * action IS a mode the user can already see in the switcher, with the switcher's
 * glyph, so the verbs are differentiable (F2) — no more "New chat" vs "Do work".
 * `detail` (the first-run card) lays them out 2×2 with the sublabel visible;
 * elsewhere the sublabel survives on hover via `title`.
 */
function QuickActions({ projectId, link, detail }: {
  projectId: string;
  link: Link;
  detail: boolean;
}): React.ReactElement {
  return (
    <div
      data-testid="quick-actions"
      data-detail={detail ? 'true' : undefined}
      style={{
        marginTop: 'auto', display: 'grid', gap: detail ? '4px' : '6px',
        gridTemplateColumns: detail ? '1fr 1fr' : 'repeat(4, minmax(0,1fr))',
      }}
    >
      {MODES.map((m) => {
        const spec = MODE_SPECS[m];
        return (
          <a
            key={m}
            {...link(modePath(projectId, m))}
            data-testid="quick-action"
            data-mode={m}
            title={`${spec.label} — ${spec.sublabel}`}
            style={{
              ...CSS.quick,
              justifyContent: detail ? 'flex-start' : 'center',
              padding: detail ? '4px 8px' : '5px 8px',
            }}
          >
            <span aria-hidden style={{ flexShrink: 0 }}>{spec.glyph}</span>
            <span style={{ fontWeight: 600, flexShrink: 0 }}>{spec.label}</span>
            {detail && (
              <span
                data-testid="quick-action-sublabel"
                style={{ color: S.faint, fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {spec.sublabel}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}

/**
 * A doc tile is a PLACEHOLDER — title, kind glyph, updated-at (§7.5) — plus §4.4's quick
 * action: exporting is the one thing worth doing to a document without opening it, and it
 * belongs to the DOCUMENT rather than to the project, so it lives on the tile. Live-rendered
 * thumbnails were explicitly deferred: 20 cards × 3 iframes is a browser's worth of
 * documents to keep mounted for a surface the user is only scanning.
 *
 * `when` is epoch millis (NaN = never edited): a relayed `status.posted` for this
 * doc dates the tile from the frame, because between `listDocs` calls that event IS
 * the document changing.
 */
function DocTile({ projectId, name, kind, head, when }: {
  projectId: string; name: string; kind: string; head: number; when: number;
}): React.ReactElement {
  return (
    <div data-testid="doc-tile" data-doc-kind={kind} style={CSS.tile}>
      <p style={CSS.tileName}>
        <span aria-hidden style={{ marginRight: '4px' }}>{kind === 'demo' ? '▶' : '▤'}</span>
        {name}
      </p>
      <p style={{ fontSize: '10px', color: S.faint, margin: '2px 0 0', fontFamily: 'monospace' }}>
        {Number.isNaN(when) ? 'not yet edited' : `${ago(when)} ago`}
      </p>
      {/* The card exports the HEAD — the only version a surface that shows none can mean. */}
      <ExportMenu projectId={projectId} docId={name} version={head} compact />
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
  const { project, repo, runs, docs, attention, band, score, signal } = item;
  const gates = useGateStore((s) => s.gates);
  // Relayed interactive status for THIS project — one line, plus the tile date it implies.
  const activity = useRuntimeStore((s) => s.docActivity[project.id]);
  const live = runs.filter(isLive);
  const empty = runs.length === 0 && docs.length === 0;
  /** The §2.1.2 exception: empty AND just created — not merely empty. */
  const firstRun = empty && Date.now() - project.created_at < FIRST_RUN_MS;
  const quiet = band === 'quiet';

  /** Every affordance on the card is a real link — deep-linkable, middle-clickable. */
  const link: Link = (path) => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  const cardData = {
    'data-testid': 'project-card',
    'data-project-id': project.id,
    'data-attention': attention,
    // The decay verdict, readable off the DOM (slice-1 AC): which band this card
    // sorted into, the score that put it there, the top signal — and, new in
    // slice 2, the variant the band chose.
    'data-band': band,
    'data-variant': quiet ? 'quiet' : 'active',
    'data-score': score.toFixed(2),
    ...(signal !== null ? { 'data-signal': signal.kind } : {}),
  } as const;

  // The dot stays for colour continuity with the sort bucket; on an ACTIVE card
  // the pill beside the repo is what names the signal.
  const dot = (
    <span
      data-testid="project-status-dot"
      aria-hidden
      style={{ width: '8px', height: '8px', borderRadius: '50%', background: ATTENTION_DOT[attention], flexShrink: 0 }}
    />
  );
  const name = <a {...link(modePath(project.id, 'build'))} style={CSS.name}>{project.name}</a>;
  const repoTag = repo != null
    ? <span data-testid="project-repo" style={CSS.repo}>{repo}</span>
    : null;

  // ── QUIET (§2.1.1): calm is ONE line, not three announcements of absence ──
  if (quiet) {
    return (
      <section {...cardData} style={{ ...CSS.card, maxHeight: `${QUIET_CARD_H}px` }}>
        <LiveEdge state={edgeStateOf(runs.map((v) => v.session.status))} />
        <div style={CSS.header}>
          {dot}
          {name}
          {repoTag}
          {/* The empty-state budget (§2.1.2): the ONE line of absence. A brand-new
              empty project gets the first-run invitation instead — the sole
              exception, and it is still one line. */}
          {firstRun ? (
            <a
              {...link(modePath(project.id, 'chat'))}
              data-testid="quiet-summary"
              data-invitation="true"
              // EC1: the ONE obvious next action — the brightest thing on the card.
              style={{ marginLeft: 'auto', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: S.accent, textDecoration: 'none' }}
            >
              Start by describing what you want →
            </a>
          ) : (
            <p
              data-testid="quiet-summary"
              style={{ marginLeft: 'auto', flexShrink: 0, fontSize: '11px', color: S.faint, margin: 0 }}
            >
              Quiet — last active {ago(signal?.at ?? project.updated_at)} ago
            </p>
          )}
        </div>
        {/* Compact on a quiet card — a calm board is scanned, not operated (W2);
            the first-run card is where the sublabelled grid teaches (W1). */}
        <QuickActions projectId={project.id} link={link} detail={firstRun} />
      </section>
    );
  }

  // ── ACTIVE (§2.1.1): rich, but a region with no content is OMITTED (F1) ──
  return (
    <section {...cardData} style={{ ...CSS.card, maxHeight: `${ACTIVE_CARD_H}px` }}>
      {/* The card's own state signal, read from the RUNS rather than from `attention`:
          a project bucketed as `failing` can still have something executing on it, and
          the edge answers "is work moving here", not "which bucket did this sort into". */}
      <LiveEdge state={edgeStateOf(runs.map((v) => v.session.status))} />

      {/* Header — name, repo binding, and the pill naming why this card needs you. */}
      <div style={CSS.header}>
        {dot}
        {name}
        {repoTag}
        {signal !== null && (
          <span
            data-testid="attention-pill"
            data-kind={signal.kind}
            style={{
              marginLeft: 'auto', flexShrink: 0, fontSize: '10px', fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase', color: ATTENTION_DOT[attention],
              border: `1px solid ${S.border}`, borderRadius: '999px', padding: '1px 8px',
            }}
          >
            {PILL[signal.kind]}
          </span>
        )}
      </div>

      {/* Live activity — the newest narration line per in-flight run (§1.4, §3.4(b)),
          plus the newest relayed doc status. Both arrive on the shared `/ws` stream. */}
      {(live.length > 0 || activity !== undefined) && (
        <div data-testid="live-activity" style={{ marginTop: '10px' }}>
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

      {/* Crew runs — phase, gate state, elapsed */}
      {runs.length > 0 && (
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
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

      {/* Documents — placeholder tiles only (§7.5), capped so the card cannot grow.
          No docs ⇒ no region: omitted, never "No documents yet" (§2.1.2). */}
      {docs.length > 0 && (
        <div style={{ marginTop: '10px', display: 'flex', gap: '6px', alignItems: 'stretch' }}>
          {docs.slice(0, MAX_TILES).map((d) => (
            <DocTile
              key={d.name}
              projectId={project.id}
              name={d.name}
              kind={d.kind}
              head={d.head}
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

      <QuickActions projectId={project.id} link={link} detail={false} />
    </section>
  );
}
