import { fireEvent, screen, within } from '@testing-library/react';

/**
 * Guided asks (DES-GUIDED-CHAT): a gate choice is a card. Picking it selects it; the primary sends it (through the
 * 10 s undo window), and a choice that asks for words (send back, steer, Stop's reason) sends from its box. These
 * helpers take that path, so a test that used to click a choice and see it sent says the same thing.
 */
export function chooseGate(choice: HTMLElement | string, words?: string, scope?: HTMLElement): void {
  const q = scope !== undefined ? within(scope) : screen;
  const el = typeof choice === 'string'
    ? q.getAllByTestId('session-gate-choice').find((c) => c.dataset['choiceKey'] === choice)
    : choice;
  if (el === undefined) throw new Error(`no gate choice ${String(choice)}`);
  fireEvent.click(el);
  const note = q.queryByTestId('session-gate-note');
  if (note !== null) {
    if (words !== undefined) fireEvent.change(note, { target: { value: words } });
    else if ((note as HTMLTextAreaElement).value.trim() === '') fireEvent.change(note, { target: { value: 'test reason' } });
    fireEvent.click(q.getByTestId('session-gate-send'));
    return;
  }
  fireEvent.click(q.getByTestId('session-gate-confirm'));
}
