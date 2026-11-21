import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { api } from '../src/api/client.js';
import { RoutingProvenance } from '../src/components/RoutingProvenance.js';
import { AssumptionsPanel } from '../src/components/AssumptionsPanel.js';
import { GovernanceAudit } from '../src/components/GovernanceAudit.js';
import { mergeRunModel } from '../src/hooks/useRunModel.js';
import { makeUnit, makeView } from './factories.js';

const path = (field: string): string => `/home/reel-operator/${field}`;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('masks routing, assumption and governance reasons while retaining raw decision records', async () => {
  vi.spyOn(api, 'listClaims').mockResolvedValue({ claims: [] });
  vi.spyOn(api, 'getRunAcceptance').mockResolvedValue({} as never);
  const model = mergeRunModel(makeView({}, [makeUnit({ ord: 0, routing: { method: 'degraded', reason: path('routing') }, denial_reason: path('denial') })]), []);
  model.units[0]!.governanceUnenforced = { cli: 'codex', reason: path('enforcement') };
  const before = JSON.stringify(model);
  render(<><RoutingProvenance routing={{ method: 'degraded', reason: path('provenance') }} /><AssumptionsPanel model={model} /><GovernanceAudit model={model} /></>);
  await screen.findByTestId('governance-run-decision');
  for (const [testId, field] of [['routing-provenance', 'provenance'], ['assumptions', 'routing'], ['governance-run-decision', 'denial'], ['governance-enforcement', 'enforcement']]) {
    const text = screen.getByTestId(testId!).textContent;
    expect.soft(text, field).toContain(`~/${field}`);
    expect.soft(text, field).not.toContain('reel-operator');
  }
  expect(JSON.stringify(model)).toBe(before);
});
