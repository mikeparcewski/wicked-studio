import type { SessionView } from '../api/types.js';
import { currentUnitOf, MOVING, phaseLineOf, phaseNodesOf, truncate } from '../board/phaseProgress.js';
import { activeUnit, lastMeaningfulLines, useRunHeadline } from '../hooks/useBoardHeadline.js';
import type { BoardProject } from '../hooks/useBoardModel.js';
import { modePath, type Navigate } from '../hooks/useRoute.js';
import { useGateStore } from '../store/gates.js';
import { outputKey, useRuntimeStore } from '../store/runtime.js';
import { ago, SIGNAL_BAR } from './ProjectCard.js';

/**
 * The live feed — the orchestrator home's right sidebar (DES-VISION-001 §1.3,
 * §1.4, §5.1): the ONE place where cross-project narration aggregates. The wall's
 * cards are per-project; this column is the system's heartbeat.
 *
 * A narrow column, no header, no scrollbar. Each project with a MOVING run gets
 * a block — dot + name (dim, small, sans), then the newest narration lines in
 * `--font-mono`, newest first — including a project whose attention score sits
 * below the triage threshold: it is doing work, and the operator deserves
 * peripheral awareness of it (§1.4). A project whose LEADING signal is a failure
 * still in NEEDS YOU gets a fail block with the one action worth taking from the
 * periphery: open the run. A decayed failure does not haunt the feed.
 *
 * Zero new sockets (§5.1): the narration subscribes to the SAME runtime store the
 * cards read, fed by the app's one `/ws` subscription — a `unitOutputDelta` lands
 * here and on the owning card from the same fold. Motion is §1.6's grammar: a new
 * line fades in at the top of its block (`--dur-fast`), a new block fades in
 * (`--dur-base`), nothing loops (see `.wk-feed-*` in global.css).
 */

/** Runs narrating per block, and lines for the lead run — the block never exceeds
 *  3 lines (§1.3): 2 from the newest run, 1 from the next; extras are silence. */
const MAX_RUNS = 2;
const MAX_LINES = 2;

