import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import type { DiagnosticsGovernance } from '../src/api/types.js';
import { useConnectionStore } from '../src/store/connection.js';
import {
  GOVERNANCE_DEADLETTERS, GOVERNANCE_HEALTHY, GOVERNANCE_LEGACY_OUTBOX, GOVERNANCE_NO_STORE,
} from './fixtures/wave2.js';

/**
 * studio#246 — the Health registry renders `GET /diagnostics`.governance (crew#495 / F-022,
 * api-types 0.31.0+): the store + which rule chose it, the record counts (an honest
 * "engine cannot count" for null), the dead-letter fold (count, by type / by reason,
 * the timestamp range, truncated, the legacy HOME outbox) and every finding as a
 * severity-styled row carrying the replay recipe. Null-safe: a daemon without the
 * block (or without the route) reads one plain-words sentence ("Not available from
 * this version of crew. Upgrade crew to see it."); a null store is never "Governed".
 *
 * Mounted through `/health` (studio#421): the same `GovernanceRows` the retired rail-foot
 * flyout held, now one card on the page. The registry heart/dot verdicts that rode these rows
 * live on the rail link (`useRailHealthDot`), pinned in railPolish.test.
 */

let diagnosticsAnswer: () => Promise<unknown> = () => Promise.resolve({});
const apiFetch = vi.fn((path: string) => (path === '/diagnostics' ? diagnosticsAnswer() : Promise.reject(new Error(`unexpected ${path}`))));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.7.0', ping: 'pong' }),
    getRoster: () => Promise.resolve({ roster: [] }),
    getSeatRecord: () => Promise.resolve({ days: 7, since: 0, until: 0, runsRead: 0, truncated: false, seats: [] }),
    upsertConformanceRule: () => Promise.resolve({}),
    listRepos: () => Promise.resolve({ repos: [] }),
  },
  apiFetch: (path: string) => apiFetch(path),
}));

// The old /health page's cards now live in Nerve Center's panels (DES-SYSTEM-VIEW); these suites pin them there.
const { NerveCenterPage: HealthPage } = await import('../src/components/nerve/NerveCenterPage.js');
const { resetSystemStore } = await import('../src/store/systemSnapshot.js');

function withGovernance(g: DiagnosticsGovernance): void {
  diagnosticsAnswer = () => Promise.resolve({ components: {}, daemon: {}, stores: [], recentErrors: [], acp: { byCli: {} }, governance: g });
}

beforeEach(() => {
  resetSystemStore();
  apiFetch.mockClear();
  useConnectionStore.setState({ status: 'connected' });
});
afterEach(() => cleanup());

describe('the healthy store', () => {
  it('names the store path + source, the record counts, zero dead letters, no findings', async () => {
    withGovernance(GOVERNANCE_HEALTHY);
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'ok');
    expect(gov).toHaveAttribute('data-store', 'core-db-sidecar');
    expect(gov).toHaveAttribute('data-deadletters', '0');
    expect(gov.textContent).toContain('via core-db-sidecar');
    expect(within(gov).getByTestId('rail-governance-detail').textContent).toContain('/w2/state/core.db.governance/governance.db');
    expect(gov.textContent).toContain('412 records · 37 since the service started');
    // The outbox is part of the account even when it is empty (behind Technical details).
    expect(within(gov).getByTestId('rail-governance-detail').textContent).toContain('outbox: /w2/state/core.db.governance/emit-outbox.ndjson');
    expect(within(gov).getByTestId('rail-governance-detail').textContent).not.toContain('by type');
    expect(within(gov).queryByTestId('rail-governance-finding')).toBeNull();
  });
});

