import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import {
  clearCachedWorkflows,
  fetchWorkflowsCached,
  getCachedWorkflows,
  setCachedWorkflows,
} from '../src/store/workflowCache.js';
import type { WorkflowDef } from '../src/api/types.js';

const def = (id: string, isSystem?: boolean): WorkflowDef =>
  ({ id, ...(isSystem === undefined ? {} : { is_system: isSystem }) }) as WorkflowDef;

afterEach(() => {
  clearCachedWorkflows();
  vi.restoreAllMocks();
});

describe('an in-flight fetch never clobbers a deposit that landed while it was on the wire', () => {
  it('the deposit wins (Copilot on #125)', async () => {
    // The app-level fetch may have STARTED first and still answer LAST: the composer and
    // WorkflowViewer fetch this list themselves and deposit it. Letting the older response win
    // silently regresses `is_system` — re-opening the classification hole this module closed.
    let release!: (v: { workflows: WorkflowDef[] }) => void;
    vi.spyOn(api, 'listWorkflows').mockReturnValue(
      new Promise((res) => {
        release = res;
      }) as ReturnType<typeof api.listWorkflows>,
    );

    fetchWorkflowsCached(); // starts, does not resolve

    // A fresher list arrives from a surface that fetched it itself.
    setCachedWorkflows([def('interactive-draft', true)]);
    expect(getCachedWorkflows()).toHaveLength(1);

    // The older in-flight answer now lands.
    release({ workflows: [def('feature'), def('bug')] });
    await new Promise((r) => setTimeout(r, 0));

    const now = getCachedWorkflows();
    expect(now).toHaveLength(1);
    expect(now?.[0]?.id).toBe('interactive-draft');
    expect(now?.[0]?.is_system).toBe(true);
  });

  it('with NO competing deposit, the fetched list is stored as before', async () => {
    vi.spyOn(api, 'listWorkflows').mockResolvedValue({ workflows: [def('feature')] } as never);
    fetchWorkflowsCached();
    await new Promise((r) => setTimeout(r, 0));
    expect(getCachedWorkflows()?.[0]?.id).toBe('feature');
  });
});
