// studio#278: the pickers' "recording failed" badge and the wire reading behind it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RecordingFailedBadge, recordingFailure, recordingStep } from '../src/components/demoRecordingState.js';
import type { DemoStatus } from '../src/api/interactive.js';

const getDemoStatusMock = vi.hoisted(() => vi.fn());
vi.mock('../src/api/interactive.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/interactive.js')>()),
  getDemoStatus: getDemoStatusMock,
}));

afterEach(() => {
  cleanup();
  getDemoStatusMock.mockReset();
});

const wire = (o: Record<string, unknown>): DemoStatus => o as unknown as DemoStatus;

describe('recordingFailure / recordingStep (the bridge wire, read defensively)', () => {
  it('reads a failed status: code, reason, remedy, the step object and a blocked request', () => {
    const f = recordingFailure(wire({
      state: 'failed', in_flight: false,
      error: { code: 'side_effect_blocked', error: 'sent POST /api/v1/runs', remedy: 're-author step 2', step: { index: 2, label: 'Launch' }, request: { method: 'POST', url: 'http://x/api/v1/runs' } },
    }));
    expect(f).toEqual({ code: 'side_effect_blocked', reason: 'sent POST /api/v1/runs', remedy: 're-author step 2', step: { index: 2, label: 'Launch' }, request: { method: 'POST', url: 'http://x/api/v1/runs' } });
  });

  it('is null for anything but a settled failure; a failure without details still says so', () => {
    expect(recordingFailure(null)).toBeNull();
    expect(recordingFailure(wire({ state: 'idle', in_flight: false }))).toBeNull();
    expect(recordingFailure(wire({ state: 'recorded', in_flight: false }))).toBeNull();
    expect(recordingFailure(wire({ state: 'failed', in_flight: true }))).toBeNull();
    expect(recordingFailure(wire({ state: 'failed', in_flight: false, error: null }))).toEqual({ code: 'recording_failed', reason: 'the recorder did not say why', remedy: null, step: null, request: null });
  });

  it('reads the step as the bridge sends it ({index,label}) and as the legacy number+label', () => {
    expect(recordingStep(wire({ step: { index: 3, label: 'Open' } }))).toEqual({ index: 3, label: 'Open' });
    expect(recordingStep(wire({ step: 3, label: 'Open' }))).toEqual({ index: 3, label: 'Open' });
    expect(recordingStep(wire({ step: null }))).toBeNull();
  });
});

describe('RecordingFailedBadge (the Demos list and the doc picker)', () => {
  it('renders "· recording failed at step N (label)" for a failed demo', async () => {
    getDemoStatusMock.mockResolvedValue({ state: 'failed', in_flight: false, error: { code: 'recording_step_failed', error: 'waitForURL timeout', step: { index: 1, label: 'Open the project' } } });
    render(<RecordingFailedBadge projectId="p" demoId="tour" />);
    const badge = await screen.findByTestId('demo-row-failed');
    expect(badge).toHaveTextContent('· recording failed at step 1 (Open the project)');
    expect(badge).toHaveAttribute('data-code', 'recording_step_failed');
    expect(getDemoStatusMock).toHaveBeenCalledWith('p', 'tour');
  });

  it('renders nothing for a healthy demo or an unreachable bridge', async () => {
    getDemoStatusMock.mockResolvedValue({ state: 'recorded', in_flight: false });
    const { container } = render(<RecordingFailedBadge projectId="p" demoId="ok" />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    cleanup();
    getDemoStatusMock.mockRejectedValue(new Error('bridge down'));
    const again = render(<RecordingFailedBadge projectId="p" demoId="ok" />);
    await Promise.resolve();
    expect(again.container).toBeEmptyDOMElement();
  });
});
