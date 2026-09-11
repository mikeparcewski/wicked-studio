import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { ApiError } from '../src/api/errors.js';
import type { DiagnosticsGovernance } from '../src/api/types.js';
import { useConnectionStore } from '../src/store/connection.js';
import {
  GOVERNANCE_DEADLETTERS, GOVERNANCE_HEALTHY, GOVERNANCE_LEGACY_OUTBOX, GOVERNANCE_NO_STORE,
} from './fixtures/wave2.js';

/**
 * studio#246 — the Health rail renders `GET /diagnostics`.governance (crew#495 / F-022,
 * api-types 0.31.0+): the store + which rule chose it, the record counts (an honest
 * "engine cannot count" for null), the dead-letter fold (count, by type / by reason,
 * the timestamp range, truncated, the legacy HOME outbox) and every finding as a
 * severity-styled row carrying the replay recipe. Null-safe: a daemon without the
 * block (or without the route) says "not reported"; a null store is never "Governed"
 * — it turns the heart red, as does an error finding; a warning finding degrades.
 */

let diagnosticsAnswer: () => Promise<unknown> = () => Promise.resolve({});
const apiFetch = vi.fn((path: string) => (path === '/diagnostics' ? diagnosticsAnswer() : Promise.reject(new Error(`unexpected ${path}`))));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.7.0', ping: 'pong' }),
    getRoster: () => Promise.resolve({ roster: [] }),
    listRepos: () => Promise.resolve({ repos: [] }),
  },
  apiFetch: (path: string) => apiFetch(path),
}));

const { HealthRailSection } = await import('../src/components/HealthRailSection.js');

function Harness(): React.ReactElement {
  const [open, setOpen] = useState(true);
  return <HealthRailSection open={open} onToggle={() => setOpen((v) => !v)} />;
}

function withGovernance(g: DiagnosticsGovernance): void {
  diagnosticsAnswer = () => Promise.resolve({ components: {}, daemon: {}, stores: [], recentErrors: [], acp: { byCli: {} }, governance: g });
}

beforeEach(() => {
  apiFetch.mockClear();
  useConnectionStore.setState({ status: 'connected' });
});
afterEach(() => cleanup());

describe('the fetch rides the expand gesture (EC30)', () => {
  it('fires ONE GET /diagnostics on expand, none before', async () => {
    withGovernance(GOVERNANCE_HEALTHY);
    const { rerender } = render(<HealthRailSection open={false} onToggle={() => undefined} />);
    expect(apiFetch).not.toHaveBeenCalled();
    rerender(<HealthRailSection open onToggle={() => undefined} />);
    await screen.findByTestId('rail-governance');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/diagnostics');
  });
});

describe('only the CURRENT expand\'s answer lands', () => {
  it('a slow read from an earlier expand cannot overwrite a later expand\'s governance block', async () => {
    let releaseFirst: (v: unknown) => void = () => undefined;
    let releaseSecond: (v: unknown) => void = () => undefined;
    const answers = [
      new Promise((resolve) => { releaseFirst = resolve; }),
      new Promise((resolve) => { releaseSecond = resolve; }),
    ];
    diagnosticsAnswer = () => answers.shift()!;
    const { rerender } = render(<HealthRailSection open onToggle={() => undefined} />);
    rerender(<HealthRailSection open={false} onToggle={() => undefined} />);
    rerender(<HealthRailSection open onToggle={() => undefined} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    releaseSecond({ governance: GOVERNANCE_HEALTHY });
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'ok');
    releaseFirst({ governance: GOVERNANCE_DEADLETTERS }); // the stale first read lands late
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId('rail-governance')).toHaveAttribute('data-state', 'ok');
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'healthy');
  });
});

describe('the healthy store', () => {
  it('names the store path + source, the record counts, zero dead letters, no findings; heart stays green', async () => {
    withGovernance(GOVERNANCE_HEALTHY);
    render(<Harness />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'ok');
    expect(gov).toHaveAttribute('data-store', 'core-db-sidecar');
    expect(gov).toHaveAttribute('data-deadletters', '0');
    expect(gov.textContent).toContain('via core-db-sidecar');
    expect(within(gov).getByTestId('rail-governance-store-path').textContent).toContain('/w2/state/core.db.governance/governance.db');
    expect(gov.textContent).toContain('412 records · 37 since boot');
    // The outbox is part of the account even when it is empty — the operator can see where
    // a dead letter WOULD land.
    expect(within(gov).getByTestId('rail-governance-outbox').textContent).toContain('/w2/state/core.db.governance/emit-outbox.ndjson');
    expect(within(gov).queryByTestId('rail-governance-by-type')).toBeNull();
    expect(within(gov).queryByTestId('rail-governance-finding')).toBeNull();
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'healthy');
    expect(screen.queryByTestId('rail-health-summary-dot')).toBeNull();
  });
});

