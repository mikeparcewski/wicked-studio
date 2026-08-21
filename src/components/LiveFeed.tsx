import type { SessionView } from '../api/types.js';
import { activeUnit, lastMeaningfulLines, useRunHeadline } from '../hooks/useBoardHeadline.js';
import type { BoardProject } from '../hooks/useBoardModel.js';
import { modePath, type Navigate } from '../hooks/useRoute.js';
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

/** Statuses in which a run is moving under its own power — what earns a block. */
const MOVING: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);

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
  line: {
    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-body)',
    margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
} as const satisfies Record<string, React.CSSProperties>;

type Link = (path: string) => { href: string; onClick: (e: React.MouseEvent) => void };

/**
 * One moving run's narration window: the newest distinct lines of its active
 * unit's delta buffer, newest first; before any output has streamed, the run's
 * headline (§3.4(b)) — a truthful subject, never a blank block.
 */
function RunLines({ view, max }: { view: SessionView; max: number }): React.ReactElement {
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
        <p
          key={line}
          data-testid="feed-line"
          data-run-id={runId}
          title={line}
          className="wk-feed-line"
          style={CSS.line}
        >
          {line}
        </p>
      ))}
    </>
  );
}

function FeedBlock({ item, navigate }: { item: BoardProject; navigate: Navigate }): React.ReactElement {
  const { project, runs, signal } = item;
  const moving = runs.filter((v) => MOVING.has(v.session.status));
  const failing = signal !== null && signal.kind === 'failing'
    ? runs.find((v) => v.session.status === 'failed')
    : undefined;
  const link: Link = (path) => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });
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
        <a {...link(modePath(project.id, 'build'))} style={CSS.name}>{project.name}</a>
      </p>
      {moving.slice(0, MAX_RUNS).map((v, i) => (
        <RunLines key={v.session.id} view={v} max={i === 0 ? MAX_LINES : 1} />
      ))}
      {failing !== undefined && signal !== null && (
        <p
          data-testid="feed-line"
          data-run-id={failing.session.id}
          style={{ ...CSS.line, color: 'var(--status-fail)' }}
        >
          failed {ago(signal.at)} ago
          <a
            {...link(modePath(project.id, 'build', failing.session.id))}
            data-testid="feed-open-run"
            style={{ marginLeft: '6px', color: 'var(--status-fail)', textDecoration: 'underline' }}
          >
            [open run]
          </a>
        </p>
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
