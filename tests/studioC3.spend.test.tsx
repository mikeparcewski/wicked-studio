import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { RunRibbon, RunTab } from '../src/components/session/RunTab.js';
import { usePlanCatalog } from '../src/store/planCatalog.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { makeView } from './factories.js';

beforeEach(() => {
  localStorage.clear(); resetRunPanel();
  useGateStore.setState({ gates: {}, approaching: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  usePlanCatalog.setState({ catalog: 'ready', entries: [] });
  useRunEventStore.setState({ byRun: { 'run-1': [] } });
  vi.spyOn(api, 'getRunEvents').mockResolvedValue({ events: [] });
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it.each([[0, /partial.*codex/], [null, /not metered/]] as const)('Spend and ribbon keep metering limits for cost %s', async (cost, words) => {
  const view = makeView();
  Object.assign(view.session, { cost_usd: cost, usage_seats_unmetered: ['codex'] });
  await act(async () => { render(<RunTab runs={[view]} sessionId="run:run-1" title="Fix it" />); });
  const toggle = screen.getAllByTestId('run-panel-toggle').find((t) => t.dataset['section'] === 'agents')!;
  fireEvent.click(toggle);
  expect(screen.getByTestId('run-tab-spend')).toHaveTextContent(words);
  render(<RunRibbon runs={[view]} />);
  expect(screen.getByTestId('run-ribbon-line')).toHaveTextContent(words);
});
