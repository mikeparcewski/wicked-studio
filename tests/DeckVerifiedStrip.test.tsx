// The verified-vs-needs-review strip — the delivery split off the run DTO, one fold shared with the
// ribbon's ATTENTION tile. The vacuous cell counts only runs that were EXPECTED to deliver
// (wicked-studio#250, F-3R2-018) and names the condition, not a prescription.

import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeckVerifiedStrip } from '../src/components/DeckVerifiedStrip.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { LIVE_WORKFLOWS } from './fixtures/workflows.js';

afterEach(cleanup);
beforeEach(() => clearCachedWorkflows());

/** A completed repo-scoped run whose deliver phase ran and found nothing to lift — a REAL vacuous run. */
const vacuousWithDeliverUnit = (id: string) =>
  makeView(
    { id, status: 'completed', repo_ref: 'org/repo', delivery: 'vacuous' },
    [makeUnit({ id: `${id}:deliver`, session_id: id, ord: 5, status: 'rejected', denial_reason: 'nothing to deliver' })],
  );

describe('DeckVerifiedStrip', () => {
  it('counts delivered / stranded / vacuous off the wire, ignoring other states + archived runs', () => {
    render(
      <DeckVerifiedStrip
        runs={[
          makeView({ id: 'a', delivery: 'delivered' }),
          makeView({ id: 'b', delivery: 'delivered' }),
          makeView({ id: 'c', delivery: 'stranded' }),
          vacuousWithDeliverUnit('d'),
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

  it('F-3R2-018: onboarding runs the daemon stamped vacuous are NOT "vacuous" — they deliver nothing by design', () => {
    // The recorded landing: 2 delivered, 0 stranded, and NINE completed onboarding runs stamped
    // `vacuous` on the wire (an untouched worktree is that workflow's designed outcome) — plus the
    // one real signal, a bug run whose deliver phase found nothing.
    setCachedWorkflows(LIVE_WORKFLOWS);
    render(
      <DeckVerifiedStrip
        runs={[
          makeView({ id: 'd1', workflow_id: 'bug', delivery: 'delivered' }),
          makeView({ id: 'd2', workflow_id: 'bug', delivery: 'delivered' }),
          ...Array.from({ length: 9 }, (_, i) =>
            makeView({ id: `ob-${i}`, workflow_id: 'onboarding', status: 'completed', repo_ref: 'org/repo', delivery: 'vacuous' }),
          ),
          vacuousWithDeliverUnit('real'),
        ]}
        navigate={() => {}}
      />,
    );
    expect(screen.getByTestId('delivery-verified').textContent).toContain('2');
    expect(screen.getByTestId('delivery-stranded').textContent).toContain('0');
    const vacuous = screen.getByTestId('delivery-vacuous');
    expect(vacuous.querySelector('.deck-vn')?.textContent).toBe('1');
    // The label states the condition, not "needs retry".
    expect(vacuous).toHaveTextContent('Vacuous — no change to deliver');
    expect(vacuous).not.toHaveTextContent('needs retry');
  });

  it('the licence holds on a COLD catalog too: `onboarding` is denylisted, so the nine never flash as vacuous while defs load', () => {
    render(
      <DeckVerifiedStrip
        runs={Array.from({ length: 9 }, (_, i) =>
          makeView({ id: `ob-${i}`, workflow_id: 'onboarding', status: 'completed', repo_ref: 'org/repo', delivery: 'vacuous' }),
        )}
        navigate={() => {}}
      />,
    );
    expect(screen.getByTestId('delivery-vacuous').querySelector('.deck-vn')?.textContent).toBe('0');
  });
});
