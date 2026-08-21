import { useMemo } from 'react';
import type { GitCommit } from '../api/types.js';
import { RunSparkline } from './RunSparkline.js';

/**
 * Commit cadence sparkline (DES-FEEDBACK-001 §3.1, slice E): "Is this repo
 * active or stagnant?" — daily commit bars over the last 30 days, SVG-first
 * via the shared RunSparkline.
 *
 * WIRE HONESTY — the resolution. The crew wire (`GET /repos/:id/git-history`)
 * returns AT MOST 20 commits, dated with git's `%ar` RELATIVE strings
 * ("3 hours ago", "2 days ago", "3 weeks ago") — there is no absolute commit
 * date on this wire. So:
 *   - each commit is placed at the day its own label names (git's rounding,
 *     rendered verbatim: "2 weeks ago" lands at day 14) — never at an
 *     invented finer time;
 *   - labels coarser than the window ("2 months ago", "1 year ago") are NOT
 *     painted into a day — they count into the "older" tally the caption
 *     reports;
 *   - the caption says "last N commits", because 20 recent commits is what
 *     the wire carries, not a complete 30-day history;
 *   - an unparseable date drops the commit from the chart (counted as older),
 *     never lands it at a made-up day.
 */

const DAYS = 30;

/**
 * Days-ago for one git `%ar` label (defensively also accepts an absolute date,
 * should the wire ever gain one), or `null` when the label is coarser than a
 * day-in-window placement allows (months/years) or unparseable.
 */
export function daysAgoOf(date: string, now: number = Date.now()): number | null {
  const m = /^(\d+)\s+(second|minute|hour|day|week)s?\s+ago$/.exec(date.trim());
  if (m !== null) {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit === 'second' || unit === 'minute') return 0;
    if (unit === 'hour') return n >= 24 ? Math.floor(n / 24) : 0;
    if (unit === 'day') return n;
    return n * 7; // weeks — git's own rounding, placed at the day it names
  }
  const parsed = Date.parse(date);
  if (!Number.isNaN(parsed)) {
    const days = Math.floor((now - parsed) / 86_400_000);
    return days >= 0 ? days : null;
  }
  return null;
}

interface Props {
  /** `null` = still loading (the page's decoupled git fetch). */
  commits: GitCommit[] | null;
  now?: number;
}

export function CommitCadence({ commits, now }: Props): React.ReactElement {
  const at = now ?? Date.now();
  const { counts, inWindow, older } = useMemo(() => {
    const buckets = new Array<number>(DAYS).fill(0);
    let painted = 0;
    let outside = 0;
    for (const c of commits ?? []) {
      const days = daysAgoOf(c.date, at);
      if (days === null || days >= DAYS) {
        outside += 1;
        continue;
      }
      const bucket = DAYS - 1 - days;
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
      painted += 1;
    }
    return { counts: buckets, inWindow: painted, older: outside };
  }, [commits, at]);

  if (commits === null) {
    return (
      <p className="text-sm font-mono italic" style={{ color: 'var(--ink-dim)', margin: 0 }}>
        Loading commit history…
      </p>
    );
  }

  if (commits.length === 0) {
    return (
      <div data-testid="commit-cadence" data-state="empty">
        <p className="text-sm font-mono italic" style={{ color: 'var(--ink-dim)', margin: 0 }}>
          No commits yet.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="commit-cadence"
      data-state={inWindow > 0 ? 'ready' : 'older-only'}
      data-total={inWindow}
      data-question="Is this repo active or stagnant?"
    >
      {inWindow > 0 ? (
        <RunSparkline counts={counts} width={280} height={36} color="var(--accent)" testId="commit-cadence-svg" />
      ) : (
        <p className="text-sm font-mono italic" style={{ color: 'var(--ink-dim)', margin: 0 }}>
          Nothing in the last 30 days.
        </p>
      )}
      <p
        className="text-[10px] font-mono"
        style={{ color: 'var(--ink-dim)', margin: '6px 0 0' }}
      >
        last {commits.length} {commits.length === 1 ? 'commit' : 'commits'}
        {older > 0 ? ` · ${older} older than 30d` : ''} · day precision from git relative dates
      </p>
    </div>
  );
}
