import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HandoffCard, IntakeCard, PowerPauseCard, PowerThread, RigorHistory } from '../src/components/session/PowerMode.js';
import { InflightCheck } from '../src/components/session/InflightCheck.js';
import { change, plan as makePlan, state } from './powerFixtures.js';
import type { UnitInspection } from '../src/api/inspect.js';
import { api } from '../src/api/client.js';
import { makeView } from './factories.js';

const path = (field: string): string => `/home/reel-operator/${field}`;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('masks power activity, hand-off text, plan notes and in-flight inspection prose', async () => {
  const plan = makePlan({ reasons: [path('reason')], mandatoryPhases: [{ phase: 'build', why: path('mandatory') }], risks: [path('risk')], scenarios: [path('scenario')], floors: [{ rigor: 'standard', by: 'policy', why: path('floor') }] });
  const power = state({ plan, history: [change(2, 1, 'commit', 'standard', 'high', 20, 50, 1, [path('history-note')])], pause: { at: 1, checkpoint: 1, reasons: [path('pause-note')], recommended: 'continue_high' } });
  const inspection: UnitInspection = { id: 'inspect-c3', runId: 'inflight-c3', ord: 0, attempt: 0, state: 'done', requestedAt: 1, finishedAt: 2, workerSeat: null, seat: 'claude', checkRunId: null, source: 'seat', why: null, verdict: 'progressing', doing: path('doing'), progress: path('progress'), evidence: [path('evidence')], action: 'let_run', note: null, cost: null };
  vi.spyOn(api, 'getInspections').mockResolvedValue({ inspections: [inspection] });
  const { container } = render(<>
    <PowerThread view={makeView()} power={power} part="rest" items={[{ kind: 'acts', key: 'a', at: 1, rows: [{ kind: 'test', at: 1, lead: 'Tests passed', code: path('code'), tail: path('tail'), added: null, removed: null, sha: null, tone: 'pass' }] }]} />
    <HandoffCard round={1} rigor="standard" steps={[{ step: 'review', ord: 1, status: 'failed', seat: 'claude', summary: path('handoff'), at: 1 }]} />
    <IntakeCard runId="plan-c3" plan={plan} rigor="standard" at={1} live={false} />
    <RigorHistory power={power} />
    <PowerPauseCard view={makeView()} power={power} />
    <InflightCheck runId="inflight-c3" ord={0} attempt={0} kind="step" startedAt={0} now={900_000} seatName="Claude" seatKey="claude" label="the job" />
  </>);
  await screen.findByTestId('inflight-check-doing');
  for (const field of ['code', 'tail', 'handoff', 'reason', 'mandatory', 'risk', 'scenario', 'floor', 'history-note', 'pause-note', 'doing', 'progress', 'evidence']) expect.soft(container.textContent, field).toContain(`~/${field}`);
  expect.soft(container.textContent).not.toContain('reel-operator');
  expect(inspection.doing).toBe(path('doing'));
  expect(plan.reasons).toEqual([path('reason')]);
});
