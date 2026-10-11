// studio#724 (0.7.10): System › Work names the shared helper guidance in plain words; the skill's
// identifier is Technical details.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';

const getDiagnostics = vi.fn();
vi.mock('../src/api/diagnostics.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/diagnostics.js')>()),
  getDiagnostics: () => getDiagnostics(),
}));
vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));
const { SystemSettings } = await import('../src/components/SystemSettings.js');

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  getDiagnostics.mockReset();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
});

function defaultLayer(el: HTMLElement): string {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('details').forEach((d) => d.remove());
  return c.textContent ?? '';
}

describe('System › Work in plain words', () => {
  it('no "Discipline skill" and no skill identifier on the default layer', async () => {
    getDiagnostics.mockResolvedValue({ skills: { baseSkill: { name: 'wicked-garden-governed-worker', policy: 'require', present: true, inCatalog: true, gen: 12, engineInput: 'wicked-garden-governed-worker', finding: null } } });
    const { container } = render(<SystemSettings />);
    await waitFor(() => expect(screen.getByTestId('system-base-skill')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('system-base-skill').textContent).not.toMatch(/not reported/));
    expect(defaultLayer(container)).not.toMatch(/discipline/i);
    expect(defaultLayer(container)).not.toContain('wicked-garden-governed-worker');
    expect(screen.getByTestId('system-base-skill').textContent).toContain('wicked-garden-governed-worker');
  });
});
