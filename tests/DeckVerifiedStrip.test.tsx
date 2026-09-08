// The verified-vs-needs-review strip — the delivery split off the run DTO, one fold shared with the
// ribbon's ATTENTION tile.

import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DeckVerifiedStrip } from '../src/components/DeckVerifiedStrip.js';
import { makeView } from './factories.js';

afterEach(cleanup);

describe('DeckVerifiedStrip', () => {
  it('counts delivered / stranded / vacuous off the wire, ignoring other states + archived runs', () => {
    render(
      <DeckVerifiedStrip
        runs={[
          makeView({ id: 'a', delivery: 'delivered' }),
          makeView({ id: 'b', delivery: 'delivered' }),
          makeView({ id: 'c', delivery: 'stranded' }),
          makeView({ id: 'd', delivery: 'vacuous' }),
          makeView({ id: 'e', delivery: 'none' }),
          makeView({ id: 'f', delivery: 'delivered', archived_at: 1 }), // archived → excluded
        ]}
        navigate={() => {}}
      />,
    );
    expect(screen.getByTestId('delivery-verified').textContent).toContain('2');
    expect(screen.getByTestId('delivery-stranded').textContent).toContain('1');
    expect(screen.getByTestId('delivery-vacuous').textContent).toContain('1');
  });

  it('counts the LEGACY 0.11–0.17 object delivery form as delivered (copilot #198)', () => {
    render(
      <DeckVerifiedStrip
        runs={[
          makeView({ id: 'a', delivery: 'delivered' }),
          // A legacy daemon's object form ({kind:'pull_request', url}) — still a delivered PR.
          makeView({ id: 'b', delivery: { kind: 'pull_request', url: 'https://x/pull/9' } as unknown as 'delivered' }),
        ]}
        navigate={() => {}}
      />,
    );
    expect(screen.getByTestId('delivery-verified').textContent).toContain('2');
  });
});