const CSS = {
  feed: {
    width: '32%', minWidth: '260px', maxWidth: '460px', flexShrink: 0,
    // No scrollbar (§1.3): the feed is peripheral vision, not a log to trawl —
    // the thread inside the project is where a user goes to watch (§1.4).
    overflow: 'hidden',
    background: 'var(--surface-rail)', padding: 'var(--space-4)',
    display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
  },
  head: { display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 2px', minWidth: 0 },
  dot: { width: '6px', height: '6px', borderRadius: 'var(--radius-full)', flexShrink: 0 },
  name: {
    fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', textDecoration: 'none',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  // Base ink lives on `.wk-feed-link` (global.css) so the §10.1 hover lift —
  // --ink-body → --ink-high — can win; the failure line overrides it inline.
  line: {
    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
    margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
} as const satisfies Record<string, React.CSSProperties>;

/** Real-link props for a run's view (§10.1): href + in-app onClick. */
type Link = (runId: string) => { href: string; onClick: (e: React.MouseEvent) => void };

/** Real-link props for an arbitrary path (the block header's project link). */
type PathLink = (path: string) => { href: string; onClick: (e: React.MouseEvent) => void };

/**
 * One moving run's narration window: the newest distinct lines of its active
 * unit's delta buffer, newest first; before any output has streamed, the run's
 * headline (§3.4(b)) — a truthful subject, never a blank block.
 *
 * Since slice J (DES-FEEDBACK-002 §10.1) every line is the same real link the
 * failure line already was: an anchor to the run's view — middle-clickable,
 * deep-linkable. The operator sees a run narrating and CAN click the words.
 * No underline at rest (mono narration must not read as prose links); hover
 * lifts the ink and fades in the ↗ at line-end (`.wk-feed-link`, global.css).
 */
function RunLines({ view, max, link }: { view: SessionView; max: number; link: Link }): React.ReactElement {
  const runId = view.session.id;
  const ord = activeUnit(view)?.ord ?? 0;
  const text = useRuntimeStore((s) => s.outputs[outputKey(runId, ord)]);
  const headline = useRunHeadline(view);
  const lines = lastMeaningfulLines(text, max);
  const shown = lines.length > 0 ? lines : [headline];
  return (
    <>
      {shown.map((line) => (
        // Keyed by content: a NEW line remounts and plays the §1.6 fade-in once;
        // a repeated frame carrying the same status is the same element, no motion.
        <a
          key={line}
          {...link(runId)}
          data-testid="feed-line"
          data-run-id={runId}
          title={line}
          className="wk-feed-line wk-feed-link"
          style={CSS.line}
        >
          {line}
        </a>
      ))}
    </>
  );
}

/**
 * The block's phase line + current-unit description (DES-UX-002 §1.3, slice
 * BA): `phase n/N · stage-name` derived from the lead moving run's unit plan
 * (§1.2's CLIENT derivation, live `unitDispatched` on top), and beneath it the
 * unit's own description — the block names WHERE the work is, so a project
 * accumulating evidence below the triage threshold is still legible from the
 * periphery (the brief's "quiet accumulation" condition).
 */
function FeedPhase({ view }: { view: SessionView }): React.ReactElement | null {
  const log = useRuntimeStore((s) => s.logs[view.session.id]);
  const unit = currentUnitOf(view.units, log);
  const line = phaseLineOf(phaseNodesOf(view.units, unit?.ord));
  if (line === null || unit === undefined) return null;
  return (
    <>
      <p data-testid="feed-phase-line" data-run-id={view.session.id} style={{ ...CSS.line, color: 'var(--ink-muted)' }}>
        {line}
      </p>
      <p
        data-testid="feed-unit-description"
        data-run-id={view.session.id}
        title={unit.description}
        style={{ ...CSS.line, color: 'var(--ink-body)' }}
      >
        {truncate(unit.description, 60)}
      </p>
    </>
  );
}

function FeedBlock({ item, navigate }: { item: BoardProject; navigate: Navigate }): React.ReactElement {
  const { project, runs, signal } = item;
  const moving = runs.filter((v) => MOVING.has(v.session.status));
  // Slice BA (§1.3): an escalated-but-not-posted gate on any of this project's
  // runs — the amber approaching line, same store fold the card chip reads.
  const near = useGateStore((s) => {
    for (const v of runs) {
      const g = s.approaching[v.session.id];
      if (g !== undefined) return g;
    }
    return undefined;
  });
  const failing = signal !== null && signal.kind === 'failing'
    ? runs.find((v) => v.session.status === 'failed')
    : undefined;
  const pathLink: PathLink = (path) => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });
  // §10.1: MOVING runs are build runs today — the run-kind rule applies if the
  // feed ever narrates a chat thread.
  const runLink: Link = (runId) => pathLink(modePath(project.id, 'build', runId));
  return (
    <section
      data-testid={`live-feed-block-${project.id}`}
      data-project-id={project.id}
      className="wk-feed-block"
    >
      <p style={CSS.head}>
        <span
          aria-hidden
          style={{ ...CSS.dot, background: signal !== null ? SIGNAL_BAR[signal.kind] : 'var(--ink-dim)' }}
        />
        {/* The block header keeps its project-level link — two altitudes, both real. */}
        <a {...pathLink(modePath(project.id, 'build'))} style={CSS.name}>{project.name}</a>
      </p>
      {/* Slice BA (§1.3): phase n/N · stage + the current unit, off the lead run. */}
      {moving[0] !== undefined && <FeedPhase view={moving[0]} />}
      {moving.slice(0, MAX_RUNS).map((v, i) => (
        <RunLines key={v.session.id} view={v} max={i === 0 ? MAX_LINES : 1} link={runLink} />
      ))}
      {near !== undefined && (
        <p
          data-testid="feed-gate-approaching"
          data-run-id={near.runId}
          title={near.condition}
          style={{ ...CSS.line, color: 'var(--status-gate)' }}
        >
          ⏳ gate: {truncate(near.condition, 40)}
        </p>
      )}
      {failing !== undefined && signal !== null && (
        // §10.1: the whole failure line is now the run link (anchors don't
        // nest); `[open run]` stays as the visible affordance inside it.
        <a
          {...runLink(failing.session.id)}
          data-testid="feed-line"
          data-run-id={failing.session.id}
          className="wk-feed-link"
          style={{ ...CSS.line, color: 'var(--status-fail)' }}
        >
          failed {ago(signal.at)} ago
          <span
            data-testid="feed-open-run"
            style={{ marginLeft: '6px', color: 'var(--status-fail)', textDecoration: 'underline' }}
          >
            [open run]
          </span>
        </a>
      )}
    </section>
  );
}

interface Props {
  /** The board's own score-ordered items — the feed adds no second data model. */
  items: BoardProject[];
  navigate: Navigate;
}

export function LiveFeed({ items, navigate }: Props): React.ReactElement | null {
  const blocks = items.filter(
    (i) =>
      i.runs.some((v) => MOVING.has(v.session.status)) ||
      (i.band === 'needs-you' && i.signal?.kind === 'failing'),
  );
  // Nothing is running anywhere: the column is ABSENT, not an empty frame —
  // the empty-state budget (DES-UXFIX-001 §2.1.2) applies to regions too.
  if (blocks.length === 0) return null;
  return (
    <aside data-testid="live-feed" data-blocks={blocks.length} style={CSS.feed}>
      {blocks.map((item) => (
        <FeedBlock key={item.project.id} item={item} navigate={navigate} />
      ))}
    </aside>
  );
}
