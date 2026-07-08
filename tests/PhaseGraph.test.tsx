import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhaseGraph } from '../src/components/PhaseGraph.js';
import type { Phase } from '../src/api/client.js';

const makePhase = (phase_id: string, state: string): Phase => ({
  id: `${phase_id}-row`,
  session_id: 'sess-1',
  phase_id,
  state,
  gate_kind: 'auto',
  blocking_raid_ids: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe('PhaseGraph', () => {
  it('renders all phases', () => {
    const phases = [makePhase('clarify', 'Approved'), makePhase('design', 'InProgress')];
    render(<PhaseGraph phases={phases} />);
    expect(screen.getByText('clarify')).toBeInTheDocument();
    expect(screen.getByText('design')).toBeInTheDocument();
  });

  it('shows state labels', () => {
    const phases = [makePhase('clarify', 'Approved')];
    render(<PhaseGraph phases={phases} />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('renders empty list without crashing', () => {
    render(<PhaseGraph phases={[]} />);
    expect(screen.getByTestId('phase-graph')).toBeInTheDocument();
  });
});
