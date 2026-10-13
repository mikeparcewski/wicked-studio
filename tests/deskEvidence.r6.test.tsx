import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callouts, uncheckedKinds } from '../src/board/deskInsights.js';
import { workFingerprint } from '../src/board/deskModel.js';
import type { NeedRow } from '../src/board/needsYou.js';
import type { SessionView } from '../src/api/types.js';
import { DeskInbox } from '../src/components/desk/DeskInbox.js';
import { deskRun } from './fixtures/deskV2.js';

vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
afterEach(cleanup);

const row = (kind: NeedRow['kind'], i: number): NeedRow => ({
  key: `row-${i}`, kind, severity: 100 - i, stakes: 1,
  subject: `Subject ${i}`, text: `Body ${i}`, tone: 'gate', at: null,
  subjectPath: '/watch', action: { kind: 'open', path: '/watch', label: 'Open' },
});

/** codex r6 (confirming round) findings. */
describe('codex r6', () => {
  it('an emptied folder of a non-empty inbox never shows the global all-clear', () => {
    const props = { runs: [], navigate: vi.fn(), now: Date.UTC(2026, 9, 13), settled: 'complete' as const, agentName: (s: string) => s };
    const { rerender } = render(<DeskInbox rows={[row('gate', 0), row('failed-run', 1)]} {...props} />);
    fireEvent.click(screen.getByTestId('desk-inbox-folder-failure'));
    // The last failure clears while the decision remains: the Failures folder stays selected.
    rerender(<DeskInbox rows={[row('gate', 0)]} {...props} />);
    const calm = screen.getByTestId('home-calm');
    expect(calm).not.toHaveTextContent('Nothing needs you');
    expect(calm).toHaveTextContent('Nothing in Failures now · 1 still waiting in All.');
  });

  it('the whole queue empty still reads as the calm all-clear', () => {
    render(<DeskInbox rows={[]} runs={[]} navigate={vi.fn()} now={Date.UTC(2026, 9, 13)} settled="complete" agentName={(s) => s} />);
    expect(screen.getByTestId('home-calm')).toHaveTextContent('Nothing needs you');
  });

  it('a run changing state with no unit finishing moves the work fingerprint; a unit merely starting does not', () => {
    const running = deskRun('a', { status: 'executing' });
    const failed = deskRun('a', { status: 'failed' });
    expect(workFingerprint([failed])).not.toBe(workFingerprint([running]));
    const withUnit = (status: string): SessionView => ({ ...running, units: [{ ord: 1, status }] }) as unknown as SessionView;
    expect(workFingerprint([withUnit('distributed')])).toBe(workFingerprint([withUnit('pending')]));
    expect(workFingerprint([withUnit('rejected')])).not.toBe(workFingerprint([withUnit('distributed')]));
    // Order-stable: the same runs in another order are the same work.
    const b = deskRun('b');
    expect(workFingerprint([running, b])).toBe(workFingerprint([b, running]));
  });

  it('a benched kind never explains a step that ran without its checks', () => {
    const f = { fallbacks: 5, kinds: { auth_failed: 2, session_died: 3 } };
    expect(uncheckedKinds(f)).toEqual(['session_died']);
    const acp = callouts({ agents: [], workflows: [], acp: { pi: f }, openFailures: 0, days: 30 }).find((c) => c.id === 'acp:pi');
    expect(acp?.title).toContain('3 times');
    expect(acp?.why).toContain('session died');
    expect(acp?.why).not.toContain('auth failed');
  });
});
