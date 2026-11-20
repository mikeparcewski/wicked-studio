import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LaunchPanel } from '../src/components/LaunchPanel.js';

vi.mock('../src/components/ChatInput.js', () => ({ ChatInput: () => <div /> }));

it('points to the form for launch gates without promising plan approval (studio#1173)', () => {
  render(<LaunchPanel onLaunched={() => {}} />);
  expect.soft(screen.queryByText(/approve the plan before any work starts/)).not.toBeInTheDocument();
  expect(screen.getByText('Say what you need built; the form below shows what it will ask you before you send.')).toBeInTheDocument();
});
