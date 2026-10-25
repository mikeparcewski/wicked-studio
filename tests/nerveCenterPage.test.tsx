import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RosterSeat } from '../src/api/types.js';
import { useConnectionStore } from '../src/store/connection.js';

/**
 * NERVE CENTER (`/watch`, DES-SYSTEM-VIEW) against a crew WITH the system snapshot (a fixture
 * `GET /system`) and against an older crew without it. Pins the DONE WHEN: the attention strip and
 * four panels render; infra down tops attention with its remedy and turns the tile red; a stalled run
 * says `stalled` (never "Working") and a run at a gate links straight to the gate; a signed-out or
 * benched CLI says why and offers Sign in; every fact the old Health page showed is on the page in
 * both modes; a failed snapshot read is yellow, never green.
 */

const NOW = Date.now();
let caps: Record<string, unknown> = { system: true };
let systemAnswer: () => Promise<unknown>;
const getHealth = vi.fn(() => Promise.resolve({ status: 'ok', version: '0.16.0', ping: 'pong', capabilities: caps }));
const SEATS: RosterSeat[] = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, health: { status: 'active', since: '2026-10-20T00:00:00Z' }, signed_in: true },
  { key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true, health: { status: 'active', since: '2026-10-20T00:00:00Z' }, signed_in: false },
];
const GOVERNANCE = {
  store: { path: '/state/governance.db', source: 'core-db-sidecar' },
  records: { total: 892, sinceBoot: 25 },
  deadletters: { path: '/state/emit-outbox.ndjson', count: 2, byType: { verdict: 2 }, byReason: { 'store-busy': 2 }, timestamped: 2, untimestamped: 0, oldestTs: NOW - 60_000, newestTs: NOW - 30_000, truncated: false, legacyOutbox: null },
  findings: [{ kind: 'governance.deadletters', severity: 'warning', message: 'Two records wait in the outbox.' }],
};
const WEEK = { days: 7, since: NOW - 7 * 86_400_000, until: NOW, runsRead: 4, truncated: false, seats: [] };

const apiFetch = vi.fn((path: string) => {
  if (path === '/system') return systemAnswer();
  if (path === '/diagnostics') return Promise.resolve({ governance: GOVERNANCE });
  return Promise.resolve({});
});

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => getHealth(),
    getRoster: () => Promise.resolve({ roster: SEATS }),
    getSeatRecord: () => Promise.resolve(WEEK),
    upsertConformanceRule: () => Promise.resolve({}),
    listRepos: () => Promise.resolve({ repos: [] }),
  },
  apiFetch: (path: string) => apiFetch(path),
}));
vi.mock('../src/components/agents/AgentModal.js', () => ({
  AgentModal: ({ agentKey }: { agentKey: string }) => <div data-testid="agent-modal" data-agent={agentKey} />,
}));

const { NerveCenterPage } = await import('../src/components/nerve/NerveCenterPage.js');
const { NerveCenterTile } = await import('../src/components/desk/NerveCenterTile.js');
const { resetSystemStore } = await import('../src/store/systemSnapshot.js');
const { gateOpenPath } = await import('../src/board/gateActions.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');

const iso = (ms: number): string => new Date(ms).toISOString();
const stats = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  days: 7, since: NOW - 7 * 86_400_000, asOf: NOW, units: 0, gated: 0, firstPass: 0, passPct: null, medianUnitMs: null,
  rateLimited: 0, benches: 0, fallbacks: 0, perDay: [0, 0, 0, 0, 0, 0, 0], runsRead: 9, truncated: false, ...over,
});
const cli = (over: Record<string, unknown>): Record<string, unknown> => ({
  state: 'signed_in', stateReason: null, canSignIn: true, councilEligible: true, workEligible: true, version: null, versionPin: null,
  governanceClass: null, governanceMode: null, transport: 'acp', sandbox: 'none', lastError: null, stats: stats(), details: { acp: null, seatGovernance: null, health: null }, ...over,
});
const run = (over: Record<string, unknown>): Record<string, unknown> => ({
  status: 'executing', phase: null, unitOrd: null, seat: null, lastEventAt: null, evidence: 'event_log', quietForMs: null,
  quietAfterMs: 600_000, stallAfterMs: 1_200_000, createdAt: iso(NOW - 86_400_000), ...over,
});

