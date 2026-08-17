// The steering INPUT moved into the run thread's composer (ChatInput routes by run state:
// inject while executing, gate-answer while awaiting_human). The insights panel keeps only
// the read side — the SteeringTimeline accordion. These pin the removal (feat/live-thread).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RightPanel } from '../src/components/RightPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import { useSteeringStore } from '../src/store/steering.js';
import { makeView, makeUnit } from './factories.js';
import type { SessionView } from '../src/api/types.js';

function executingView(): SessionView {
  return makeView({ status: 'executing', unit_ix: 0 }, [
    makeUnit({ id: 'run-1:u0', ord: 0, status: 'distributed', assigned_cli: 'claude' }),
  ]);
}

beforeEach(() => {
  vi.restoreAllMocks();
  useRunEventStore.setState({ byRun: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  vi.spyOn(client.api, 'getRun').mockResolvedValue({ run: executingView() });
});

describe('RightPanel — steering input removed (composer owns steering)', () => {
  it('renders NO steering composer on an executing run', () => {
    render(<RightPanel view={executingView()} />);
    expect(screen.queryByLabelText('Steering instruction')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/send instruction to agents/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send steering instruction/i })).not.toBeInTheDocument();
  });

  it('keeps the SteeringTimeline accordion (the read side stays)', async () => {
    render(<RightPanel view={executingView()} />);
    fireEvent.click(screen.getByRole('button', { name: /steering/i }));
    expect(await screen.findByTestId('steering-timeline')).toBeInTheDocument();
  });
});
