import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Ask } from '../src/api/ask.js';
import { AskCard, AskRecord } from '../src/components/ask/AskCard.js';
import { FailingGroups } from '../src/components/session/GateRow.js';

afterEach(cleanup);
it('masks failing group files, test ids and hovers, ask prompt/options and answered line; answers retain raw ids', () => {
  const home = '/home/reel-operator';
  const id = `${home}/option-id`;
  const ask: Ask = { id: 'ask-c3', host: 'chat', from: { kind: 'studio', id: 'studio', label: 'studio asks' }, prompt: `Read ${home}/prompt`, detail: `See ${home}/detail`, kind: 'choose', options: [
    { id, token: id, label: `${home}/label`, sub: `${home}/sub`, meta: `${home}/meta`, consequence: `${home}/consequence`, recommended: true },
    { id: 'disabled', token: 'disabled', label: 'Unavailable', disabled: `${home}/disabled` },
  ], answeredBy: 'person', record: 'You chose: {label}' };
  const answer = vi.fn();
  const { container } = render(<><FailingGroups ids={[`FAIL ${home}/file.test.ts > suite > reads ${home}/test`]} /><AskCard ask={ask} onAnswer={answer} /><AskRecord line={`You chose: ${home}/record`} /></>);
  for (const field of ['file.test.ts', 'test', 'prompt', 'detail', 'label', 'sub', 'meta', 'consequence', 'disabled', 'record']) {
    expect.soft(container.textContent, field).toContain(`~/${field}`);
  }
  expect.soft(container.textContent).not.toContain('reel-operator');
  for (const el of container.querySelectorAll('[title], [aria-label]')) {
    expect.soft(el.getAttribute('title') ?? el.getAttribute('aria-label')).not.toContain('reel-operator');
  }
  fireEvent.click(screen.getByTestId('ask-confirm'));
  expect(answer).toHaveBeenCalledWith({ askId: 'ask-c3', option: id });
  expect(ask.options![0]!.label).toBe(`${home}/label`);
  cleanup();
  const pick = render(<AskCard ask={{ ...ask, kind: 'pick' }} onAnswer={answer} />);
  for (const field of ['label', 'meta', 'disabled']) expect.soft(pick.container.textContent, `pick ${field}`).toContain(`~/${field}`);
  for (const el of pick.container.querySelectorAll('[title], [aria-label]')) expect.soft(el.getAttribute('title') ?? el.getAttribute('aria-label')).not.toContain('reel-operator');
  expect.soft(pick.container.textContent).not.toContain('reel-operator');
  cleanup();
  const scale = render(<AskCard ask={{ ...ask, kind: 'scale', scale: { steps: [`${home}/low`, `${home}/high`], consequences: [`${home}/scaled`, 'High'] } }} onAnswer={answer} />);
  for (const field of ['low', 'high', 'scaled']) expect.soft(scale.container.textContent, `scale ${field}`).toContain(`~/${field}`);
  expect.soft(scale.container.textContent).not.toContain('reel-operator');
});