/** The settled wire (api-types 0.136.0, WIRE.md): `GET /api/v1/system`. */
const SNAPSHOT = {
  checkedAt: iso(NOW), budgetMs: 4000, tookMs: 812, level: 'red',
  attention: [
    { id: 'infra:gateway', severity: 'red', source: 'infra', title: 'gateway down', reason: 'No answer from the model gateway on :7721.', remedy: 'Start the gateway: wicked-crew gateway start', blocks: 2, target: { kind: 'infra', key: 'gateway' }, action: { kind: 'recheck', label: 'Re-check' } },
    { id: 'run:9b43ee44', severity: 'red', source: 'run', title: 'run 9b43ee44 held at floor 3h', reason: 'The floor failed and no judge is free.', remedy: 'Open the gate and decide.', blocks: 1, target: { kind: 'run', runId: '9b43ee44', gateOrd: 8 }, action: { kind: 'open_gate', label: 'Open the gate' } },
    { id: 'cli:copilot', severity: 'yellow', source: 'cli', title: 'copilot benched (quota)', reason: 'Rate limited by its provider.', remedy: 'Wait for the limit to reset; Codex can judge meanwhile.', blocks: 0, target: { kind: 'cli', cli: 'copilot' }, action: null },
  ],
  clis: [
    cli({ cli: 'claude', label: 'Claude Code', version: '2.1.0', versionPin: { pinned: '2.1.0', observed: '2.1.0', matched: true }, governanceMode: { unscoped: 'admitted' }, sandbox: 'host:sandbox-exec',
      stats: stats({ units: 42, gated: 40, firstPass: 36, passPct: 90, medianUnitMs: 192_000, rateLimited: 0, fallbacks: 1, perDay: [3, 5, 8, 6, 9, 7, 4] }) }),
    cli({ cli: 'copilot', label: 'GitHub Copilot CLI', state: 'benched', stateReason: '429 rate limited since 08:12', benchedUntil: iso(NOW + 3_600_000), canSignIn: false, versionPin: { pinned: '1.0.3', observed: '1.0.2', matched: false },
      stats: stats({ units: 12, gated: 12, firstPass: 9, passPct: 75, medianUnitMs: 300_000, rateLimited: 7, benches: 7, fallbacks: 2, perDay: [1, 2, 2, 3, 2, 2, 0], tokens: { input: 900, output: 300 } }),
      lastError: { at: iso(NOW - 600_000), message: 'HTTP 429 Too Many Requests' } }),
    cli({ cli: 'pi', label: 'Pi', state: 'signed_out', stateReason: 'No credential found for Pi.', stats: null, statsNote: 'This engine has no event-log read binding.' }),
  ],
  runs: [
    run({ runId: 'r-gate', title: 'Settle the CHANGELOG lift', status: 'awaiting_human', liveness: 'waiting_on_you', phase: 'deliver', lastEventAt: iso(NOW - 3_600_000), reason: 'waiting on you: deliver', gate: { interactionId: 'i-1', ord: 8, kind: 'approval', prompt: 'Deliver?' } }),
    run({ runId: 'r-stalled', title: 'Pin the OTel exporter', liveness: 'stalled', phase: 'check', seat: 'codex', lastEventAt: iso(NOW - 2 * 3_600_000), quietForMs: 7_200_000, reason: 'no event for 2 h' }),
    run({ runId: 'r-work', title: 'Add retry to the uploader', liveness: 'working', phase: 'fix', seat: 'claude', lastEventAt: iso(NOW - 30_000), quietForMs: 30_000, reason: 'working' }),
  ],
  infra: [
    { key: 'gateway', label: 'Model gateway', state: 'down', reason: 'Connection refused on :7721.', remedy: 'Start the gateway: wicked-crew gateway start', checkedAt: iso(NOW), durationMs: 3, timeoutMs: 3000, details: { probe: 'GET http://127.0.0.1:7721/healthz -> ECONNREFUSED' } },
    { key: 'broker', label: 'Broker', state: 'unknown', reason: 'The probe did not answer.', remedy: 'Re-check; restart the broker if it stays unknown.', checkedAt: iso(NOW), durationMs: 3000, timeoutMs: 3000, details: {} },
    { key: 'estate', label: 'Estate', state: 'ok', reason: 'answered in 12 ms', remedy: null, checkedAt: iso(NOW), durationMs: 12, details: {} },
    { key: 'interactive', label: 'Interactive', state: 'off', reason: 'No bridge is running; one starts when a document opens.', remedy: null, checkedAt: iso(NOW), durationMs: 0, details: {} },
  ],
  governance: [
    { key: 'judges', label: 'Judges available', state: 'ok', value: 2, reason: 'A distinct judge is free for every waiting gate.', remedy: null },
    { key: 'floor_outcomes', label: 'Floor outcomes (7 days)', state: 'degraded', value: 21, breakdown: { pass: 18, fail: 3 }, reason: 'Floors run in the last 7 days.', remedy: null, since: NOW - 7 * 86_400_000 },
    { key: 'qe_acceptance', label: 'QE pass rate', state: 'ok', value: 86, reason: 'Percent of QE acceptance verdicts that passed.', remedy: null },
    { key: 'gates_answered', label: 'Gates answered', state: 'ok', value: 40, breakdown: { you: 9, judges: 31 }, reason: 'Gates answered in 7 days.', remedy: null },
    { key: 'dead_letters', label: 'Dead letters', state: 'degraded', value: 2, reason: 'Records waiting in the outbox.', remedy: 'Replay them: wicked-crew governance replay' },
    { key: 'steering_rules', label: 'Steering rules loaded', state: 'ok', value: 64, reason: 'Rules the engine loaded.', remedy: null },
  ],
};

