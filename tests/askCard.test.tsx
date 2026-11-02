/**
 * Guided asks (DES-GUIDED-CHAT; mockup learn-and-panels state h): the one renderer for every question a person answers
 * inline — six kinds, the recommended option marked and preselected, the consequence of the option you are on, a
 * reason for a danger option, keyboard and screen-reader names — and the mappers that put the existing wire shapes on
 * it (an elicitation's options / recommended / multi; its answer back as `{response}` or `{values}`).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ask, AskAnswer } from '../src/api/ask.js';
import * as client from '../src/api/client.js';
import { askFromElicitation, elicitationContent, isYesNo, recordLine } from '../src/board/askModel.js';
import { AskCard, AskRecord } from '../src/components/ask/AskCard.js';
import { ElicitationPrompt } from '../src/components/ElicitationPrompt.js';
import { RunQuestions } from '../src/components/session/ThreadQuestions.js';
import { useAnsweredAsks } from '../src/store/answeredAsks.js';
import { answerShapeOf, useElicitationStore } from '../src/store/elicitations.js';
import { makeView } from './factories.js';

afterEach(() => cleanup());

const PAUSE: Ask = {
  id: 'p1', host: 'power', from: { kind: 'engine', id: 'engine', label: 'Wren paused' }, prompt: 'This got bigger. How do you want to go on?',
  kind: 'choose', answeredBy: 'person', record: 'You chose: {label}', default: 'split',
  options: [
    { id: 'split', token: 'split', label: 'Split into two lanes', consequence: 'Two jobs from here.', recommended: true },
    { id: 'phased', token: 'switch_phased', label: 'Switch to phased', consequence: 'Ends the power session.' },
    { id: 'frozen', token: 'x', label: 'Ship to release', disabled: 'Frozen: nothing merges there' },
    { id: 'stop', token: 'stop', label: 'Stop', tone: 'danger', needsReason: true, consequence: 'Stops the job.' },
  ],
};

function renderAsk(ask: Ask, extra: Partial<React.ComponentProps<typeof AskCard>> = {}): { onAnswer: ReturnType<typeof vi.fn> } {
  const onAnswer = vi.fn<(a: AskAnswer) => void>();
  render(<AskCard ask={ask} onAnswer={onAnswer} {...extra} />);
  return { onAnswer };
}
const opt = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-ask-option="${id}"]`)!;

describe('choose', () => {
  it('marks and preselects the recommendation, says its consequence, and sends nothing until the primary', () => {
    const { onAnswer } = renderAsk(PAUSE);
    expect(screen.getByRole('radiogroup', { name: PAUSE.prompt })).toBeTruthy();
    expect(opt('split').getAttribute('aria-checked')).toBe('true');
    expect(within(opt('split')).getByTestId('ask-recommended').textContent).toBe('Recommended');
    expect(screen.getByTestId('ask-consequence').textContent).toBe('If you choose this: Two jobs from here.');
    expect(screen.getByTestId('ask-confirm').textContent).toBe('Split into two lanes');
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(opt('phased'));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByTestId('ask-consequence').textContent).toBe('If you choose this: Ends the power session.');
    fireEvent.click(screen.getByTestId('ask-confirm'));
    expect(onAnswer).toHaveBeenCalledWith({ askId: 'p1', option: 'phased' });
  });

  it('the hovered option says its consequence on the same line; leaving goes back to the selected one', () => {
    renderAsk(PAUSE);
    const line = screen.getByTestId('ask-consequence');
    fireEvent.mouseEnter(opt('stop'));
    expect(line.textContent).toBe('If you choose this: Stops the job.');
    expect(line.getAttribute('data-option')).toBe('stop');
    fireEvent.mouseLeave(opt('stop'));
    expect(line.getAttribute('data-option')).toBe('split');
  });

  it('a disabled option stays visible with why, and cannot be chosen', () => {
    const { onAnswer } = renderAsk(PAUSE);
    const frozen = opt('frozen') as HTMLButtonElement;
    expect(frozen.disabled).toBe(true);
    expect(within(frozen).getByTestId('ask-option-why').textContent).toBe('Frozen: nothing merges there');
    fireEvent.click(frozen);
    expect(frozen.getAttribute('aria-checked')).toBe('false');
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('Stop asks for a reason (required) before it is sent, with the reason in the answer', () => {
    const { onAnswer } = renderAsk(PAUSE);
    fireEvent.click(opt('stop'));
    const box = screen.getByLabelText(/Why stop\? \(kept with the record\)/) as HTMLTextAreaElement;
    expect(box.getAttribute('aria-required')).toBe('true');
    expect(document.activeElement).toBe(box);
    const send = screen.getByTestId('ask-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: '  ' } });
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'wrong repo' } });
    fireEvent.click(send);
    expect(onAnswer).toHaveBeenCalledWith({ askId: 'p1', option: 'stop', reason: 'wrong repo' });
  });

  it('a preselected option that asks for words never opens its box (or sends prefilled words) until taken', () => {
    const ask: Ask = { ...PAUSE, default: 'back', options: [{ id: 'back', token: 'b', label: 'Send back', needsReason: true, recommended: true }, { id: 'ok', token: 'ok', label: 'Approve' }] };
    const { onAnswer } = renderAsk(ask, { reasonFor: () => ({ label: 'What to fix', prefill: 'the failing test', send: 'Send back' }) });
    expect(screen.queryByTestId('ask-reason')).toBeNull();
    fireEvent.click(screen.getByTestId('ask-confirm'));
    expect(onAnswer).not.toHaveBeenCalled();
    const box = screen.getByLabelText('What to fix') as HTMLTextAreaElement;
    expect(box.value).toBe('the failing test');
    expect(box.selectionStart).toBe(box.value.length);
    fireEvent.click(screen.getByTestId('ask-send'));
    expect(onAnswer).toHaveBeenCalledWith({ askId: 'p1', option: 'back', reason: 'the failing test' });
  });

  it('keyboard: one tab stop; arrows / Home / End / a digit move the selection; Enter answers; nothing sends on a move', () => {
    const { onAnswer } = renderAsk(PAUSE);
    const stops = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].filter((b) => b.tabIndex === 0);
    expect(stops.map((b) => b.dataset['askOption'])).toEqual(['split']);
    act(() => opt('split').focus());
    fireEvent.keyDown(opt('split'), { key: 'ArrowDown' });
    expect(opt('phased').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(opt('phased'));
    // The disabled option is skipped.
    fireEvent.keyDown(opt('phased'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(opt('stop'));
    fireEvent.keyDown(opt('stop'), { key: 'Home' });
    expect(document.activeElement).toBe(opt('split'));
    fireEvent.keyDown(opt('split'), { key: '2' });
    expect(opt('phased').getAttribute('aria-checked')).toBe('true');
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(opt('phased'), { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith({ askId: 'p1', option: 'phased' });
  });

  it('with no recommendation nothing is preselected (none is invented), and the primary waits for a choice', () => {
    const { default: _d, ...rest } = PAUSE;
    void _d;
    renderAsk({ ...rest, options: PAUSE.options!.map((o) => ({ ...o, recommended: false })) });
    expect(document.querySelector('[aria-checked="true"]')).toBeNull();
    const go = screen.getByTestId('ask-confirm') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(go.textContent).toBe('Choose an option');
  });
});

describe('confirm, pick, scale, text', () => {
  it('confirm: two halves; picking one is the answer', () => {
    const { onAnswer } = renderAsk({ id: 'c', host: 'learn', from: { kind: 'studio', id: 's', label: 'Learn' }, prompt: 'Learn from your handbook?', kind: 'confirm', answeredBy: 'any', record: 'You said: {label}',
      options: [{ id: 'yes', token: 'yes', label: 'Yes, use it' }, { id: 'no', token: 'no', label: 'Not now' }] });
    expect(screen.queryByTestId('ask-confirm')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Not now' }));
    expect(onAnswer).toHaveBeenCalledWith({ askId: 'c', option: 'no' });
  });

  const PICK: Ask = { id: 'k', host: 'elicitation', from: { kind: 'seat', id: 'codex', label: 'Codex asks' }, prompt: 'Which branches does this apply to?', kind: 'pick', answeredBy: 'any', record: 'You picked: {labels}',
    default: ['main'], multi: { min: 1 },
    options: [{ id: 'main', token: 'main', label: 'main', meta: 'default' }, { id: 'r10', token: 'release/2026.10', label: 'release/2026.10' }, { id: 'r09', token: 'release/2026.09', label: 'release/2026.09', disabled: 'Frozen: nothing merges there' }, { id: 'dev', token: 'develop', label: 'develop' }] };

  it('pick: checkbox chips, the count and bounds, Select all skips what cannot be picked; the answer is in option order', () => {
    const { onAnswer } = renderAsk(PICK);
    const chip = (name: RegExp) => screen.getByRole('checkbox', { name });
    expect(chip(/^main/).getAttribute('aria-checked')).toBe('true');
    expect(chip(/release\/2026\.09.*not available: Frozen/)).toBeDisabled();
    expect(screen.getByTestId('ask-options-off').textContent).toContain('release/2026.09: Frozen: nothing merges there');
    expect(screen.getByTestId('ask-confirm').textContent).toBe('Use main');
    fireEvent.click(chip(/^main/));
    expect(screen.getByTestId('ask-count').textContent).toBe('0 picked · pick at least 1');
    expect(screen.getByTestId('ask-confirm')).toBeDisabled();
    fireEvent.click(chip(/^develop/));
    fireEvent.click(chip(/^release\/2026\.10/));
    fireEvent.click(screen.getByTestId('ask-confirm'));
    expect(onAnswer).toHaveBeenLastCalledWith({ askId: 'k', options: ['r10', 'dev'] });
    fireEvent.click(screen.getByTestId('ask-select-all'));
    expect(screen.getByTestId('ask-count').textContent).toBe('3 picked');
  });

  it('pick: at most max — the rest wait until one is taken off', () => {
    renderAsk({ ...PICK, default: [], multi: { min: 1, max: 2 } });
    fireEvent.click(screen.getByRole('checkbox', { name: /^main/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^develop/ }));
    expect(screen.getByRole('checkbox', { name: /^release\/2026\.10/ })).toBeDisabled();
    expect(screen.queryByTestId('ask-select-all')).toBeNull();
    expect(screen.getByTestId('ask-count').textContent).toBe('2 picked · at most 2');
  });

  it('pick with multi.min 0: nothing ticked is an answer — "Keep none" sends an empty pick; the default still needs one', () => {
    const { onAnswer } = renderAsk({ ...PICK, default: [], multi: { min: 0 } });
    const go = screen.getByTestId('ask-confirm') as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    expect(go.textContent).toBe('Keep none');
    expect(go.dataset['none']).toBe('true');
    expect(screen.getByTestId('ask-count').textContent).toBe('None picked · that is an answer too');
    fireEvent.click(go);
    expect(onAnswer).toHaveBeenCalledWith({ askId: 'k', options: [] });
    fireEvent.click(screen.getByRole('checkbox', { name: /^develop/ }));
    expect(go.textContent).toBe('Use develop');
    fireEvent.click(screen.getByRole('checkbox', { name: /^develop/ }));
    expect(go.textContent).toBe('Keep none');
    cleanup();
    // Without an explicit 0 the bound stays 1.
    renderAsk({ ...PICK, default: [], multi: {} });
    expect((screen.getByTestId('ask-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('scale: a slider over named steps with its words and consequence; the answer is the step', () => {
    const { onAnswer } = renderAsk({ id: 's', host: 'learn', from: { kind: 'studio', id: 's', label: 'Learn' }, prompt: 'How strict should the rules start?', kind: 'scale', answeredBy: 'any', record: 'You set: {label}', default: 1,
      scale: { steps: ['Suggest only', 'Should', 'Must'], consequences: ['Advice.', 'Warned.', 'Fails the check.'] } });
    const slider = screen.getByRole('slider', { name: 'How strict should the rules start?' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Should');
    fireEvent.change(slider, { target: { value: '2' } });
    expect(screen.getByTestId('ask-scale-value').textContent).toBe('Must');
    expect(screen.getByTestId('ask-consequence').textContent).toBe('Fails the check.');
    fireEvent.click(screen.getByTestId('ask-confirm'));
    expect(onAnswer).toHaveBeenCalledWith({ askId: 's', value: 2 });
  });

  it('text: a labelled box; Enter sends; an optional one offers Nothing to add', () => {
    const { onAnswer } = renderAsk({ id: 't', host: 'learn', from: { kind: 'studio', id: 's', label: 'Learn' }, prompt: 'Anything these docs get wrong?', kind: 'text', answeredBy: 'any', record: 'You noted: {text}', text: { optional: true, placeholder: 'e.g. we stopped using release branches' } });
    const box = screen.getByRole('textbox', { name: 'Anything these docs get wrong?' });
    fireEvent.change(box, { target: { value: 'no release branches' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith({ askId: 't', text: 'no release branches' });
    fireEvent.click(screen.getByTestId('ask-skip'));
    expect(onAnswer).toHaveBeenLastCalledWith({ askId: 't', text: '' });
  });

  it('confirm_reason: the reason is required before the one move', () => {
    const { onAnswer } = renderAsk({ id: 'r', host: 'gate', from: { kind: 'engine', id: 'e', label: 'The engine asks' }, prompt: 'Skip QE for this delivery?', kind: 'confirm_reason', answeredBy: 'person', record: 'You chose: {label}', default: 'skip',
      options: [{ id: 'skip', token: 'skip_qe', label: 'Skip QE', tone: 'danger' }] });
    fireEvent.click(opt('skip'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'manual check done' } });
    fireEvent.click(screen.getByTestId('ask-send'));
    expect(onAnswer).toHaveBeenCalledWith({ askId: 'r', option: 'skip', reason: 'manual check done' });
  });
});

describe('the record line and the mappers', () => {
  it('collapses to one plain line', () => {
    render(<AskRecord line="You chose: Split into two lanes" meta="sent" />);
    expect(screen.getByRole('status').textContent).toContain('You chose: Split into two lanes');
    expect(recordLine(PAUSE, { askId: 'p1', option: 'stop', reason: 'wrong repo' })).toBe('You chose: Stop · “wrong repo”');
  });

  it('an elicitation maps to text / confirm / choose / pick, and its answer back to {response} or {values}', () => {
    const text = askFromElicitation({ elicitationId: 'e', message: 'Which region?', options: null }, 'Codex');
    expect(text.kind).toBe('text');
    expect(elicitationContent(text, { askId: 'e', text: ' eu-west ' })).toEqual({ response: 'eu-west' });
    expect(askFromElicitation({ elicitationId: 'e', message: 'Proceed?', options: ['yes', 'no'] }, 'x').kind).toBe('confirm');
    expect(isYesNo(['Approve', 'Reject'])).toBe(true);
    expect(isYesNo(['A', 'B'])).toBe(false);
    const choose = askFromElicitation({ elicitationId: 'e', message: 'Pick', options: ['a', 'b', 'c'], recommended: 2 }, 'x');
    expect(choose.kind).toBe('choose');
    expect(choose.options![2]!.recommended).toBe(true);
    expect(elicitationContent(choose, { askId: 'e', option: '1' })).toEqual({ response: 'b' });
    const pick = askFromElicitation({ elicitationId: 'e', message: 'Which?', options: ['main', 'rel', 'dev'], multi: { min: 1, max: 2 }, recommended: 0 }, 'x');
    expect(pick.kind).toBe('pick');
    expect(pick.default).toEqual(['0']);
    expect(pick.detail).toBe('You can pick more than one (up to 2).');
    expect(elicitationContent(pick, { askId: 'e', options: ['2', '0'] })).toEqual({ values: ['main', 'dev'] });
  });

  it('the store keeps recommended and multi only when well-formed against the options', () => {
    expect(answerShapeOf({ options: ['a', 'b'], recommended: 1, multi: { min: 1, max: 2 } })).toEqual({ recommended: 1, multi: { min: 1, max: 2 } });
    expect(answerShapeOf({ options: ['a', 'b'], recommended: 2, multi: { min: 2, max: 3 } })).toEqual({});
    expect(answerShapeOf({ options: null, recommended: 0 })).toEqual({});
  });
});

describe('ElicitationPrompt as a guided ask', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useElicitationStore.setState({ elicitations: {}, generations: {} } as never);
    useAnsweredAsks.setState({ byKey: {} });
  });

  it('a multi-select question answers with content.values, then leaves one line where it was', async () => {
    const respond = vi.spyOn(client.api, 'respondToElicitation').mockResolvedValue({ status: 'resolved' });
    const view = makeView({ id: 'r1', status: 'running' } as never, []);
    act(() => { useElicitationStore.getState().setElicitation({ runId: 'r1', elicitationId: 'e1', message: 'Which branches?', options: ['main', 'release', 'develop'], receivedAt: new Date().toISOString(), multi: { min: 1, max: 3 }, recommended: 0 }); });
    render(<RunQuestions view={view} />);
    const prompt = screen.getByTestId('elicitation-prompt');
    expect(prompt.dataset['kind']).toBe('pick');
    fireEvent.click(within(prompt).getByRole('checkbox', { name: 'develop' }));
    await act(async () => { fireEvent.click(within(prompt).getByTestId('ask-confirm')); });
    expect(respond).toHaveBeenCalledWith('r1', { elicitationId: 'e1', action: 'accept', content: { values: ['main', 'develop'] } });
    expect(screen.queryByTestId('elicitation-prompt')).toBeNull();
    expect(screen.getByTestId('ask-record').textContent).toBe('You picked: main, develop');
  });

  it('Don’t answer declines with no content', async () => {
    const respond = vi.spyOn(client.api, 'respondToElicitation').mockResolvedValue({ status: 'resolved' });
    render(<ElicitationPrompt e={{ runId: 'r2', elicitationId: 'e2', message: 'Which region?', options: null, receivedAt: new Date().toISOString() }} who="Codex" />);
    expect(screen.getByText('Codex asks · a question, not a gate')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId('elicitation-decline')); });
    expect(respond).toHaveBeenCalledWith('r2', { elicitationId: 'e2', action: 'decline' });
  });
});
