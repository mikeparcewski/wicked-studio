import { useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import { ledeCounts, observedSpend, WINDOW_LABEL_STYLE, windowWord, type LedeCounts } from '../board/metrics.js';
import type { BoardProject } from '../hooks/useBoardModel.js';
import type { Navigate } from '../hooks/useRoute.js';
import { useDocThreadStore } from '../store/docThread.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { ActivityRiver } from './ActivityRiver.js';
import { RunOutcomeBar } from './RunOutcomeBar.js';
import { TokenBurnSparkline } from './TokenBurnSparkline.js';

/**
 * The narrative band (DES-FEEDBACK-003 §7.3, slice Q): ~200px that REPLACE the
 * 64px metrics bar — the landing's first two story acts (§7.2). The lede is one
 * sentence COMPOSED from store data (EC29 — every number derives, zero-count
 * segments drop out, the quiet phrase renders on quiet systems); the activity
 * river below it is the picture; the two surviving slice-E tiles fold in as
 * margin notes (§8.5 — the GateLatencyChart retires from the landing, its
 * question answered by the river's gate marks).
 *
 * "While you were away" is honest because its window is the river's own stated
 * 24h of OBSERVED activity — no "since your last visit" clock is invented
 * (§7.3; the wire has no such thing).
 */

// Slice W (DES-UX-001 §5.3): the lede's fold moved to THE one metrics module —
// its gates/live numbers are now `runStats`' own, so the lede and the bottom
// bar cannot diverge. Re-exported so standing importers keep one source.
export { ledeCounts, type LedeCounts } from '../board/metrics.js';

export interface LedeSegment {
  text: string;
  /** Where the number leads (§7.3: every number is a real link). */
  href: string | null;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * §7.3's composition grammar, drop-outs included — exported for tests:
 * zero-count segments vanish; the all-quiet system gets the quiet phrase.
 */
export function composeLede(c: LedeCounts): { quiet: boolean; segments: LedeSegment[] } {
  if (c.finished === 0 && c.gates === 0 && c.live === 0) {
    return {
      quiet: true,
      segments: [
        { text: 'All quiet. ', href: null },
        { text: plural(c.projects, 'project'), href: '/projects' },
        { text: ', nothing running, nothing waiting.', href: null },
      ],
    };
  }
  const segments: LedeSegment[] = [{ text: 'While you were away: ', href: null }];
  if (c.finished > 0) {
    const split = [
      c.passed > 0 ? `${c.passed} passed` : null,
      c.failed > 0 ? `${c.failed} failed` : null,
    ].filter((s) => s !== null).join(', ');
    segments.push({ text: `${plural(c.finished, 'run')} finished — ${split}`, href: '/runs' });
  } else if (c.gates === 0) {
    // Nothing finished, nothing waiting — but something is moving: say that,
    // with the number still derived (EC29), never an empty "away:" stub.
    segments.push({ text: `nothing finished — ${plural(c.live, 'run')} still moving`, href: '/runs' });
  }
  if (c.gates > 0) {
    if (c.finished > 0) segments.push({ text: ' — and ', href: null });
    segments.push({
      text: `${plural(c.gates, 'gate')} ${c.gates === 1 ? 'is' : 'are'} waiting on you`,
      href: '#needs-you',
    });
  }
  segments.push({ text: '.', href: null });
  return { quiet: false, segments };
}

interface Props {
  items: BoardProject[];
  runs: SessionView[];
  /** Merged run id → attach clock (the board's own merge, HomeBoard). */
  attachedAt: Record<string, number>;
  failedAt: Record<string, number>;
  navigate: Navigate;
  now?: number;
}

export function NarrativeBand({ items, runs, attachedAt, failedAt, navigate, now }: Props): React.ReactElement {
  const gates = useGateStore((s) => s.gates);
  const logs = useRuntimeStore((s) => s.logs);
  const landings = useDocThreadStore((s) => s.landings);
  const at = now ?? Date.now();

  const lede = useMemo(
    () => composeLede(ledeCounts(runs, attachedAt, logs, failedAt, items.length, at)),
    [runs, attachedAt, logs, failedAt, items.length, at],
  );

  // Observed spend — literally the same selector as the bottom bar and the
  // margin sparkline's endpoint (slice W: one selector per metric, §5.3).
  const spend = useMemo(() => {
    const s = observedSpend(logs);
    return s.frames > 0 ? s.total : null;
  }, [logs]);

  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => {
      e.preventDefault();
      if (path === '#needs-you') {
        // The gate number lands on the needs-you band itself (§7.3).
        document.querySelector('[data-testid="band-needs-you"]')?.scrollIntoView({ block: 'start' });
      } else {
        navigate(path);
      }
    },
  });

  return (
    <div
      data-testid="narrative-band"
      style={{
        flexShrink: 0, background: 'var(--surface-rail)',
        padding: 'var(--space-3) var(--space-6)',
        display: 'flex', flexDirection: 'column', gap: '10px',
      }}
    >
      {/* Element 1 — the lede (§7.3): the page's largest text besides the H1. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px' }}>
        <p
          data-testid="landing-lede"
          data-question="What happened and what needs me?"
          style={{
            margin: 0, fontSize: 'var(--text-md)', fontFamily: 'var(--font-sans)',
            color: 'var(--ink-high)', minWidth: 0,
          }}
        >
          {lede.segments.map((seg, i) =>
            seg.href === null ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <a key={i} {...link(seg.href)} data-testid="lede-segment"
                 style={{ color: 'var(--ink-high)', textDecoration: 'none', borderBottom: '1px solid var(--surface-raised)' }}>
                {seg.text}
              </a>
            ),
          )}
        </p>
        {/* EC39 (slice W): the lede's numbers name their window — the river's
            own stated 24h, worn as the §5.4 dim-mono suffix. */}
        <span data-testid="lede-window" data-window="24h" style={{ ...WINDOW_LABEL_STYLE, flexShrink: 0 }}>
          {windowWord('24h')}
        </span>
        {spend !== null && (
          <>
            <a {...link('/make')} data-testid="lede-spend"
               data-window="session"
               style={{
                 marginLeft: 'auto', flexShrink: 0, textDecoration: 'none',
                 fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
               }}>
              ${spend.toFixed(2)} observed
            </a>
            {/* EC39: the spend's window — what this page observed this session. */}
            <span data-testid="lede-spend-window" data-window="session" style={{ ...WINDOW_LABEL_STYLE, flexShrink: 0 }}>
              {windowWord('session')}
            </span>
          </>
        )}
      </div>

      {/* Element 2 — the river; element 3 — the margin notes (§7.3/§8.5). */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'stretch' }}>
        <ActivityRiver
          items={items} runs={runs} gates={gates} logs={logs} failedAt={failedAt}
          landings={landings} navigate={navigate} {...(now === undefined ? {} : { now })}
        />
        <div
          data-testid="river-margin"
          style={{
            width: '176px', flexShrink: 0, display: 'flex', flexDirection: 'column',
            justifyContent: 'flex-start', gap: '6px',
            borderLeft: '1px solid var(--surface-raised)',
          }}
        >
          <RunOutcomeBar runs={runs} attachedAt={attachedAt} />
          <TokenBurnSparkline />
        </div>
      </div>
    </div>
  );
}
