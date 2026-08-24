import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreGateAnnotate } from '../src/components/PreGateAnnotate.js';
import { SCOPE_LABEL, useAnnotationStore } from '../src/store/annotations.js';

/**
 * Slice BD (DES-UX-002 §4.3, EC51/EC52): the home-board pre-gate annotation
 * widget — collapsed affordance, typed text lands in the session draft store,
 * the honest scope label rides the open widget.
 */

describe('PreGateAnnotate (slice BD)', () => {
  beforeEach(() => {
    useAnnotationStore.setState({ drafts: {} });
  });

  it('collapsed affordance opens into the textarea + EC52 scope label', async () => {
    const user = userEvent.setup();
    render(<PreGateAnnotate runId="r-1" />);
    const affordance = screen.getByTestId('pre-gate-annotate');
    expect(affordance).toHaveAttribute('data-open', 'false');
    expect(screen.queryByTestId('annotation-scope-label')).toBeNull();
    await user.click(affordance);
    expect(screen.getByTestId('pre-gate-annotate')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('annotation-scope-label')).toHaveTextContent(SCOPE_LABEL);
  });

  it('typing saves the draft keyed by run id — no wire, just the store', async () => {
    const user = userEvent.setup();
    render(<PreGateAnnotate runId="r-1" />);
    await user.click(screen.getByTestId('pre-gate-annotate'));
    await user.type(screen.getByTestId('pre-gate-annotate-input'), 'Focus: rate limits');
    expect(useAnnotationStore.getState().drafts['r-1']).toBe('Focus: rate limits');
  });

  it('a standing draft mounts the widget open with the text', () => {
    useAnnotationStore.getState().setDraft('r-1', 'keep tests green');
    render(<PreGateAnnotate runId="r-1" />);
    expect(screen.getByTestId('pre-gate-annotate')).toHaveAttribute('data-open', 'true');
    expect((screen.getByTestId('pre-gate-annotate-input') as HTMLTextAreaElement).value)
      .toBe('keep tests green');
  });

  it('an openSignal bump (the gate-approaching chip) opens and focuses it', async () => {
    const { rerender } = render(<PreGateAnnotate runId="r-1" openSignal={0} />);
    expect(screen.getByTestId('pre-gate-annotate')).toHaveAttribute('data-open', 'false');
    rerender(<PreGateAnnotate runId="r-1" openSignal={1} />);
    const input = await screen.findByTestId('pre-gate-annotate-input');
    expect(screen.getByTestId('pre-gate-annotate')).toHaveAttribute('data-open', 'true');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(input);
  });
});
