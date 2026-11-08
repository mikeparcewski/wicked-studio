import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AskLineView } from '../src/components/session/AskThread.js';

// e2e-1105 privacy: an ask line and what opens under it never print a home folder.
describe('AskLineView', () => {
  it('collapses home paths in the line and its detail', () => {
    render(<AskLineView line={{ key: 'a:1', at: 1, kind: 'reviewer' as never, text: 'Read /Users/reel-operator/repo/a.ts', detail: ['attach failed: /home/alice/x.json'], tone: 'quiet', ord: null }} />);
    fireEvent.click(screen.getByTestId('ask-line-toggle'));
    const line = screen.getByTestId('ask-line');
    expect(line.textContent).toContain('Read ~/repo/a.ts');
    expect(screen.getByTestId('ask-line-detail').textContent).toContain('attach failed: ~/x.json');
    expect(line.innerHTML).not.toMatch(/reel-operator|alice/);
  });
});