beforeEach(() => {
  resetSystemStore();
  clearCachedRoster();
  caps = { system: true };
  systemAnswer = () => Promise.resolve(SNAPSHOT);
  getHealth.mockClear();
  apiFetch.mockClear();
  useConnectionStore.setState({ status: 'connected' });
  window.history.replaceState(null, '', '/watch');
});
afterEach(cleanup);

function renderBoth(navigate = vi.fn()): ReturnType<typeof vi.fn> {
  render(<><NerveCenterTile navigate={navigate} pathname="/watch" waitingOnYou={0} /><NerveCenterPage navigate={navigate} feed={<div data-testid="feed-stub" />} /></>);
  return navigate;
}

describe('against a crew with the system snapshot', () => {
  it('renders the attention strip, all four panels and the feed; infra down tops attention and the tile is red', async () => {
    renderBoth();
    const page = screen.getByTestId('nerve-center-page');
    await waitFor(() => expect(page).toHaveAttribute('data-mode', 'system'));
    for (const id of ['nc-attention', 'nc-panel-clis', 'nc-panel-runs', 'nc-panel-infra', 'nc-panel-governance', 'nc-feed']) {
      expect(within(page).getByTestId(id)).toBeInTheDocument();
    }
    const items = await screen.findAllByTestId('nc-attention-item');
    // Red first (crew's order within a level), then yellow.
    expect(items.map((i) => i.getAttribute('data-id'))).toEqual(['infra:gateway', 'run:9b43ee44', 'cli:copilot']);
    expect(items[0]).toHaveTextContent('gateway down');
    expect(within(items[0]!).getByTestId('nc-attention-remedy')).toHaveTextContent('Start the gateway');
    const tile = screen.getByTestId('desk-rail-nerve');
    expect(tile).toHaveAttribute('data-tone', 'red');
    expect(screen.getByTestId('nerve-center-words')).toHaveTextContent('gateway down');
    expect(tile).toHaveAccessibleName('Nerve Center: gateway down — work is blocked');
    expect(screen.queryByTestId('nc-upgrade-note')).toBeNull();
  });

  it('Infra: down with its remedy and raw probe; a hung probe is unknown with its timeout; Re-check re-reads', async () => {
    renderBoth();
    const rows = await screen.findAllByTestId('nc-infra');
    const gw = rows.find((r) => r.getAttribute('data-key') === 'gateway')!;
    expect(gw).toHaveAttribute('data-state', 'down');
    expect(within(gw).getByTestId('nc-infra-remedy')).toHaveTextContent('Start the gateway');
    expect(within(gw).getByTestId('nc-infra-detail')).toBeInTheDocument();
    const broker = rows.find((r) => r.getAttribute('data-key') === 'broker')!;
    expect(within(broker).getByTestId('nc-infra-state')).toHaveTextContent('unknown — no answer in 3 s');
    const ok = rows.find((r) => r.getAttribute('data-key') === 'estate')!;
    expect(within(ok).queryByTestId('nc-infra-remedy')).toBeNull();
    // `off` is not a problem: said quietly, never in attention.
    expect(within(rows.find((r) => r.getAttribute('data-key') === 'interactive')!).getByTestId('nc-infra-state')).toHaveTextContent('off');
    // The gateway comes back: Re-check reads ok and the tile leaves red.
    const calls = apiFetch.mock.calls.filter(([p]) => p === '/system').length;
    systemAnswer = () => Promise.resolve({ ...SNAPSHOT, level: 'green', attention: [], infra: SNAPSHOT.infra.map((r) => ({ ...r, state: 'ok', remedy: null })) });
    fireEvent.click(within(gw).getByTestId('nc-infra-recheck'));
    await waitFor(() => expect(apiFetch.mock.calls.filter(([p]) => p === '/system').length).toBeGreaterThan(calls));
    await waitFor(() => expect(screen.getAllByTestId('nc-infra').find((r) => r.getAttribute('data-key') === 'gateway')).toHaveAttribute('data-state', 'ok'));
    await waitFor(() => expect(screen.getByTestId('desk-rail-nerve')).toHaveAttribute('data-tone', 'green'));
    expect(screen.queryByTestId('nc-attention')).toBeNull();
  });

  it('Runs: worst first; a stalled run says stalled (never "Working"); a run at a gate links straight to it', async () => {
    const navigate = renderBoth();
    const runs = await screen.findAllByTestId('nc-run');
    // Crew's order, worst first: waiting on you, held, stalled, quiet, working.
    expect(runs.map((r) => r.getAttribute('data-run-id'))).toEqual(['r-gate', 'r-stalled', 'r-work']);
    const stalled = runs[1]!;
    expect(within(stalled).getByTestId('nc-run-liveness')).toHaveTextContent('stalled');
    expect(stalled.textContent).not.toMatch(/working/i);
    expect(within(stalled).getByTestId('nc-run-last')).toHaveTextContent(/last event 2 h/);
    const gate = within(runs[0]!).getByTestId('nc-run-gate');
    expect(gate).toHaveAttribute('href', gateOpenPath('', 'r-gate'));
    fireEvent.click(gate);
    expect(navigate).toHaveBeenCalledWith(gateOpenPath('', 'r-gate'));
    // The attention item's action opens the held run's gate too.
    const held = screen.getAllByTestId('nc-attention-item').find((i) => i.getAttribute('data-id') === 'run:9b43ee44')!;
    fireEvent.click(within(held).getByTestId('nc-attention-action'));
    expect(navigate).toHaveBeenCalledWith(gateOpenPath('', '9b43ee44'));
  });

  it('CLIs: one card each with the week; a signed-out CLI says why and offers Sign in; a rate-limited one says why, no Sign in', async () => {
    renderBoth();
    const cards = await screen.findAllByTestId('nc-cli');
    expect(cards.map((c) => c.getAttribute('data-cli'))).toEqual(['claude', 'copilot', 'pi']);
    const claude = cards[0]!;
    expect(within(claude).getByTestId('nc-cli-units')).toHaveTextContent('42');
    expect(within(claude).getByTestId('nc-cli-pass')).toHaveTextContent('90%');
    expect(within(claude).getByTestId('nc-cli-median')).toHaveTextContent('3.2 min');
    expect(within(claude).getByTestId('nc-cli-429')).toHaveTextContent('0');
    expect(within(claude).getByTestId('nc-cli-fallbacks')).toHaveTextContent('1');
    // Tokens only where the CLI reports them: absent, never 0.
    expect(within(claude).queryByTestId('nc-cli-tokens')).toBeNull();
    expect(within(claude).getByTestId('nc-cli-spark')).toBeInTheDocument();
    expect(within(claude).getByTestId('nc-cli-pin')).toHaveAttribute('data-matched', 'true');
    expect(within(claude).queryByTestId('nc-cli-signin')).toBeNull();
    const copilot = cards[1]!;
    expect(within(copilot).getByTestId('nc-cli-reason')).toHaveTextContent('429 rate limited');
    expect(within(copilot).getByTestId('nc-cli-tokens')).toHaveTextContent('1,200');
    expect(within(copilot).queryByTestId('nc-cli-signin')).toBeNull();
    expect(within(copilot).getByTestId('nc-cli-pin')).toHaveAttribute('data-matched', 'false');
    const pi = cards[2]!;
    expect(within(pi).getByTestId('nc-cli-state')).toHaveTextContent('signed out');
    expect(within(pi).getByTestId('nc-cli-reason')).toHaveTextContent('No credential found');
    // No stats: said why, and every number reads "—", never 0.
    expect(within(pi).getByTestId('nc-cli-statsnote')).toHaveTextContent('no event-log read binding');
    expect(within(pi).getByTestId('nc-cli-units')).toHaveTextContent('—');
    // Sign in opens the one sign-in panel for that CLI (the roster knows it).
    await screen.findAllByTestId('rail-seat-row');
    fireEvent.click(within(pi).getByTestId('nc-cli-signin'));
    expect(screen.getByTestId('agent-modal')).toHaveAttribute('data-agent', 'pi');
  });

  it('Governance: judge availability, floor outcomes, QE pass rate, gates you vs judges, dead letters, steering rules', async () => {
    renderBoth();
    const cards = await screen.findAllByTestId('nc-gov');
    expect(cards.map((c) => c.getAttribute('data-key'))).toEqual(['judges', 'floor_outcomes', 'qe_acceptance', 'gates_answered', 'dead_letters', 'steering_rules']);
    expect(cards[0]).toHaveTextContent('Judges available');
    expect(cards[0]).toHaveTextContent('2');
    expect(within(cards[3]!).getByTestId('nc-gov-breakdown')).toHaveTextContent('you 9 · judges 31');
    expect(cards[4]).toHaveTextContent('Replay them');
    expect(cards[5]).toHaveTextContent('64');
  });

  it('a failed snapshot read is yellow "can\'t reach crew", never green — even after a green one', async () => {
    systemAnswer = () => Promise.resolve({ ...SNAPSHOT, level: 'green', attention: [] });
    renderBoth();
    const tile = screen.getByTestId('desk-rail-nerve');
    await waitFor(() => expect(tile).toHaveAttribute('data-tone', 'green'));
    systemAnswer = () => Promise.reject(new Error('Failed to fetch'));
    fireEvent.click(screen.getByTestId('nc-recheck'));
    await waitFor(() => expect(tile).toHaveAttribute('data-read', 'failed'));
    expect(tile).toHaveAttribute('data-tone', 'yellow');
    expect(screen.getByTestId('nerve-center-words')).toHaveTextContent("can't reach crew");
    expect(screen.getByTestId('nc-verdict')).toHaveAttribute('data-tone', 'yellow');
    expect(screen.getByTestId('nc-headline')).toHaveTextContent("Can't reach crew");
  });
});

