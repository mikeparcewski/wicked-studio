import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RunDelivery } from '../src/components/RunDelivery.js';
import { StrandedCard } from '../src/components/session/StrandedCard.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { makeView } from './factories.js';

afterEach(() => { cleanup(); usePostHocDeliverStore.setState({ byRun: {} }); });
it('masks delivery errors on both stranded surfaces and keeps the stored error verbatim', () => {
  const error = 'lift failed at /home/reel-operator/repo';
  const view = makeView({ id: 'delivery-c3', status: 'completed', workdir: '/tmp/worktree', delivery: 'stranded' } as never);
  usePostHocDeliverStore.setState({ byRun: { 'delivery-c3': { phase: 'error', error } } });
  render(<><RunDelivery view={view} /><StrandedCard view={view} /></>);
  for (const id of ['run-deliver-error', 'session-stranded-error']) {
    expect.soft(screen.getByTestId(id).textContent).toContain('lift failed at ~/repo');
    expect.soft(screen.getByTestId(id).textContent).not.toContain('reel-operator');
  }
  expect(usePostHocDeliverStore.getState().byRun['delivery-c3']).toEqual({ phase: 'error', error });
});
