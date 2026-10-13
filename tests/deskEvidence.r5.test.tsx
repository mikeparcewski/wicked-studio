import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareJobs } from '../src/board/deskCompare.js';
import { DeskInbox } from '../src/components/desk/DeskInbox.js';
import { resetDeskStream, useDeskStream } from '../src/store/deskStream.js';
import type { CoreEvent } from '../src/api/types.js';
import { NOW, deskRun, names, title } from './fixtures/deskV2.js';

vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
afterEach(cleanup);

/** codex r5 (confirming round) findings. */
describe('codex r5', () => {
  beforeEach(() => resetDeskStream());

  it('a partial, empty Needs-you read never shows the calm all-clear', () => {
    render(<DeskInbox rows={[]} runs={[]} navigate={vi.fn()} now={NOW} settled="partial" agentName={(x) => x} missing={['proposals']} />);
    expect(document.body.textContent).not.toContain('Nothing needs you');
    expect(screen.getByTestId('home-calm')).toHaveTextContent('some sources did not answer');
  });

  it('a partly priced job says "at least" and never takes the cheapest mark', () => {
    const a = deskRun('a'); const b = deskRun('b');
    const cost = (id: string): number => (id === 'a' ? 1 : 2);
    const view = compareJobs([a, b], title, names.agent, cost, (id) => id === 'a');
    const at = view.rows.indexOf('Spend');
    expect(at).toBeGreaterThanOrEqual(0);
    const spend = view.cards.map((c) => c.cells[at]);
    expect(spend[0]?.text).toBe('at least $1.00');
    expect(spend[0]?.best).not.toBe(true);
    expect(spend[1]?.text).toBe('$2.00');
  });

  it('a frame seen live and then read in the backfill shows once', () => {
    const live = { type: 'unitDone', session: 's1', ord: 2 } as unknown as CoreEvent;
    const durable = { type: 'unitDone', session: 's1', ord: 2, seq: 41, ts: NOW } as unknown as CoreEvent;
    useDeskStream.getState().ingest(live);
    useDeskStream.getState().backfill([durable, { type: 'unitDone', session: 's1', ord: 3, seq: 42, ts: NOW } as unknown as CoreEvent]);
    const items = useDeskStream.getState().items;
    expect(items.filter((i) => i.runId === 's1' && (i.event as unknown as { ord: number }).ord === 2)).toHaveLength(1);
    expect(items).toHaveLength(2);
  });
});
