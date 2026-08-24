import { Fragment, useMemo, useRef, useState } from 'react';
import { sessionGuidance } from '../api/guidance.js';
import { useGlobalShortcuts, type ShortcutEntry } from '../hooks/useGlobalShortcuts.js';
import type { SessionView } from '../api/types.js';
import type { SignalKind } from '../board/boardAttention.js';
import { leadMovingRun, truncate } from '../board/phaseProgress.js';
import { isLive, useRunHeadline, useRunNarration } from '../hooks/useBoardHeadline.js';
import { modePath, MODES, projectPath, type Navigate } from '../hooks/useRoute.js';
import type { Attention, BoardProject } from '../hooks/useBoardModel.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { BatchSelectBox } from './BatchGateBar.js';
import { ExportMenu } from './ExportMenu.js';
import { GateChip } from './GateChip.js';
import { GateRejectNote } from './GateRejectNote.js';
import { PhaseStrip, useCurrentUnit } from './PhaseStrip.js';
import { PreGateAnnotate } from './PreGateAnnotate.js';
import { ProjectSparkline } from './ProjectSparkline.js';
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
 *
 * Visual language is DES-VISION-001 §5.1 (vision slice 2): every color resolves
 * from a semantic token (§2.11 — lint-enforced at ERROR for this file), the card
 * is `--surface-card` under `--shadow-card`, the ACTIVE card carries a 2px
 * status bar along its top whose color IS the leading signal kind (§1.4), and
 * narration reads in `--font-mono` against the sans labels (§1.5 rule 3).
 */

/** ACTIVE-card slot height in px — the NEEDS YOU band's windowing depends on it.
 *  Sized by the fullest card the caps allow (2 live lines + doc activity + 2 run
 *  chips + a tile row + the action row), so the bottom-anchored actions inside
 *  `overflow: hidden` are never clipped. The card itself sizes to content and
 *  treats this as a `maxHeight`, so a light card is short, not hollow — the
 *  SLOT stays fixed for the windowing math, the pixels do not. (Vision slice 2:
 *  +6px over the pre-token slot — `--space-4` padding is 16px, was 14px, and the
 *  2px status bar rides inside the border-box. Slice BA: +24px for the phase
 *  strip + current-unit description an active-run card now carries, DES-UX-002
 *  §1.3. Slice BD: +92px for the pre-gate annotation widget open at its cap —
 *  a 4-row textarea + the EC52 scope label — DES-UX-002 §4.3.) */
export const ACTIVE_CARD_H = 452;

/** QUIET-card slot height in px — one summary line plus the action row, with
 *  room for the first-run 2×2 sublabelled grid (§2.2) in the same slot. Also a
 *  `maxHeight`: a compact quiet card renders at its natural ~one-line height. */
export const QUIET_CARD_H = 118;

/** How recently a project must have been created for its empty card to read as
 *  "a genuinely brand-new project a user just created" (§2.1.2) and show the
 *  first-run invitation. An empty project OLDER than this is debris, not a
 *  beginning — it gets the plain quiet line so the eye can skip it (W2). */
export const FIRST_RUN_MS = 24 * 3_600_000;

const MAX_TILES = 3;
const MAX_CHIPS = 2;
/** Live lines per card. Fixed height, so extra runs report as a count, not a list. */
const MAX_LINES = 2;

/** Attention → dot colour — shared with the rail (slice 3), so the same signal
 *  reads as the same colour on the board card and the sidebar's project list.
 *  Values are semantic tokens (DES-VISION-001 §2.6): status colors are a
 *  separate layer from the accent, and they are NOT customizable. */
export const ATTENTION_DOT: Record<Attention, string> = {
  gate:    'var(--status-gate)',
  failing: 'var(--status-fail)',
  running: 'var(--status-run)',
  drafts:  'var(--ink-muted)',
  quiet:   'var(--ink-dim)',
};

/** Signal kind → the 2px status-bar color on an ACTIVE card's top (§1.4): the
 *  bar IS the color of the leading signal. Shared with the live feed's block
 *  dots, so the same signal reads identically on the wall and in the feed. */
