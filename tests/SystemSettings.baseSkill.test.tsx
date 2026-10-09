// studio#275: System's "Discipline skill" row, off `GET /diagnostics.skills.baseSkill` (crew#554).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';
import type { BaseSkillPosture } from '../src/api/types.js';

const getDiagnostics = vi.fn();
vi.mock('../src/api/diagnostics.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/diagnostics.js')>()),
  getDiagnostics: () => getDiagnostics(),
}));
vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

const { SystemSettings } = await import('../src/components/SystemSettings.js');

const POSTURE: BaseSkillPosture = {
  name: 'wicked-garden-governed-worker', policy: 'require', present: true, inCatalog: true,
  gen: 12, engineInput: 'wicked-garden-governed-worker', finding: null,
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  getDiagnostics.mockReset();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
});

describe('System — discipline skill row', () => {
  it('names the skill and the generation it is handed from', async () => {
    getDiagnostics.mockResolvedValue({ skills: { baseSkill: POSTURE } });
    render(<SystemSettings />);
    await waitFor(() => expect(screen.getByTestId('system-base-skill')).toHaveTextContent('discipline skill: wicked-garden-governed-worker gen 12'));
    expect(screen.getByTestId('system-base-skill').dataset.present).toBe('true');
    expect(screen.queryByTestId('system-base-skill-fix')).toBeNull();
  });

  it('a missing skill says what it does and the fix', async () => {
    getDiagnostics.mockResolvedValue({ skills: { baseSkill: { ...POSTURE, present: false, policy: 'warn', inCatalog: true } } });
    render(<SystemSettings />);
    await waitFor(() => expect(screen.getByTestId('system-base-skill')).toHaveTextContent('MISSING — runs proceed without it'));
    expect(screen.getByTestId('system-base-skill-fix')).toHaveTextContent('the next skills publish hands it');
  });

  it('setting off reads off; no skills block or no diagnostics reads "not reported"', async () => {
    getDiagnostics.mockResolvedValue({ skills: { baseSkill: null } });
    render(<SystemSettings />);
    await waitFor(() => expect(screen.getByTestId('system-base-skill')).toHaveTextContent('discipline skill: off'));
    cleanup();
    getDiagnostics.mockRejectedValue(new Error('no route'));
    render(<SystemSettings />);
    await waitFor(() => expect(getDiagnostics).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('system-base-skill')).toHaveTextContent('not reported by this daemon');
  });
});
