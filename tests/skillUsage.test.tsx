import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { SkillUsagePanel, UsageChip } from '../src/components/SkillUsage.js';
import { filterSkills } from '../src/components/SkillsGrid.js';
import { cliLabel, getSkillUsage, readSkillUsage, usageByName, usageVerdict, usesIn, type SkillUsageResponse, type SkillUsageRow } from '../src/api/skillUsage.js';
import { ApiError } from '../src/api/errors.js';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
import type { SkillRow } from '../src/api/skills.js';

/**
 * Skill usage on the Skills page (`GET /skills/usage`, crew#1432): the row phrase, the "Not used" chip and the drawer's
 * per-helper table. Read-only: nothing here turns a skill off.
 */

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 8, 12);
const HOUR = 3_600_000;
const cell = (d30 = 0, d90 = 0, lastAt: number | null = null, lastGen: number | null = null) => ({ d30, d90, lastAt, lastGen });
const cli = (o: Partial<Record<'opened' | 'ran' | 'directed' | 'browsed', ReturnType<typeof cell>>> = {}, handedLastGen: number | null = 36) => ({
  handedLastGen,
  opened: o.opened ?? cell(),
  ran: o.ran ?? cell(),
  directed: o.directed ?? cell(),
  browsed: o.browsed ?? cell(),
});

const used: SkillUsageRow = {
  name: 'wicked-garden-domain-extractor',
  enabled: true,
  introduced: { gen: 30, seeded: true },
  byCli: { codex: cli({ opened: cell(4, 9, NOW - 2 * HOUR, 36), directed: cell(5, 10, NOW - 2 * HOUR, 36) }), claude: cli({ ran: cell(1, 1, NOW - 30 * HOUR, 35) }) },
  lastUsed: { at: NOW - 2 * HOUR, gen: 36, cli: 'codex' },
  unusedSince: { all: false, byCli: [], notObservable: false },
};
const unused: SkillUsageRow = {
  name: 'wicked-garden-old',
  enabled: true,
  introduced: { gen: 12, seeded: false },
  byCli: { codex: cli({ directed: cell(2, 2, NOW - HOUR, 36), browsed: cell(1, 1, NOW, 36) }) },
  lastUsed: null,
  unusedSince: { all: true, byCli: ['codex'], notObservable: false },
};
const unseen: SkillUsageRow = {
  name: 'wicked-garden-copilot-only',
  enabled: true,
  introduced: null,
  byCli: { copilot: cli() },
  lastUsed: null,
  unusedSince: { all: false, byCli: [], notObservable: true },
};
const response: SkillUsageResponse = {
  currentGen: 36,
  recordingSince: { gen: 36, at: NOW - 24 * HOUR },
  sinceGen: 36,
  sinceGenClamped: false,
  observable: {
    claude: { signals: ['opened', 'browsed', 'ran'], note: null },
    codex: { signals: ['opened', 'browsed', 'ran'], note: null },
    copilot: { signals: [], note: 'not observable' },
  },
  skills: [used, unused, unseen],
  scripts: [],
};

