import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import { useConnectionStore } from '../src/store/connection.js';
import { ROSTER, WEEK } from './fixtures/seatWeek.js';

/**
 * Wave B, idea 9 — the weekly 1:1 per agent on the Health panel's seat rows: each seat's week off
 * `GET /roster/record`, and ONE move whose consequence sits above its button. The route-away move
 * calls the real rule route (`POST /governance/rules` via `api.upsertConformanceRule`); the sign-in
 * move opens the sign-in panel with the seat's own line.
 */

let recordAnswer: () => Promise<unknown> = () => Promise.resolve(WEEK);
const getSeatRecord = vi.fn((days: number) => { void days; return recordAnswer(); });
const upsertConformanceRule = vi.fn((rule: unknown) => { void rule; return Promise.resolve({ status: 'ok' }); });

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.7.0', ping: 'pong' }),
    getRoster: () => Promise.resolve({ roster: ROSTER }),
    getSeatRecord: (days: number) => getSeatRecord(days),
    upsertConformanceRule: (rule: unknown) => upsertConformanceRule(rule),
  },
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/components/Terminal.js', () => ({
  Terminal: ({ initialInput }: { initialInput?: string }) => <pre data-testid="fake-terminal">{initialInput}</pre>,
}));

const { HealthRailSection } = await import('../src/components/HealthRailSection.js');

beforeEach(() => {
  getSeatRecord.mockClear();
  upsertConformanceRule.mockClear();
  recordAnswer = () => Promise.resolve(WEEK);
  useConnectionStore.setState({ status: 'connected' });
});
afterEach(() => cleanup());

const moveOf = async (seat: string): Promise<HTMLElement> => {
  const moves = await screen.findAllByTestId('rail-seat-move');
  return moves.find((m) => m.getAttribute('data-seat') === seat)!;
};

describe('the week rides the expand gesture', () => {
  it('reads GET /roster/record for 7 days on expand, never before', async () => {
    const { rerender } = render(<HealthRailSection open={false} onToggle={() => undefined} />);
    expect(getSeatRecord).not.toHaveBeenCalled();
    rerender(<HealthRailSection open onToggle={() => undefined} />);
    await screen.findAllByTestId('rail-seat-week');
    expect(getSeatRecord).toHaveBeenCalledWith(7);
    expect(screen.getByTestId('rail-seat-week-window')).toHaveTextContent('last 7 days to 2026-09-27 · 9 runs read');
  });
});

describe('each seat gets exactly one move from its own record', () => {
  it('five seats, five weeks, one move each', async () => {
    render(<HealthRailSection open onToggle={() => undefined} />);
    await screen.findAllByTestId('rail-seat-week');
    const kinds = ROSTER.map((s) => {
      const box = screen.getAllByTestId('rail-seat').find((el) => el.getAttribute('data-seat') === s.key)!;
      expect(within(box).getAllByTestId('rail-seat-move')).toHaveLength(1);
      return within(box).getByTestId('rail-seat-move').getAttribute('data-kind');
    });
    expect(kinds).toEqual(['no-change', 'route-away', 'sign-in', 'route-away', 'no-change']);
    // No button on a no-change move.
    expect(within(await moveOf('claude')).queryByTestId('rail-seat-move-button')).toBeNull();
  });

  it('the consequence is shown above the button, before it is taken', async () => {
    render(<HealthRailSection open onToggle={() => undefined} />);
    const codex = await moveOf('codex');
    const consequence = within(codex).getByTestId('rail-seat-move-consequence');
    const button = within(codex).getByTestId('rail-seat-move-button');
    expect(consequence).toHaveTextContent('3 stalls this week.');
    expect(consequence).toHaveTextContent('Adds a recall-only operations rule "Route review work away from Codex"');
    expect(consequence.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button).toHaveTextContent('Route review away from Codex ›');
  });
});

describe('the move calls the real route', () => {
  it('route-away posts the operations rule and says what landed', async () => {
    render(<HealthRailSection open onToggle={() => undefined} />);
    fireEvent.click(within(await moveOf('codex')).getByTestId('rail-seat-move-button'));
    await waitFor(() => expect(upsertConformanceRule).toHaveBeenCalledTimes(1));
    expect(upsertConformanceRule.mock.calls[0]![0]).toMatchObject({
      id: 'seat-coach:codex:review', rule_type: 'policy', steering_type: 'operations',
      statement: 'Route review work away from Codex (codex): 3 stalls in the 7 days to 2026-09-27.',
    });
    const result = await within(await moveOf('codex')).findByTestId('rail-seat-move-result');
    expect(result).toHaveAttribute('data-status', 'done');
    expect(result).toHaveTextContent('Rule seat-coach:codex:review added');
  });

  it('a refused rule says why, in place', async () => {
    upsertConformanceRule.mockImplementationOnce(() => Promise.reject(new ApiError(400, 'rule refused: bad id')));
    render(<HealthRailSection open onToggle={() => undefined} />);
    fireEvent.click(within(await moveOf('opencode')).getByTestId('rail-seat-move-button'));
    const result = await within(await moveOf('opencode')).findByTestId('rail-seat-move-result');
    expect(result).toHaveAttribute('data-status', 'error');
    expect(result).toHaveTextContent('rule refused: bad id');
  });

  it('sign-in opens the plain-words panel with the seat\'s own line (Amendment 5) — never a terminal', async () => {
    render(<HealthRailSection open onToggle={() => undefined} />);
    fireEvent.click(within(await moveOf('pi')).getByTestId('rail-seat-move-button'));
    expect(await screen.findByTestId('signin-line')).toHaveTextContent('pi login');
    expect(screen.getByRole('dialog')).toHaveTextContent('Sign in — Pi');
    expect(screen.getByTestId('signin-check')).toBeInTheDocument();
    expect(screen.queryByTestId('fake-terminal')).toBeNull();
    expect(upsertConformanceRule).not.toHaveBeenCalled();
  });
});

describe('a daemon without the route', () => {
  it('names the absence and offers no moves', async () => {
    recordAnswer = () => Promise.reject(new ApiError(404, 'Not Found', { error: 'Not Found' }));
    render(<HealthRailSection open onToggle={() => undefined} />);
    const cap = await screen.findByTestId('rail-seat-week-window');
    await waitFor(() => expect(cap).toHaveAttribute('data-state', 'absent'));
    expect(cap).toHaveTextContent('not reported by this daemon');
    expect(screen.queryAllByTestId('rail-seat-move')).toHaveLength(0);
    expect(screen.getAllByTestId('rail-seat-row')).toHaveLength(5);
  });
});
