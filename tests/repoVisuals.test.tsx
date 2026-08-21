import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CommitCadence, daysAgoOf } from '../src/components/CommitCadence.js';
import { LanguageBar, langMeta } from '../src/components/LanguageBar.js';

/**
 * The repo-profile visuals (DES-FEEDBACK-001 §3, slice E): language bar off
 * the code graph's per-node lang, commit cadence off the git-history wire's
 * relative dates — honest empty states when the wire has nothing, and the
 * linguist palette as the ONE sanctioned raw-color exemption.
 */

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

afterEach(cleanup);

describe('LanguageBar (§3.3)', () => {
  it('renders proportional linguist-colored segments with a token fallback', () => {
    render(<LanguageBar breakdown={{ typescript: 60, css: 20, javascript: 15, zig: 5 }} />);
    const bar = screen.getByTestId('language-bar');
    expect(bar.getAttribute('data-state')).toBe('ready');
    const segments = [...bar.querySelectorAll('[data-testid="language-segment"]')];
    expect(segments.map((s) => s.getAttribute('data-lang'))).toEqual(['typescript', 'css', 'javascript', 'zig']);
    // linguist hexes for the convention languages (jsdom normalizes to rgb);
    // token fallback for the rest.
    expect(langMeta('typescript').color).toBe('#3178c6');
    expect(segments[0]?.getAttribute('style')).toContain('rgb(49, 120, 198)');
    expect(segments[3]?.getAttribute('style')).toContain('var(--ink-dim)');
    expect(segments[0]?.getAttribute('style')).toContain('60%');
    // Labels carry the display name + rounded percent, and name the unit.
    expect(bar.textContent).toContain('TypeScript 60%');
    expect(bar.textContent).toContain('by files indexed');
  });

  it('renders the honest not-indexed state when the graph is absent or empty', () => {
    for (const breakdown of [null, {}]) {
      const { unmount } = render(<LanguageBar breakdown={breakdown} />);
      const bar = screen.getByTestId('language-bar');
      expect(bar.getAttribute('data-state')).toBe('empty');
      expect(bar.textContent).toContain('not indexed yet');
      expect(bar.querySelectorAll('[data-testid="language-segment"]')).toHaveLength(0);
      unmount();
    }
  });

  it('pins the linguist exemption: every hex literal carries the sanctioned lint comment', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../src/components/LanguageBar.tsx'), 'utf8');
    const lines = source.split('\n');
    const DISABLE = '// eslint-disable-next-line no-restricted-syntax -- linguist palette, convention over token';
    let hexLines = 0;
    lines.forEach((line, i) => {
      if (!/#[0-9a-fA-F]{6}\b/.test(line)) return;
      hexLines += 1;
      expect((lines[i - 1] ?? '').trim(), `hex on line ${i + 1} must carry the design's exact disable comment`).toBe(DISABLE);
    });
    expect(hexLines).toBe(6); // the six linguist entries — and nothing else raw
    // This is the ONLY file in src/ sanctioned to carry the exemption comment.
    expect(source).toContain('linguist palette');
  });
});

describe('daysAgoOf — the git %ar relative-date placement (§3.1 wire honesty)', () => {
  it('places day-or-finer labels at their literal day', () => {
    expect(daysAgoOf('30 seconds ago')).toBe(0);
    expect(daysAgoOf('5 minutes ago')).toBe(0);
    expect(daysAgoOf('3 hours ago')).toBe(0);
    expect(daysAgoOf('26 hours ago')).toBe(1);
    expect(daysAgoOf('1 day ago')).toBe(1);
    expect(daysAgoOf('13 days ago')).toBe(13);
    expect(daysAgoOf('2 weeks ago')).toBe(14); // git's own rounding, verbatim
    expect(daysAgoOf('4 weeks ago')).toBe(28);
  });

  it('refuses to invent a day for coarser or unparseable labels', () => {
    expect(daysAgoOf('2 months ago')).toBeNull();
    expect(daysAgoOf('1 year ago')).toBeNull();
    expect(daysAgoOf('garbage')).toBeNull();
  });

  it('defensively accepts an absolute date, should the wire ever gain one', () => {
    expect(daysAgoOf(new Date(NOW - 3 * DAY).toISOString(), NOW)).toBe(3);
  });
});

describe('CommitCadence (§3.1)', () => {
  const commit = (date: string, i: number) => ({
    sha: `sha-${i}`, shortSha: `s${i}`, message: `m${i}`, author: 'a', date,
  });

  it('buckets in-window commits daily and reports the out-of-window tally', () => {
    render(
      <CommitCadence
        now={NOW}
        commits={['3 hours ago', '2 days ago', '2 days ago', '3 weeks ago', '2 months ago'].map(commit)}
      />,
    );
    const el = screen.getByTestId('commit-cadence');
    expect(el.getAttribute('data-state')).toBe('ready');
    expect(el.getAttribute('data-total')).toBe('4');
    expect(el.getAttribute('data-question')).toBe('Is this repo active or stagnant?');
    const rects = [...el.querySelectorAll('rect')];
    expect(rects).toHaveLength(3); // day 0, day 2 (×2), day 21
    expect(rects.every((r) => r.getAttribute('fill') === 'var(--accent)')).toBe(true);
    expect(el.textContent).toContain('last 5 commits');
    expect(el.textContent).toContain('1 older than 30d');
  });

  it('renders honest states: loading, no commits, nothing in-window', () => {
    const { unmount: u1, container } = render(<CommitCadence commits={null} now={NOW} />);
    expect(container.textContent).toContain('Loading commit history');
    u1();

    const { unmount: u2 } = render(<CommitCadence commits={[]} now={NOW} />);
    expect(screen.getByTestId('commit-cadence').getAttribute('data-state')).toBe('empty');
    expect(screen.getByTestId('commit-cadence').textContent).toContain('No commits yet');
    u2();

    render(<CommitCadence commits={[commit('2 months ago', 0)]} now={NOW} />);
    const el = screen.getByTestId('commit-cadence');
    expect(el.getAttribute('data-state')).toBe('older-only');
    expect(el.querySelectorAll('rect')).toHaveLength(0);
    expect(el.textContent).toContain('Nothing in the last 30 days');
  });
});