describe('skill usage', () => {
  it('says what each row shows: used, not used since gen N, or not visible', () => {
    expect(usageVerdict(used, 36)).toEqual({ kind: 'used', at: NOW - 2 * HOUR, cli: 'codex' });
    expect(usageVerdict(unused, 36)).toEqual({ kind: 'unused', sinceGen: 36 });
    expect(usageVerdict(unseen, 36)).toEqual({ kind: 'not-observable' });
    expect(usageVerdict(undefined, 36)).toEqual({ kind: 'not-handed' });
    expect(usesIn(used, 'd30')).toBe(5);
    expect(cliLabel('codex-2')).toBe('Codex (2)');
    expect(cliLabel('codex_2')).toBe('Codex (2)');
    expect(cliLabel('codex')).toBe('Codex');
    expect(cliLabel('claude')).toBe('Claude Code');

    render(<UsageChip row={used} sinceGen={36} now={NOW} />);
    expect(screen.getByTestId('skills-usage-chip')).toHaveTextContent('Used 2h ago · Codex');
    cleanup();
    render(<UsageChip row={unused} sinceGen={36} now={NOW} />);
    expect(screen.getByTestId('skills-usage-chip')).toHaveTextContent('Not used since gen 36');
    cleanup();
    render(<UsageChip row={unseen} sinceGen={36} now={NOW} />);
    expect(screen.getByTestId('skills-usage-chip')).toHaveAttribute('data-usage', 'not-observable');
  });

  it('the "Not used" chip keeps only skills handed to a visible helper and never opened or run', () => {
    const row = (name: string): SkillRow => ({ name, dir: name, kind: 'skill', enabled: true, provenance: 'baseline', core: false, portable: true }) as unknown as SkillRow;
    const rows = [row(used.name), row(unused.name), row(unseen.name)];
    const usage = usageByName(response);
    expect(filterSkills(rows, { query: '', chip: 'unused' }, usage).map((r) => r.name)).toEqual([unused.name]);
    // Without usage (an older crew) the chip keeps nothing, so the grid hides it.
    expect(filterSkills(rows, { query: '', chip: 'unused' })).toEqual([]);
  });

  it('the drawer table shows per helper uses in 30 · 90 days and the last time', () => {
    render(<SkillUsagePanel usage={response} name={used.name} now={NOW} />);
    const panel = screen.getByTestId('skills-usage');
    expect(panel).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('skills-usage-summary')).toHaveTextContent('Last used 2h ago by Codex.');
    expect(screen.getByTestId('skills-usage-summary')).toHaveTextContent('Introduced in generation ≤ 30.');
    const codex = screen.getAllByTestId('skills-usage-cli').find((r) => r.getAttribute('data-cli') === 'codex') as HTMLElement;
    expect(within(codex).getByText('4 · 9', { selector: '[data-signal="opened"]' })).toBeInTheDocument();
    expect(within(codex).getByText('5 · 10', { selector: '[data-signal="directed"]' })).toBeInTheDocument();
  });

  it('names an unused skill, a skill whose use cannot be seen, and an older crew', () => {
    render(<SkillUsagePanel usage={response} name={unused.name} now={NOW} />);
    expect(screen.getByTestId('skills-usage-unused')).toHaveTextContent('Handed to Codex, with no opening or script run recorded since generation 36.');
    cleanup();
    render(<SkillUsagePanel usage={response} name={unseen.name} now={NOW} />);
    expect(screen.getByTestId('skills-usage-not-observable')).toBeInTheDocument();
    const copilot = screen.getAllByTestId('skills-usage-cli')[0] as HTMLElement;
    expect(copilot).toHaveTextContent('use not visible');
    expect(copilot).toHaveTextContent('not visible');
    expect(copilot).not.toHaveTextContent('never');
    // A seat key that is an Object property name is just a key.
    expect(cliLabel('constructor')).toBe('constructor');
    cleanup();
    render(<SkillUsagePanel usage={{ unavailable: 'unsupported' }} name={unused.name} now={NOW} />);
    expect(screen.getByTestId('skills-usage')).toHaveAttribute('data-state', 'unsupported');
    expect(screen.getByTestId('skills-usage')).toHaveTextContent('Update wicked-crew');
    cleanup();
    render(<SkillUsagePanel usage={{ unavailable: 'error' }} name={unused.name} now={NOW} />);
    expect(screen.getByTestId('skills-usage')).toHaveTextContent('Refresh to try again');
    cleanup();
    render(<SkillUsagePanel usage={undefined} name={unused.name} now={NOW} />);
    expect(screen.getByTestId('skills-usage')).toHaveAttribute('data-state', 'loading');
  });
});

describe('skill usage on the wire', () => {
  it('a crew without the route is unsupported; any other failure or a body that does not validate is an error', async () => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValueOnce(response);
    expect(await getSkillUsage()).toEqual(response);
    for (const [err, want] of [
      [new ApiError(404, 'Not Found'), 'unsupported'],
      [new ApiError(501, 'Not Implemented'), 'unsupported'],
      [new ApiError(503, 'no skills seam'), 'error'],
      [new ApiError(500, 'boom'), 'error'],
      [new TypeError('Failed to fetch'), 'error'],
    ] as const) {
      apiFetch.mockRejectedValueOnce(err);
      expect(await getSkillUsage()).toEqual({ unavailable: want });
    }
    apiFetch.mockResolvedValueOnce({ skills: {} });
    expect(await getSkillUsage()).toEqual({ unavailable: 'error' });
  });

  it('refuses any row whose rendered fields do not hold', () => {
    expect(readSkillUsage(response)).not.toBeNull();
    const broken = (patch: Record<string, unknown>) => ({ ...response, skills: [{ ...used, ...patch }] });
    expect(readSkillUsage(broken({ unusedSince: null }))).toBeNull();
    expect(readSkillUsage(broken({ byCli: { codex: { opened: { d30: 1 } } } }))).toBeNull();
    expect(readSkillUsage(broken({ lastUsed: { at: 'x', cli: 'codex' } }))).toBeNull();
    expect(readSkillUsage({ ...response, observable: null })).toBeNull();
  });

  it('a phone reads one helper per block, with its uses and last use', () => {
    render(<SkillUsagePanel usage={response} name={used.name} now={NOW} />);
    const codex = screen.getAllByTestId('skills-usage-cli-stack').find((r) => r.getAttribute('data-cli') === 'codex') as HTMLElement;
    expect(codex).toHaveTextContent('Codex · last used 2h ago');
    expect(codex).toHaveTextContent('Opened 4 · 9');
  });
});
