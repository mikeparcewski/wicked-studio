import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DecisionsLedger } from '../src/components/DecisionsLedger.js';
import { Burn } from '../src/components/Burn.js';
import { Tech, seatPart } from '../src/components/Tech.js';
import { WhatWhere } from '../src/components/WhatWhere.js';
import { mergeRunModel } from '../src/hooks/useRunModel.js';
import { useViewPrefsStore } from '../src/store/viewPrefs.js';
import { makeUnit, makeView } from './factories.js';

const path = (field: string): string => `/home/reel-operator/${field}`;
const masked = (el: HTMLElement, fields: string[]): void => {
  for (const field of fields) expect.soft(el.textContent, field).toContain(`~/${field}`);
  expect.soft(el.textContent).not.toContain('reel-operator');
};
afterEach(() => { cleanup(); useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: false } })); });

it('masks ledger, burn, technical seats and WhatWhere daemon text without changing their model', () => {
  const model = mergeRunModel(makeView({ status: 'executing', clis: [path('roster')] }, [
    makeUnit({ ord: 0, skill_ref: path('skill'), denial_reason: path('gate-denial') }),
    makeUnit({ ord: 1, denial_reason: path('unit-denial') }),
    makeUnit({ ord: 2, status: 'done', assigned_cli: path('usage') }),
    makeUnit({ ord: 3, status: 'done', assigned_cli: path('no-adapter') }),
    makeUnit({ ord: 4, status: 'done', assigned_cli: path('pending') }),
  ]), []);
  model.units[0]!.gateEvals = [{ criterion: path('criterion'), agentReasoning: path('reasoning'), denialReason: path('gate-denial'), combined: false, hasDeterministicFloor: false, deterministicPass: true, agentVerdict: 'fail', evaluatorPass: null, evaluatorPolicies: [], judgeSkipped: null }];
  model.pendingGate = { ord: 5, prompt: path('prompt') };
  model.units[2]!.usage = [{ attempt: 0, inputTokens: 2, outputTokens: 1, costUsd: 0.1, cacheReadTokens: 0, cacheCreationTokens: 0 }];
  model.units[4]!.assignedInvocation = 'claude';
  const before = JSON.stringify(model);
  render(<><DecisionsLedger model={model} /><Burn model={model} /><WhatWhere model={model} /></>);
  masked(screen.getByTestId('decisions-ledger'), ['skill', 'criterion', 'reasoning', 'gate-denial', 'unit-denial', 'prompt']);
  masked(screen.getByTestId('burn'), ['usage', 'no-adapter', 'pending']);
  masked(screen.getByTestId('what-where'), ['roster']);
  useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: true } }));
  render(<Tech data-testid="c3-tech" parts={[seatPart([path('seat')])]} />);
  masked(screen.getByTestId('c3-tech'), ['seat']);
  expect(JSON.stringify(model)).toBe(before);
});
