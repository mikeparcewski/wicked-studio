import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SkipLink } from '../src/components/SkipLink.js';

/**
 * The ONE overlay contract (usability review #10): the skip link is the app's first tabbable element and
 * jumps to #main. (The Steering Add menu it once pinned went with the table page, studio#689 ruling b; the
 * Steer page's ⋯ menu is CalmMenu, pinned with that page.)
 */

vi.mock('../src/api/client.js', () => ({
  api: {},
  apiFetch: vi.fn(() => Promise.reject(new Error('no wire in this rig'))),
}));

afterEach(cleanup);

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