describe('the F-022 signal — dead letters', () => {
  it('renders the count as a floor, the by-type / by-reason tallies, the range, the outbox, and the error finding with its replay recipe', async () => {
    withGovernance(GOVERNANCE_DEADLETTERS);
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'error');
    expect(gov).toHaveAttribute('data-deadletters', '128');
    expect(gov.textContent).toContain('128+');
    expect(within(gov).getByTestId('rail-governance-detail').textContent).toContain('wicked.crew.governance.conformance_recorded ×96');
    expect(within(gov).getByTestId('rail-governance-detail').textContent).toContain('no shared store (WICKED_ESTATE_DB unset) ×128');
    const when = within(gov).getByTestId('rail-governance-detail').textContent ?? '';
    expect(when).toContain('2026-09-10 16:00:00Z → 2026-09-10 18:00:00Z');
    expect(when).toContain('8 untimestamped');
    expect(when).toContain('count is a floor');
    expect(within(gov).getByTestId('rail-governance-detail').textContent).toContain('/w2/state/core.db.governance/emit-outbox.ndjson');
    const finding = within(gov).getByTestId('rail-governance-finding');
    expect(finding).toHaveAttribute('data-kind', 'governance.deadletter');
    expect(finding).toHaveAttribute('data-severity', 'error');
    expect(within(gov).getByTestId('rail-governance-detail').textContent).toContain('wicked-crew governance replay /w2/state/core.db.governance/emit-outbox.ndjson --governance-db');
    expect(finding.textContent).toMatch(/^Problem: /);
  });
});

describe('a boot that resolved NO store', () => {
  it('is never shown as governed: the store row fails, records read "engine cannot count", the governance.store error renders', async () => {
    withGovernance(GOVERNANCE_NO_STORE);
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'error');
    expect(gov).toHaveAttribute('data-store', 'none');
    expect(gov.textContent).toContain('none resolved — emits dead-letter');
    expect(gov.textContent).toContain('engine cannot count');
    expect(gov.textContent).not.toMatch(/\b0 records\b/);
    expect(within(gov).getByTestId('rail-governance-finding')).toHaveAttribute('data-kind', 'governance.store');
  });
});

describe('records — the two counts state themselves independently', () => {
  it('an uncountable total beside a counted sinceBoot shows both facts', async () => {
    withGovernance({ ...GOVERNANCE_HEALTHY, records: { total: null, sinceBoot: 5 } });
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov.textContent).toContain('not counted · 5 since the service started');
    expect(within(gov).getByTestId('rail-governance-detail').textContent).toContain('records total: engine cannot count');
  });
});

describe('the pre-fix HOME outbox', () => {
  it('renders the legacy outbox path + bytes and the warning finding', async () => {
    withGovernance(GOVERNANCE_LEGACY_OUTBOX);
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'warning');
    expect(within(gov).getByTestId('rail-governance-legacy').textContent).toContain('(47 KB)');
    expect(within(gov).getByTestId('rail-governance-detail').textContent).toContain('/w2/home/.something-wicked/wicked-apps/emit-outbox.ndjson · 48213 bytes');
    // The legacy-outbox finding is said once: the plain line above; its raw text is in the details.
    expect(within(gov).queryByTestId('rail-governance-finding')).toBeNull();
    expect(within(gov).getByTestId('rail-governance-detail').textContent).toContain('governance.legacy-outbox');
    // `sinceBoot: null` beside a counted total reads as the total alone — never an invented 0.
    expect(gov.textContent).toContain('12 records');
    expect(gov.textContent).not.toContain('since the service started');
  });
});

describe('studio#651: finding text', () => {
  it('a finding that quotes home paths mid-sentence reads ~/…, like the rows above it', async () => {
    withGovernance({
      ...GOVERNANCE_LEGACY_OUTBOX,
      findings: [{ ...GOVERNANCE_LEGACY_OUTBOX.findings[0]!, message: 'a pre-fix dead-letter outbox exists at /Users/reel-operator/.something-wicked/wicked-apps/emit-outbox.ndjson (its state home is /Users/reel-operator/Projects/wicked/.wicked-crew)' }],
    });
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    expect(within(gov).getByTestId('rail-governance-legacy')).toHaveTextContent('An older holding file');
    const detail = within(gov).getByTestId('rail-governance-detail');
    expect(detail).toHaveTextContent('exists at ~/.something-wicked/wicked-apps/emit-outbox.ndjson (its state home is ~/Projects/wicked/.wicked-crew)');
    expect(gov.textContent).not.toContain('reel-operator');
  });

  it('the dead-letter "by reason" tally reads ~/… too (codex r1)', async () => {
    withGovernance({
      ...GOVERNANCE_DEADLETTERS,
      deadletters: { ...GOVERNANCE_DEADLETTERS.deadletters!, byReason: { 'EACCES: permission denied, open /Users/reel-operator/.wicked-crew/governance.db': 3 } },
    });
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    const line = within(gov).getByTestId('rail-governance-detail');
    expect(line).toHaveTextContent('open ~/.wicked-crew/governance.db');
    expect(gov.textContent).not.toContain('reel-operator');
  });
});

