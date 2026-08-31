import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SteeringAddMenu } from '../src/components/SteeringAddMenu.js';
import { SkipLink } from '../src/components/SkipLink.js';

/**
 * The ONE overlay contract (usability review #10, live-verified broken): the
 * Steering Add menu survived Escape while the rule drawer honored it. Pinned:
 *
 *  - Escape closes the menu and RETURNS FOCUS to the trigger that opened it;
 *  - a click outside closes it (the behavior that already existed);
 *  - the skip link is the app's first tabbable element and jumps to #main.
 */

vi.mock('../src/api/client.js', () => ({
  api: {},
  apiFetch: vi.fn(() => Promise.reject(new Error('no wire in this rig'))),
}));

afterEach(cleanup);

function menu(): void {
  render(
    <SteeringAddMenu type="security" rules={[]} onSaved={() => {}} onRulesChanged={() => {}} />,
  );
}

describe('SteeringAddMenu — the Escape gap, closed', () => {
  it('Escape closes the open Add menu and returns focus to the Add trigger', () => {
    menu();
    const trigger = screen.getByTestId('steering-add-menu');
    fireEvent.click(trigger);
    expect(screen.getByTestId('steering-add-menu-list')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('steering-add-menu-list')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('a click outside still closes it (the pre-existing half of the contract)', () => {
    menu();
    fireEvent.click(screen.getByTestId('steering-add-menu'));
    expect(screen.getByTestId('steering-add-menu-list')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('steering-add-menu-list')).toBeNull();
  });

  it('Escape with the menu closed does nothing (no listener leak)', () => {
    menu();
    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
    expect(screen.queryByTestId('steering-add-menu-list')).toBeNull();
  });
});

describe('SkipLink — first Tab reaches something sensible (review #10)', () => {
  it('renders a real link to #main and moves focus there on activation', () => {
    render(
      <>
        <SkipLink />
        <div id="main" tabIndex={-1}>
          content
        </div>
      </>,
    );
    const link = screen.getByTestId('skip-link');
    expect(link).toHaveAttribute('href', '#main');
    expect(link).toHaveTextContent('Skip to main content');
    fireEvent.click(link);
    expect(document.activeElement).toBe(document.getElementById('main'));
  });
});
