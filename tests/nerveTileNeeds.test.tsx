import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * studio#949: Nerve Center's rail tile folds the Desk's needs-you count (an older crew's "waiting on you"), which
 * settles on its own clock. The tile says whether that count has settled (`data-needs`, the rail's
 * `useSettledNeeds` phase), so a check reads its tone only over a settled count. The attribute never changes the
 * verdict.
 */

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { NerveCenterTile } = await import('../src/components/desk/NerveCenterTile.js');

afterEach(cleanup);

describe('the Nerve Center tile says whether the needs count it folds has settled', () => {
  it('the rail hands it its settled-needs phase: loading while the runs are not known yet', () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" runsKnown={false} />);
    expect(screen.getByTestId('desk-rail-nerve')).toHaveAttribute('data-needs', 'loading');
  });

  it('the phase is only said: the same signals give the same tone and words whatever it is', () => {
    const seen = (['loading', 'complete', 'partial'] as const).map((needs) => {
      render(<NerveCenterTile navigate={() => {}} pathname="/" waitingOnYou={2} needs={needs} />);
      const tile = screen.getByTestId('desk-rail-nerve');
      const out = { needs: tile.getAttribute('data-needs'), tone: tile.getAttribute('data-tone'), label: tile.getAttribute('aria-label') };
      cleanup();
      return out;
    });
    expect(seen.map((s) => s.needs)).toEqual(['loading', 'complete', 'partial']);
    expect(new Set(seen.map((s) => `${s.tone}|${s.label}`)).size).toBe(1);
  });
});