describe('older daemons — null-safe by construction', () => {
  it('a /diagnostics WITHOUT a governance block says the plain-words sentence and does not degrade', async () => {
    diagnosticsAnswer = () => Promise.resolve({ components: {}, daemon: {}, stores: [], recentErrors: [], acp: { byCli: {} } });
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'absent');
    expect(gov).toHaveAttribute('data-why', 'no-block');
    expect(gov.textContent).toContain('Not available yet');
    expect(screen.getByTestId('health-upgrade-note')).toHaveTextContent('governance');
  });

  it('a daemon with NO /diagnostics route (unknown-route 404) says the same plain words — the route name stays off the page', async () => {
    diagnosticsAnswer = () => Promise.reject(new ApiError(404, 'not found'));
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-why', 'no-route');
    expect(gov.textContent).toContain('Not available yet');
    expect(screen.getByTestId('health-upgrade-note')).toHaveTextContent('governance');
    expect(gov.textContent).not.toContain('/diagnostics');
  });

  it('a diagnostics read that FAILS (5xx) renders the unreachable row WITH its reason — never a guessed store', async () => {
    diagnosticsAnswer = () => Promise.reject(new ApiError(500, 'governance fold crashed: ENOSPC'));
    render(<HealthPage search="?tab=governance" />);
    const gov = await screen.findByTestId('rail-governance');
    expect(gov).toHaveAttribute('data-state', 'error');
    expect(gov.textContent).toContain("couldn't be read");
    // The daemon's own sentence is behind Technical details — not dropped.
    expect(within(gov).getByTestId('rail-governance-error').textContent).toContain('governance fold crashed: ENOSPC');
  });
});

describe('no paths or raw log lines in the default layer (reel UX gate ch56)', () => {
  it('a finding keeps its words through "(s)" — only a spaced aside or a path ends the plain line', async () => {
    withGovernance(GOVERNANCE_DEADLETTERS);
    render(<HealthPage search="?tab=governance" />);
    const finding = await screen.findByTestId('rail-governance-finding');
    expect(finding.textContent).toMatch(/^Problem: \d+ governance event\(s\) dead-lettered/);
  });

  /** The card's words with every Technical details disclosure removed. */
  function visibleText(el: HTMLElement): string {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll('details').forEach((d) => d.remove());
    return c.textContent ?? '';
  }
  for (const [name, g] of [['healthy', GOVERNANCE_HEALTHY], ['dead letters', GOVERNANCE_DEADLETTERS], ['legacy outbox', GOVERNANCE_LEGACY_OUTBOX], ['no store', GOVERNANCE_NO_STORE]] as const) {
    it(`${name}: plain words; paths and the raw finding line only behind Technical details`, async () => {
      withGovernance(g);
      render(<HealthPage search="?tab=governance" />);
      const gov = await screen.findByTestId('rail-governance');
      // One closed disclosure holds the internals; nothing raw is open by default.
      expect(gov.querySelectorAll('details')).toHaveLength(1);
      expect(gov.querySelectorAll('details[open]')).toHaveLength(0);
      const text = visibleText(gov);
      expect(text).not.toMatch(/\/[\w.-]+\/[\w./-]+/);
      expect(text).not.toMatch(/governance\.[a-z-]+/);
      expect(text).not.toMatch(/\b(info|warning|error) · /);
      expect(text).not.toMatch(/ndjson|\.db\b/);
    });
  }
});