/** Every fact the old `/health` page showed, by its testid and words. */
async function expectEveryOldHealthFact(): Promise<void> {
  const page = screen.getByTestId('nerve-center-page');
  // Connection: the socket and the API server (status · version · checked clock).
  const conn = within(page).getByTestId('health-card-connection');
  expect(conn).toHaveTextContent('WebSocket');
  expect(conn).toHaveTextContent('Connected');
  await waitFor(() => expect(within(conn).getByTestId('rail-api-server')).toHaveTextContent('ok · 0.16.0'));
  expect(within(conn).getByTestId('rail-probe-checked')).toBeInTheDocument();
  // Helpers: a row per seat, its standing, and Sign in where it is signed out.
  const seats = within(page).getByTestId('health-card-seats');
  const rows = await within(seats).findAllByTestId('rail-seat-row');
  expect(rows.map((r) => r.getAttribute('data-seat'))).toEqual(['claude', 'pi']);
  expect(within(seats).getByTestId('rail-seat-signin')).toHaveAttribute('data-seat', 'pi');
  // This week: the window caption.
  const week = within(page).getByTestId('health-card-week');
  await waitFor(() => expect(within(week).getByTestId('rail-seat-week-window')).toHaveAttribute('data-state', 'ok'));
  expect(within(week).getByTestId('rail-seat-week-window')).toHaveTextContent('4 runs read');
  // Governance: the store, the records, undelivered evidence and every finding, plus the technical details.
  const gov = within(page).getByTestId('health-card-governance');
  await waitFor(() => expect(within(gov).getByTestId('rail-governance')).toHaveAttribute('data-state', 'warning'));
  expect(gov).toHaveTextContent('Evidence store');
  expect(gov).toHaveTextContent('892 records · 25 since the service started');
  expect(gov).toHaveTextContent('2 waiting to be replayed');
  expect(within(gov).getByTestId('rail-governance-finding')).toHaveTextContent('Two records wait in the outbox.');
  expect(within(gov).getByTestId('rail-governance-detail')).toBeInTheDocument();
}

