import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SkillsPage } from '../src/components/SkillsPage.js';
import { ApiError } from '../src/api/errors.js';

/**
 * Skill usage through the Skills page (`GET /skills/usage`, crew#1432): usage is telemetry beside the catalog, so a
 * crew without the route, a failed read or a body that does not validate leaves the catalog as it was; the "Not used"
 * cut appears only with usage, and falls back to All when usage goes away; an answer that is not the newest read's
 * is dropped.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const NAME = 'wicked-garden-old';
const entry = { dir: 'skills/old', kind: 'module', core: false, portable: true, enabled: true, provenance: 'shipped', editedAt: null, upgradeAvailable: false, conflict: false, upstreamDir: null };
const catalog = {
  manifest: { version: 2, revision: 1, baseline: 'b'.repeat(16), baselines: {}, skills: { [NAME]: entry }, files: { 'skills/old/SKILL.md': { baselineHash: 'a', effectiveHash: 'a', lastPublishedHash: 'a', conflict: false } }, published: null },
  revision: 1,
  root: '/state/skills',
  current: { gen: 3, path: '/state/skills/snapshots/000003' },
};
const cell = { d30: 0, d90: 0, lastAt: null, lastGen: null };
const usage = (all: boolean) => ({
  currentGen: 3,
  recordingSince: { gen: 3, at: 1 },
  sinceGen: 3,
  sinceGenClamped: false,
  observable: { codex: { signals: ['opened', 'browsed', 'ran'], note: null } },
  skills: [{ name: NAME, enabled: true, introduced: null, byCli: { codex: { handedLastGen: 3, opened: cell, ran: cell, directed: cell, browsed: cell } }, lastUsed: null, unusedSince: { all, byCli: all ? ['codex'] : [], notObservable: false } }],
  scripts: [],
});

function wire(usageAnswer: () => Promise<unknown>): void {
  apiFetch.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if ((init?.method ?? 'GET') !== 'GET') return Promise.reject(new ApiError(404, 'Not Found'));
    if (p === '/skills') return Promise.resolve(catalog);
    if (p === '/skills/usage') return usageAnswer();
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
}

beforeEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe('SkillsPage — skill usage', () => {
  it('shows each row\'s use and the Not used cut when the crew records usage', async () => {
    wire(() => Promise.resolve(usage(true)));
    render(<SkillsPage navigate={() => undefined} />);
    expect(await screen.findByTestId('skills-usage-chip')).toHaveTextContent('Not used since gen 3');
    expect(document.querySelector('[data-testid="skills-filter-chip"][data-chip="unused"]')).not.toBeNull();
  });

  for (const [what, answer] of [
    ['a crew without the route', () => Promise.reject(new ApiError(404, 'Not Found'))],
    ['a failed read', () => Promise.reject(new ApiError(500, 'boom'))],
    ['a body that does not validate', () => Promise.resolve({ skills: {} })],
  ] as const) {
    it(`leaves the catalog as it was on ${what}, with no usage chip and no Not used cut`, async () => {
      wire(answer);
      render(<SkillsPage navigate={() => undefined} />);
      await screen.findAllByTestId('skills-row');
      await waitFor(() => expect(apiFetch.mock.calls.some(([p]) => p === '/skills/usage')).toBe(true));
      expect(screen.queryByTestId('skills-usage-chip')).toBeNull();
      expect(document.querySelector('[data-testid="skills-filter-chip"][data-chip="unused"]')).toBeNull();
      expect(screen.getAllByTestId('skills-row')).toHaveLength(1);
    });
  }

  it('drops an older read that answers after a newer one, and falls back to All when usage goes away', async () => {
    const answers: Array<(v: unknown) => void> = [];
    wire(() => new Promise((resolve) => answers.push(resolve)));
    render(<SkillsPage navigate={() => undefined} />);
    await screen.findAllByTestId('skills-row');
    await waitFor(() => expect(answers.length).toBe(1));
    // A second catalog read starts a second usage read.
    fireEvent.click(screen.getByTestId('skills-reload'));
    await waitFor(() => expect(answers.length).toBe(2));
    answers[1]!(usage(true));
    expect(await screen.findByTestId('skills-usage-chip')).toHaveTextContent('Not used');
    answers[0]!(usage(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('skills-usage-chip')).toHaveTextContent('Not used');
    // Select the cut, then a read fails: the cut falls back to All and every row stays.
    fireEvent.click(document.querySelector('[data-testid="skills-filter-chip"][data-chip="unused"]') as Element);
    wire(() => Promise.reject(new ApiError(500, 'boom')));
    fireEvent.click(screen.getByTestId('skills-reload'));
    await waitFor(() => expect(screen.queryByTestId('skills-usage-chip')).toBeNull());
    expect(screen.getByTestId('skills-filter')).toHaveAttribute('data-filter', 'all');
    expect(screen.getAllByTestId('skills-row')).toHaveLength(1);
  });
});
