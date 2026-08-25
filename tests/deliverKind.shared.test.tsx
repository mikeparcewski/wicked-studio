import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * The structural guard (wicked-studio#122 D-1): **the composer and the delivery
 * surfaces classify a run through the SAME function.**
 *
 * They did not. #124's `deliverKindOf` lived inside `ChatInput` as a
 * `useCallback` and read `is_system`; #122's `canDeliver` called `runKindOf`
 * and read a five-id denylist. Nothing pinned them together, so they drifted:
 * `collab` and every `interactive-*` were 'system' to the composer and 'build'
 * to the rail, and studio told operators to launch a delivery the composer
 * would have refused.
 *
 * The guard is a WRAPPED module export, not an assertion about source text: the
 * real `runMode.deliverKindOf` is replaced by a spy that still does the real
 * work, and BOTH call sites are then observed going through it. A future edit
 * that re-forks either side — a local copy of the rule in `ChatInput`, a
 * `runKindOf` call back in `canDeliver` — drops that side's count to zero and
 * fails here.
 */
vi.mock('../src/components/runMode.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/runMode.js')>();
  return { ...actual, deliverKindOf: vi.fn(actual.deliverKindOf) };
});

import { api } from '../src/api/client.js';
import { ChatInput } from '../src/components/ChatInput.js';
import { canDeliver, deliverySummary } from '../src/components/delivery.js';
import { deliverKindOf } from '../src/components/runMode.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';
import { clearCachedWorkflows, isSystemWorkflowIn } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { LIVE_WORKFLOWS } from './fixtures/workflows.js';

const spy = vi.mocked(deliverKindOf);

beforeEach(() => {
  vi.restoreAllMocks();
  clearCachedWorkflows();
  clearRetryPrefill();
  vi.spyOn(api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(api, 'listWorkflows').mockResolvedValue({ workflows: LIVE_WORKFLOWS });
  vi.spyOn(api, 'listProjects').mockResolvedValue({ projects: [] });
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  spy.mockClear();
});
afterEach(cleanup);

const view = (workflow_id: string) => {
  const v = makeView({ id: 'run-1' }, [makeUnit({ id: 'run-1:build', status: 'done' })]);
  return { ...v, session: { ...v.session, workflow_id } as typeof v.session };
};

describe('one predicate, both slices', () => {
  it('the COMPOSER classifies through runMode.deliverKindOf', async () => {
    render(<ChatInput onLaunched={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('launch-problem')).toBeInTheDocument());

    expect(spy, 'ChatInput no longer calls the shared predicate').toHaveBeenCalled();
    // Second argument is the LOOKUP — the composer supplies `is_system`, it does
    // not re-implement the rule.
    expect(spy.mock.calls.every(([, lookup]) => typeof lookup === 'function')).toBe(true);
  });

  it('the DELIVERY SURFACES classify through runMode.deliverKindOf', () => {
    canDeliver(view('interactive-draft'));
    expect(spy, 'canDeliver no longer calls the shared predicate').toHaveBeenCalledWith(
      'interactive-draft', undefined,
    );

    spy.mockClear();
    const lookup = (id: string): boolean | undefined => isSystemWorkflowIn(LIVE_WORKFLOWS, id);
    deliverySummary([view('feature')], lookup);
    expect(spy).toHaveBeenCalledWith('feature', lookup);
  });

  it('and they agree over the whole live workflow table', () => {
    // The behavioural half of the same claim: whatever the shared predicate
    // says, `canDeliver` says — no id where one is 'build' and the other isn't.
    const lookup = (id: string): boolean | undefined => isSystemWorkflowIn(LIVE_WORKFLOWS, id);
    for (const w of LIVE_WORKFLOWS) {
      expect(canDeliver(view(w.id), lookup)).toBe(deliverKindOf(w.id, lookup) === 'build');
    }
  });
});