describe('the F-022 signal — dead letters', () => {
  it('renders the count as a floor, the by-type / by-reason tallies, the range, the outbox, and the error finding with its replay recipe', async () => {
    withGovernance(GOVERNANCE_DEADLETTERS);
    render(<Harness />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'error');
    expect(gov).toHaveAttribute('data-deadletters', '128');
    expect(gov.textContent).toContain('128+');
    expect(within(gov).getByTestId('rail-governance-by-type').textContent).toContain('wicked.crew.governance.conformance_recorded ×96');
    expect(within(gov).getByTestId('rail-governance-by-reason').textContent).toContain('no shared store (WICKED_ESTATE_DB unset) ×128');
    const when = within(gov).getByTestId('rail-governance-range').textContent ?? '';
    expect(when).toContain('2026-09-10 16:00:00Z → 2026-09-10 18:00:00Z');
    expect(when).toContain('8 untimestamped');
    expect(when).toContain('count is a floor');
    expect(within(gov).getByTestId('rail-governance-outbox').textContent).toContain('/w2/state/core.db.governance/emit-outbox.ndjson');
    const finding = within(gov).getByTestId('rail-governance-finding');
    expect(finding).toHaveAttribute('data-kind', 'governance.deadletter');
    expect(finding).toHaveAttribute('data-severity', 'error');
    expect(finding.textContent).toContain('wicked-crew governance replay /w2/state/core.db.governance/emit-outbox.ndjson --governance-db');
    // An error finding is a health failure: red heart + the collapsed-header dot.
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'unhealthy');
    expect(screen.getByTestId('rail-health-summary-dot')).toBeInTheDocument();
  });
});

describe('a boot that resolved NO store', () => {
  it('is never shown as governed: the store row fails, records read "engine cannot count", the governance.store error renders, heart red', async () => {
    withGovernance(GOVERNANCE_NO_STORE);
    render(<Harness />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'error');
    expect(gov).toHaveAttribute('data-store', 'none');
    expect(gov.textContent).toContain('none resolved — emits dead-letter');
    expect(gov.textContent).toContain('engine cannot count');
    expect(gov.textContent).not.toMatch(/\b0 records\b/);
    expect(within(gov).getByTestId('rail-governance-finding')).toHaveAttribute('data-kind', 'governance.store');
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'unhealthy');
  });
});

describe('the pre-fix HOME outbox', () => {
  it('renders the legacy outbox path + bytes and the warning finding; heart degrades to amber, no fail dot', async () => {
    withGovernance(GOVERNANCE_LEGACY_OUTBOX);
    render(<Harness />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'warning');
    expect(within(gov).getByTestId('rail-governance-legacy').textContent).toContain('/w2/home/.something-wicked/wicked-apps/emit-outbox.ndjson · 48213 bytes');
    const finding = within(gov).getByTestId('rail-governance-finding');
    expect(finding).toHaveAttribute('data-kind', 'governance.legacy-outbox');
    expect(finding).toHaveAttribute('data-severity', 'warning');
    // `sinceBoot: null` beside a counted total reads as the total alone — never an invented 0.
    expect(gov.textContent).toContain('12 records');
    expect(gov.textContent).not.toContain('since boot');
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'degraded');
    expect(screen.queryByTestId('rail-health-summary-dot')).toBeNull();
  });
});

describe('older daemons — null-safe by construction', () => {
  it('a /diagnostics WITHOUT a governance block says "not reported" and does not degrade', async () => {
    diagnosticsAnswer = () => Promise.resolve({ components: {}, daemon: {}, stores: [], recentErrors: [], acp: { byCli: {} } });
    render(<Harness />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'absent');
    expect(gov).toHaveAttribute('data-why', 'no-block');
    expect(gov.textContent).toContain('not reported by this daemon');
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'healthy');
  });

  it('a daemon with NO /diagnostics route (unknown-route 404) says so too', async () => {
    diagnosticsAnswer = () => Promise.reject(new ApiError(404, 'not found'));
    render(<Harness />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-why', 'no-route');
    expect(gov.textContent).toContain('no /diagnostics route');
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'healthy');
  });

  it('a diagnostics read that FAILS (5xx) renders the unreachable row and degrades — never a guessed store', async () => {
    diagnosticsAnswer = () => Promise.reject(new ApiError(500, 'boom'));
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'degraded'));
    expect(screen.queryByTestId('rail-governance')).toBeNull();
    expect(screen.getByText('governance').parentElement?.textContent).toContain('unreachable');
  });
});
