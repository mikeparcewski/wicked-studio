import { describe, expect, it, vi } from 'vitest';

// These suites exercise Desk tabs and project behavior; chart rendering is outside their scope.
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
import { deskTabPath } from '../src/components/desk/DeskV2.js';
import { parseRoute } from '../src/hooks/useRoute.js';

describe('repository addresses hosted on the Desk', () => {
  it.each(['/repos', '/repos/new?project=p1'])('preserves %s in the Repositories tab address', (address) => {
    const url = new URL(address, 'http://studio.local');
    expect(parseRoute(url.pathname).panel).toBe('repos');
    const to = deskTabPath('repositories', url.pathname + url.search);
    expect(to).toBe(`/?tab=repositories&at=${encodeURIComponent(address)}`);
    expect(new URLSearchParams(to.slice(to.indexOf('?'))).get('at')).toBe(address);
  });

  it('keeps repository details as their own page', () => {
    expect(parseRoute('/repo-detail/r1')).toMatchObject({ panel: 'repo-detail', repoId: 'r1' });
  });
});
