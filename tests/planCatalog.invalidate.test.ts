// X-MIG M11 (codex r7 on studio B): a preset saved through the workflow builder drops the composer's
// preset and preview caches, and an answer requested before the save never lands after it.
import { beforeEach, expect, it, vi } from 'vitest';

const presets = vi.fn();
vi.mock('../src/api/teamPlan.js', () => ({
  teamPlanApi: { presets: (p: string | null) => presets(p), catalog: vi.fn(), previewPlan: vi.fn() },
}));

import { invalidatePresets, loadPresets, resetPlanCatalog, usePlanCatalog } from '../src/store/planCatalog.js';

beforeEach(() => {
  resetPlanCatalog();
  presets.mockReset();
});

it('invalidatePresets drops the loaded scopes, so the next load reads the store again', async () => {
  presets.mockResolvedValueOnce({ presets: [{ name: 'old' }] });
  loadPresets(null);
  await vi.waitFor(() => expect(Array.isArray(usePlanCatalog.getState().presets[''])).toBe(true));
  loadPresets(null);
  expect(presets).toHaveBeenCalledTimes(1); // cached

  invalidatePresets();
  expect(usePlanCatalog.getState().presets).toEqual({});
  presets.mockResolvedValueOnce({ presets: [{ name: 'old' }, { name: 'new' }] });
  loadPresets(null);
  await vi.waitFor(() => expect((usePlanCatalog.getState().presets[''] as { name: string }[]).map((p) => p.name)).toEqual(['old', 'new']));
});

it('a preset list requested before the save never lands after it', async () => {
  let answer!: (v: unknown) => void;
  presets.mockReturnValueOnce(new Promise((r) => { answer = r; }));
  loadPresets(null);
  invalidatePresets();
  answer({ presets: [{ name: 'stale' }] });
  await new Promise((r) => setTimeout(r, 0));
  expect(usePlanCatalog.getState().presets['']).toBeUndefined();
});