export const SIGNAL_BAR: Record<SignalKind, string> = {
  gate:    'var(--status-gate)',
  failing: 'var(--status-fail)',
  running: 'var(--status-run)',
  drafts:  'var(--status-done)',
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
    boxSizing: 'border-box', overflow: 'hidden', background: 'var(--surface-card)',
    boxShadow: 'var(--shadow-card)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
    display: 'flex', flexDirection: 'column',
    // Anchors the live edge, and the radius above clips its ends (see LiveEdge).
    position: 'relative',
  },
  header: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 },
  name: {
    fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semi)', color: 'var(--ink-high)',
    textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  repo: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-dim)', flexShrink: 0,
  },
  tile: {
    flex: 1, minWidth: 0, background: 'transparent',
    border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)', padding: '5px 7px',
  },
  tileName: {
    fontSize: 'var(--text-xs)', color: 'var(--ink-body)', margin: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  chip: {
    display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none',
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
    borderRadius: 'var(--radius-sm)', padding: '3px 7px',
  },
  quick: {
    display: 'flex', alignItems: 'center', gap: '5px', textDecoration: 'none',
    background: 'var(--surface-raised)', border: 'none',
    borderRadius: 'var(--radius-md)', color: 'var(--ink-high)', fontSize: 'var(--text-xs)',
    overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0,
  },
  // Narration is DATA: it reads in the mono face at body ink (§1.5 rule 3, §1.4).
  line: {
    display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 2px',
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-body)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  pulse: {
    width: '5px', height: '5px', borderRadius: 'var(--radius-full)',
    background: 'var(--status-run)', flexShrink: 0,
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
            <span style={{ fontWeight: 'var(--weight-semi)', flexShrink: 0 }}>{spec.label}</span>
            {detail && (
              <span
                data-testid="quick-action-sublabel"
                style={{
                  color: 'var(--ink-dim)', fontSize: 'var(--text-2xs)',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                }}
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
      <p
        style={{
          fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', margin: '2px 0 0',
          fontFamily: 'var(--font-mono)',
        }}
      >
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
 *
 * Slice BA (DES-UX-002 §1.3): on the card's LEADING moving run the phase strip +
 * current-unit description below now carry rule 3's duty, so `narrationOnly`
 * renders the line only when something genuinely streamed (rules 1–2) — never
 * the generic `<phase> — <unit title>` fallback twice on one card.
 */
function LiveLine({ view, narrationOnly = false }: {
  view: SessionView;
  narrationOnly?: boolean;
}): React.ReactElement | null {
  const headline = useRunHeadline(view);
  const narration = useRunNarration(view);
  const line = narrationOnly ? narration : headline;
  if (line === null) return null;
  return (
    <p
      data-testid="live-line"
      data-run-id={view.session.id}
      title={line}
      style={CSS.line}
    >
      <span aria-hidden style={CSS.pulse} />
      {line}
    </p>
  );
}

/**
 * The active-run plan region (DES-UX-002 §1.3, slice BA): the phase progress
 * strip over the run's unit plan, and beneath it the current unit's
 * description — the card says WHERE the run is, from data the board already
 * holds (`SessionView.units` + the shared runtime log; zero new requests).
 */
function ActivePlan({ view }: { view: SessionView }): React.ReactElement | null {
  const unit = useCurrentUnit(view);
  if (view.units.length === 0) return null;
  return (
    <div data-testid="active-plan" data-run-id={view.session.id}>
      <PhaseStrip units={view.units} currentOrd={unit?.ord} />
      {unit !== undefined && (
        <p
          data-testid="active-unit-description"
          data-run-id={view.session.id}
          title={unit.description}
          style={{
            margin: '4px 0 0', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
            color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {truncate(unit.description, 60)}
        </p>
      )}
    </div>
  );
}

interface Props {
  item: BoardProject;
  navigate: Navigate;
  /** Slice H (DES-FEEDBACK-002 §2.2): the triage cursor sits on this card —
   *  `data-kbd-selected`, real DOM focus, and the `--accent` ring (EC22). */
  kbdSelected?: boolean;
  /** The run whose inline reject note is open (§2.3) — replaces its chip row. */
  rejectNoteFor?: string | null;
  /** Close the reject note (Escape inside it, or after Enter submits). */
  onRejectNoteClose?: (() => void) | undefined;
}

export function ProjectCard({
  item, navigate, kbdSelected = false, rejectNoteFor = null, onRejectNoteClose,
}: Props): React.ReactElement {
  const { project, repo, runs, docs, attention, band, score, signal } = item;
  const gates = useGateStore((s) => s.gates);
  // Slice BA (DES-UX-002 §1.3): escalated-but-not-yet-posted gates — the
  // approaching preview chip renders from this, the same store fold as gates.
  const approaching = useGateStore((s) => s.approaching);
  // Relayed interactive status for THIS project — one line, plus the tile date it implies.
  const activity = useRuntimeStore((s) => s.docActivity[project.id]);
  const live = runs.filter(isLive);
  // The leading MOVING run — whose plan the phase strip + description show (§1.3).
  const lead = leadMovingRun(runs);
  // Slice L (§9.2): the card's batch-selectable gate is its LEADING waiting
  // run — the same run the triage cursor's `x` toggles (TriageItem.runId).
  const leadingWaiting = runs.find((v) => v.session.status === 'awaiting_human')?.session.id;
  const empty = runs.length === 0 && docs.length === 0;
  /** The §2.1.2 exception: empty AND just created — not merely empty. */
  const firstRun = empty && Date.now() - project.created_at < FIRST_RUN_MS;
  const quiet = band === 'quiet';
  // Slice BD (DES-UX-002 §4.3, EC51): the run the pre-gate annotation widget
  // is bound to — the run under escalation when one exists, else the leading
  // moving run. Available on ANY live run at ANY time (not only "during
  // approach"): the measured escalation→arrival window is milliseconds (see
  // annotations.ts), so approach-scoped composition would be a lie. A run
  // already AT a gate is excluded — the gate card's steer textarea owns that.
  const annotateFor = runs.find(
    (v) => approaching[v.session.id] !== undefined && v.session.status !== 'awaiting_human',
  ) ?? lead;
  // Bumped by the gate-approaching chip (an entry point): opens + focuses the widget.
  const [annotateSignal, setAnnotateSignal] = useState(0);

  // DES-UX-002 §5.4 (slice BE): `n` opens the steer-note widget from the board,
  // through the ONE registry. Registered per card and guard-scoped to the
  // triage-SELECTED card that actually mounts a widget — dispatch walks the
  // table until a guard holds, so every peer card yields silently, and the
  // overlay folds the identical descriptions into one row.
  const nState = useRef({ selected: kbdSelected, has: false });
  nState.current = { selected: kbdSelected, has: annotateFor !== undefined };
  const nEntries = useMemo<ShortcutEntry[]>(() => [{
    id: `annotate-note-${project.id}`,
    chord: { key: 'n' },
    group: 'gates',
    description: 'Compose a steer note on the selected card',
    guard: () => nState.current.selected && nState.current.has,
    handler: (e) => { e.preventDefault(); setAnnotateSignal((x) => x + 1); },
  }], [project.id]);
  useGlobalShortcuts(nEntries);

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
      style={{
        width: '8px', height: '8px', borderRadius: 'var(--radius-full)',
        background: ATTENTION_DOT[attention], flexShrink: 0,
      }}
    />
  );
  // The name leads to the project DASHBOARD (DES-FEEDBACK-001 §4.1, W6): context
  // before actions. The quick actions beside it are still the direct mode doors.
  const name = <a {...link(projectPath(project.id))} style={CSS.name}>{project.name}</a>;
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
              // The ACCENT, not a status color: an invitation is an affordance (§2.5).
              style={{
                marginLeft: 'auto', flexShrink: 0, fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semi)', color: 'var(--accent)', textDecoration: 'none',
              }}
            >
              Start by describing what you want →
            </a>
          ) : (
            <>
              <p
                data-testid="quiet-summary"
                style={{
                  marginLeft: 'auto', flexShrink: 0, fontSize: 'var(--text-xs)',
                  color: 'var(--ink-dim)', margin: 0,
                }}
              >
                Quiet — last active {ago(signal?.at ?? project.updated_at)} ago
              </p>
              {/* Slice E (DES-FEEDBACK-001 §2.1): the 7-day activity sparkline in the
                  quiet row — renders nothing when the window is empty (§2.3). */}
              <ProjectSparkline runs={runs} attachedAt={item.attachedAt} />
            </>
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
    <section
      {...cardData}
      // Slice H (§2.2, EC22): the triage cursor is REAL focus — the card takes
      // programmatic focus (tabIndex -1, never in the tab order) and the ring
      // is a 2px `--accent` outline (outline, not border: no layout shift).
      tabIndex={-1}
      data-kbd-item={project.id}
      {...(kbdSelected ? { 'data-kbd-selected': 'true' } : {})}
      style={{
        ...CSS.card,
        maxHeight: `${ACTIVE_CARD_H}px`,
        // The 2px status bar (DES-VISION-001 §1.4/§5.1): the card's leading
        // signal kind, as color, along the whole top edge — glanceable from
        // across the wall, where the pill's word needs focus to read.
        borderTop: `2px solid ${signal !== null ? SIGNAL_BAR[signal.kind] : 'var(--status-done)'}`,
        outline: kbdSelected ? '2px solid var(--accent)' : 'none',
        outlineOffset: '2px',
      }}
    >
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
              marginLeft: 'auto', flexShrink: 0, fontSize: 'var(--text-2xs)',
              fontWeight: 'var(--weight-bold)', letterSpacing: '0.06em',
              textTransform: 'uppercase', color: ATTENTION_DOT[attention],
              border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-full)',
              padding: '1px 8px',
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
            // The lead moving run narrates only what genuinely streamed —
            // the strip + description below replace its generic fallback (§1.3).
            <LiveLine key={v.session.id} view={v} narrationOnly={v === lead} />
          ))}
          {activity !== undefined && (
            <p data-testid="doc-activity" title={activity.message} style={CSS.line}>
              <span aria-hidden style={{ flexShrink: 0 }}>▤</span>
              {activity.message}
            </p>
          )}
          {live.length > MAX_LINES && (
            <span
              data-testid="live-overflow"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}
            >
              {live.length - MAX_LINES} more running
            </span>
          )}
          {/* Slice BA (§1.3): the phase strip + current-unit description —
              below the narration, above the gate chip. */}
          {lead !== undefined && <ActivePlan view={lead} />}
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
            // Slice H (§2.3): while this run's reject note is open it REPLACES
            // the chip row; Escape inside it restores the row, firing nothing.
            if (rejectNoteFor === session.id && waiting) {
              return (
                <GateRejectNote
                  key={session.id}
                  runId={session.id}
                  onClose={onRejectNoteClose ?? (() => undefined)}
                />
              );
            }
            const near = approaching[session.id];
            return (
              // A waiting gate is ANSWERABLE, not a badge (§1.4) — so the row is a row:
              // the run link, and beside it a chip carrying its own controls. Nesting
              // buttons inside the link would be neither valid nor operable.
              <Fragment key={session.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {/* Slice L (§9.2): the selection slot — checkbox for a simple
                    gate, the ↗ needs-the-thread marker for a complex one;
                    renders only once ≥1 gate is selected anywhere. */}
                {waiting && session.id === leadingWaiting && (
                  <BatchSelectBox runId={session.id} gate={gate} />
                )}
                <a
                  {...link(modePath(project.id, 'build', session.id))}
                  data-testid="run-chip"
                  data-run-id={session.id}
                  data-status={session.status}
                  style={{
                    ...CSS.chip, flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative',
                    // Clears the strip so a phase label never sits on top of it.
                    paddingLeft: '10px',
                    // A waiting gate is amber-status furniture (§5.1): dim fill, full-token text.
                    border: `1px solid ${waiting ? 'var(--status-gate-dim)' : 'var(--surface-raised)'}`,
                    background: waiting ? 'var(--status-gate-dim)' : 'transparent',
                  }}
                >
                  <LiveEdge state={edgeStateOf([session.status])} />
                  <span style={{ color: style?.color ?? 'var(--ink-dim)' }}>{phase}</span>
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
              {/* Slice BA (DES-UX-002 §1.3, EC47): the gate-APPROACHING posture —
                  `gateEscalated` fired, the gate is not yet posted. An amber ring
                  and the criterion preview, deliberately with NO Approve/Reject:
                  this is a signal to compose pre-gate guidance, not an action
                  surface. It retires the moment `awaitingHuman` posts the gate,
                  where the full pill (GateChip, above) takes over. */}
              {!waiting && near !== undefined && (
                // Slice BD: also an ENTRY POINT — clicking the chip opens and
                // focuses the annotation widget below (§4.3's affordance,
                // re-homed onto the chip itself: the widget is standing card
                // furniture now, so the chip focuses rather than creates it).
                <div
                  data-testid="gate-approaching"
                  data-run-id={session.id}
                  data-criterion={near.condition}
                  title={near.condition}
                  onClick={() => setAnnotateSignal((n) => n + 1)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                    border: '1px solid var(--status-gate)', background: 'var(--status-gate-dim)',
                    borderRadius: 'var(--radius-sm)', padding: '3px 7px',
                    overflow: 'hidden', whiteSpace: 'nowrap', cursor: 'pointer',
                  }}
                >
                  <span aria-hidden style={{ color: 'var(--status-gate)', flexShrink: 0 }}>⏳</span>
                  <span style={{ color: 'var(--status-gate)', flexShrink: 0 }}>gate approaching</span>
                  <span style={{ color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {near.condition}
                  </span>
                </div>
              )}
              </Fragment>
            );
          })}
          {runs.length > MAX_CHIPS && (
            <span
              data-testid="run-overflow"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}
            >
              {runs.length - MAX_CHIPS} more
            </span>
          )}
        </div>
      )}

      {/* Slice BD (§4.3, EC51/EC52): the pre-gate annotation widget — steer
          guidance composable on the card's live run at any time; a gate's
          arrival pre-fills its steer textarea from this draft. */}
      {annotateFor !== undefined && (
        <div style={{ marginTop: '8px' }}>
          <PreGateAnnotate
            runId={annotateFor.session.id}
            // Slice BE: the durable note off the run DTO (CREW-UX-7 echo) —
            // pre-populates first; the session draft layers on top.
            guidance={sessionGuidance(annotateFor.session)}
            openSignal={annotateSignal}
          />
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
            <span
              data-testid="doc-overflow"
              style={{
                alignSelf: 'center', fontSize: 'var(--text-xs)',
                color: 'var(--ink-muted)', flexShrink: 0,
              }}
            >
              {docs.length - MAX_TILES} more
            </span>
          )}
        </div>
      )}

      <QuickActions projectId={project.id} link={link} detail={false} />
    </section>
  );
}
