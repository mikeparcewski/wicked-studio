import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { narrateStranded } from '../src/components/narrator.js';
import { NeedsYouQueue } from '../src/components/NeedsYouQueue.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';

/**
 * Stranded completed runs in the needs-you queue (crew#393): a completed run
 * the 0.18.0 wire marks `delivery: 'stranded'` is reviewable work sitting
 * invisible in a worktree — a person's job, so it queues. The row:
 *
 *  - fires ONLY off the wire's own verdict (studio never infers stranded);
 *  - sits below failures (nothing broke) and above the ambient rows;
 *  - speaks the narrator's ONE stranded template (single template source);
 *  - is UNWINDOWED, like gates: the wire clears the state itself once the run
 *    is delivered or its worktree is reaped;
 *  - opens the run in place (the Delivery card carries the one-click Deliver —
 *    the queue never POSTs).
 */

const NOW = 1_700_000_000_000;

function inputs(over: Partial<NeedsYouInputs>): NeedsYouInputs {
  return {
    runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {},
    chats: [], repos: [], campaigns: [], now: NOW, ...over,
  };
}

function completedRun(id: string, delivery?: 'delivered' | 'stranded' | 'none'): SessionView {
  const v = makeView(
    { id, workflow_id: 'feature', status: 'completed', problem: `problem of ${id}`, workdir: `/w/${id}` },
    [makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' })],
  );
  if (delivery !== undefined) (v.session as SessionWithDelivery).delivery = delivery;
  return v;
}

describe('stranded completed runs queue (crew#393)', () => {
  it('a wire-stranded completed run gets a row; delivered / none / wireless ones do not', () => {
    const rows = needsYouRows(inputs({
      runs: [
        completedRun('r-stranded', 'stranded'),
        completedRun('r-delivered', 'delivered'),
        completedRun('r-none', 'none'),
        completedRun('r-pre-018'), // no wire field at all (older daemon)
      ],
    }));
    expect(rows.map((r) => r.key)).toStrictEqual(['stranded:r-stranded']);
    const row = rows[0]!;
    expect(row.kind).toBe('stranded-run');
    expect(row.subject).toBe('problem of r-stranded');
    expect(row.subjectPath).toBe('/runs/r-stranded');
    expect(row.action).toStrictEqual({ kind: 'open', path: '/runs/r-stranded', label: 'Open run ›' });
  });

  it('speaks the narrator’s ONE stranded template — queue and template cannot fork', () => {
    const rows = needsYouRows(inputs({ runs: [completedRun('r-1', 'stranded')] }));
    const line = narrateStranded();
    expect(rows[0]!.text).toBe(line.text);
    expect(rows[0]!.tone).toBe(line.tone);
    expect(line.tone).toBe('gate'); // waiting on a person — not a failure, not motion
  });

  it('orders below a failed run and above a campaign row', () => {
    const rows = needsYouRows(inputs({
      runs: [
        completedRun('r-str', 'stranded'),
        makeView({ id: 'r-fail', status: 'failed', problem: 'broke' }),
      ],
    }));
    expect(rows.map((r) => r.kind)).toStrictEqual(['failed-run', 'stranded-run']);
  });

  it('is UNWINDOWED — a stranded run beyond the failed-run window still queues', () => {
    // 35 newer runs push the stranded one past FAILED_WINDOW (30). A failure
    // that old would roll off; stranded work does not — it stays until the
    // wire itself clears it.
    const newer = Array.from({ length: 35 }, (_, i) => completedRun(`r-new-${i}`, 'none'));
    const rows = needsYouRows(inputs({ runs: [...newer, completedRun('r-old', 'stranded')] }));
    expect(rows.map((r) => r.key)).toStrictEqual(['stranded:r-old']);
  });

  it('an ARCHIVED stranded run is written off — no row', () => {
    const v = completedRun('r-arch', 'stranded');
    const rows = needsYouRows(inputs({
      runs: [{ ...v, session: { ...v.session, archived_at: NOW - 1000 } }],
    }));
    expect(rows).toStrictEqual([]);
  });

  it('the honest clock: attach when known, otherwise unknown', () => {
    const dated = needsYouRows(inputs({
      runs: [completedRun('r-1', 'stranded')],
      attachedAt: { 'r-1': NOW - 5000 },
    }));
    expect(dated[0]!.at).toBe(NOW - 5000);
    const undated = needsYouRows(inputs({ runs: [completedRun('r-1', 'stranded')] }));
    expect(undated[0]!.at).toBeNull();
  });

  it('only COMPLETED runs strand — the wire never marks others, and the fold double-guards', () => {
    // Defense in depth: even a (contractually impossible) stranded word on a
    // non-completed run adds no row, because the fold gates on the status arm.
    const v = completedRun('r-x', 'stranded');
    const rows = needsYouRows(inputs({
      runs: [{ ...v, session: { ...v.session, status: 'executing' } }],
    }));
    expect(rows).toStrictEqual([]);
  });
});

describe('the home queue component counts stranded runs', () => {
  afterEach(cleanup);

  it('renders the stranded row in the needs-you count, never the calm copy', () => {
    const runs = [completedRun('r-str', 'stranded'), completedRun('r-ok', 'delivered')];
    const rows = needsYouRows(inputs({ runs }));
    render(<NeedsYouQueue rows={rows} runs={runs} navigate={vi.fn()} now={NOW} />);

    const queue = screen.getByTestId('needs-you-queue');
    expect(queue.dataset.count).toBe('1');
    expect(queue.textContent).toContain('Needs you (1)');
    expect(screen.queryByTestId('home-calm')).toBeNull(); // a row bans calm (§3)

    const row = screen.getByTestId('need-row');
    expect(row.dataset.kind).toBe('stranded-run');
    expect(screen.getByTestId('need-line').textContent).toBe(narrateStranded().text);
    // Open-in-place — the queue never POSTs; the Delivery card owns the click.
    const act = screen.getByTestId('need-act');
    expect(act.dataset.act).toBe('open');
    expect(act).toHaveAttribute('href', '/runs/r-str');
  });
});