describe("every fact the old Health page showed is on Nerve Center", () => {
  it('with the system snapshot', async () => {
    renderBoth();
    await waitFor(() => expect(screen.getByTestId('nerve-center-page')).toHaveAttribute('data-mode', 'system'));
    await expectEveryOldHealthFact();
  });

  it('against an older crew (no system capability)', async () => {
    caps = {};
    renderBoth();
    await waitFor(() => expect(screen.getByTestId('nerve-center-page')).toHaveAttribute('data-mode', 'fallback'));
    await expectEveryOldHealthFact();
  });
});

describe('against an older crew (no system capability)', () => {
  it("shows today's Health cards plus the feed with an upgrade note, and never asks for /system", async () => {
    caps = {};
    renderBoth();
    const page = screen.getByTestId('nerve-center-page');
    await waitFor(() => expect(page).toHaveAttribute('data-mode', 'fallback'));
    expect(screen.getByTestId('nc-upgrade-note')).toHaveTextContent('Upgrade crew');
    expect(screen.getByTestId('nc-runs-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('feed-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('nc-cli')).toBeNull();
    expect(screen.queryByTestId('nc-infra')).toBeNull();
    expect(apiFetch.mock.calls.some(([p]) => p === '/system')).toBe(false);
    // The tile still says something true: the governance warning finding is yellow, in words.
    await waitFor(() => expect(screen.getByTestId('desk-rail-nerve')).toHaveAttribute('data-tone', 'yellow'));
    expect(screen.getByTestId('nerve-center-words')).toHaveTextContent('governance warning');
  });

  it('a crew that claims the capability but has no route falls back instead of failing', async () => {
    const { ApiError } = await import('../src/api/errors.js');
    systemAnswer = () => Promise.reject(new ApiError(404, 'Not Found', 'Not Found'));
    renderBoth();
    await waitFor(() => expect(screen.getByTestId('nerve-center-page')).toHaveAttribute('data-mode', 'fallback'));
    expect(screen.getByTestId('nc-upgrade-note')).toBeInTheDocument();
  });
});
