import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreGateAnnotate } from '../src/components/PreGateAnnotate.js';
import { DRAFT_SCOPE_LABEL, useAnnotationStore } from '../src/store/annotations.js';
import { useGuidanceStore } from '../src/store/guidance.js';
import * as client from '../src/api/client.js';

/**
 * Slice BD (DES-UX-002 §4.3, EC51/EC52): the home-board pre-gate annotation
 * widget — collapsed affordance, typed text lands in the session draft store.
 * Slice BE (§8.1): the durable layer — the run DTO's `guidance` pre-populates
 * first with the draft on top, "save guidance" PUTs through CREW-UX-7 with
 * point-of-action feedback (EC37), and the EC52 label names ONLY the unsaved
 * edit (the one thing still session-scoped), retiring where durability holds.
 */

describe('PreGateAnnotate (slices BD + BE)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAnnotationStore.setState({ drafts: {} });
    useGuidanceStore.setState({ saved: {}, saveState: {} });
  });

  it('collapsed affordance opens; the EC52 label rides ONLY an unsaved edit', async () => {
    const user = userEvent.setup();
    render(<PreGateAnnotate runId="r-1" />);
    const affordance = screen.getByTestId('pre-gate-annotate');
    expect(affordance).toHaveAttribute('data-open', 'false');
    expect(screen.queryByTestId('annotation-scope-label')).toBeNull();
    await user.click(affordance);
    expect(screen.getByTestId('pre-gate-annotate')).toHaveAttribute('data-open', 'true');
    // Nothing typed yet ⇒ nothing is session-scoped ⇒ no label (honest split).
    expect(screen.queryByTestId('annotation-scope-label')).toBeNull();
    await user.type(screen.getByTestId('pre-gate-annotate-input'), 'x');
    expect(screen.getByTestId('annotation-scope-label')).toHaveTextContent(DRAFT_SCOPE_LABEL);
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

  it('an openSignal bump on an ALREADY-open widget focuses it (the board `n` key)', async () => {
    useAnnotationStore.getState().setDraft('r-1', 'standing note'); // mounts open
    const { rerender } = render(<PreGateAnnotate runId="r-1" openSignal={0} />);
    expect(screen.getByTestId('pre-gate-annotate')).toHaveAttribute('data-open', 'true');
    rerender(<PreGateAnnotate runId="r-1" openSignal={1} />);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('pre-gate-annotate-input')));
  });

  // ── Slice BE: the durable layer ────────────────────────────────────────────

  it('the run DTO durable note mounts open, pre-populated, with NO scope label', () => {
    render(<PreGateAnnotate runId="r-1" guidance="rate-limit by API key" />);
    expect(screen.getByTestId('pre-gate-annotate')).toHaveAttribute('data-open', 'true');
    expect((screen.getByTestId('pre-gate-annotate-input') as HTMLTextAreaElement).value)
      .toBe('rate-limit by API key');
    // Durability holds ⇒ the session-scope label retired (EC52 honest split).
    expect(screen.queryByTestId('annotation-scope-label')).toBeNull();
  });

  it('pre-population order: durable first, the session draft ON TOP', () => {
    useAnnotationStore.getState().setDraft('r-1', 'the newer local edit');
    render(<PreGateAnnotate runId="r-1" guidance="the older durable note" />);
    expect((screen.getByTestId('pre-gate-annotate-input') as HTMLTextAreaElement).value)
      .toBe('the newer local edit');
    expect(screen.getByTestId('annotation-scope-label')).toHaveTextContent(DRAFT_SCOPE_LABEL);
  });

  it('save guidance PUTs the text, shows point-of-action feedback, retires the label', async () => {
    const put = vi.spyOn(client.api, 'putGuidance').mockResolvedValue(
      { runId: 'r-1', guidance: 'keep the tests green' } as never,
    );
    const user = userEvent.setup();
    render(<PreGateAnnotate runId="r-1" />);
    await user.click(screen.getByTestId('pre-gate-annotate'));
    await user.type(screen.getByTestId('pre-gate-annotate-input'), 'keep the tests green');
    expect(screen.getByTestId('save-guidance')).toBeEnabled();
    await user.click(screen.getByTestId('save-guidance'));
    expect(put).toHaveBeenCalledWith('r-1', 'keep the tests green');
    await waitFor(() =>
      expect(screen.getByTestId('guidance-save-state')).toHaveAttribute('data-phase', 'saved'));
    // Saved ⇒ nothing session-scoped remains: the label retires, the draft clears.
    expect(screen.queryByTestId('annotation-scope-label')).toBeNull();
    expect(useAnnotationStore.getState().drafts['r-1']).toBeUndefined();
  });

  it('a failed save names the error at the point of action; the edit stays scoped', async () => {
    vi.spyOn(client.api, 'putGuidance').mockRejectedValue(new Error('Run not found'));
    const user = userEvent.setup();
    render(<PreGateAnnotate runId="r-1" />);
    await user.click(screen.getByTestId('pre-gate-annotate'));
    await user.type(screen.getByTestId('pre-gate-annotate-input'), 'note');
    await user.click(screen.getByTestId('save-guidance'));
    await waitFor(() =>
      expect(screen.getByTestId('guidance-save-state')).toHaveAttribute('data-phase', 'error'));
    expect(screen.getByTestId('guidance-save-state').textContent).toContain('Run not found');
    expect(screen.getByTestId('annotation-scope-label')).toHaveTextContent(DRAFT_SCOPE_LABEL);
    expect(useAnnotationStore.getState().drafts['r-1']).toBe('note');
  });
});
