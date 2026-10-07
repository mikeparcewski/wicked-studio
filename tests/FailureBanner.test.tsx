import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FailureBanner } from '../src/components/FailureBanner.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import type { LoggedEvent } from '../src/store/runtime.js';
import { makeView, makeUnit } from './factories.js';

const errorLog: LoggedEvent[] = [
  { seq: 1, type: 'unitExecuting', ts: 0, detail: 'executing' },
  { seq: 2, type: 'error', ts: 0, detail: 'error: worker exited non-zero' },
];

describe('FailureBanner (§11.5 — run-halted explainer)', () => {
  it('renders nothing for a live (non-terminal-bad) run', () => {
    render(<FailureBanner view={makeView({ status: 'executing' })} log={[]} />);
    expect(screen.queryByTestId('failure-banner')).toBeNull();
  });

  it('explains a failed run using the error frame + per-unit denial reasons (real data)', () => {
    const view = makeView({ status: 'failed' }, [
      makeUnit({ id: 'u1', ord: 1, status: 'rejected', denial_reason: 'governance: touches secrets' }),
    ]);
    render(<FailureBanner view={view} log={errorLog} />);
    const banner = screen.getByTestId('failure-banner');
    expect(banner).toHaveAttribute('data-kind', 'failed');
    expect(banner).toHaveTextContent('Run halted');
    expect(banner).toHaveTextContent('worker exited non-zero');
    expect(banner).toHaveTextContent('governance: touches secrets');
  });

  it('renders a cancelled banner distinctly', () => {
    render(<FailureBanner view={makeView({ status: 'cancelled' })} log={[]} />);
    const banner = screen.getByTestId('failure-banner');
    expect(banner).toHaveAttribute('data-kind', 'cancelled');
    expect(banner).toHaveTextContent('Run cancelled');
  });

  // Slice Y (DES-UX-001 §7.4): the banner's All-runs is a FAILURE-CONTEXT entry —
  // it lands on "See everything › Sessions" with the Blocked lens (S15c; `/work?filter=` moved there).

  // Review Top-10 #1: the deny banner speaks plain language FIRST; the engine prose survives
  // as a dim detail line, and rule denials link into the Steering drawer.
  it('translates a boundary-deny into plain words with the engine detail beneath', () => {
    const view = makeView({ status: 'failed' }, [
      makeUnit({
        id: 'u2', ord: 2, status: 'rejected',
        denial_reason: 'input governance denied a tool-call in unit-2 (claim boundary-deny:unit-2)',
      }),
    ]);
    render(<FailureBanner view={view} log={[]} />);
    expect(screen.getByTestId('failure-plain')).toHaveTextContent(
      'Unit #2 tried to write outside its workspace and was stopped to protect your files.',
    );
    expect(screen.getByTestId('failure-engine-detail')).toHaveTextContent('claim boundary-deny:unit-2');
  });

  it('links a rule denial to the Steering drawer via /steering/policies?rule=', () => {
    const navigate = vi.fn();
    const view = makeView({ status: 'failed' }, [
      Object.assign(
        makeUnit({ id: 'u3', ord: 3, status: 'rejected', denial_reason: 'denied by policy' }),
        { denial: { claim_id: 'gate:unit-3', rule_ids: ['SEC-101'] } },
      ),
    ]);
    render(<FailureBanner view={view} log={[]} navigate={navigate} />);
    const link = screen.getByTestId('failure-rule-link');
    expect(link).toHaveTextContent('SEC-101');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/steering/policies?rule=SEC-101');
  });

  it('carries the failure-context "All runs ›" link to /work?filter=failed', () => {
    const navigate = vi.fn();
    render(<FailureBanner view={makeView({ status: 'failed' })} log={errorLog} navigate={navigate} />);
    const link = screen.getByTestId('failure-all-runs');
    expect(link).toHaveAttribute('href', '/everything?tab=sessions&filter=failed');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/everything?tab=sessions&filter=failed');
  });

  it('omits the link when no navigate is wired (no dead affordance)', () => {
    render(<FailureBanner view={makeView({ status: 'failed' })} log={errorLog} />);
    expect(screen.queryByTestId('failure-all-runs')).toBeNull();
  });
});

describe('a rejected plan ends cancelled (studio#478)', () => {
  it('the all-runs link follows the banner: a cancelled run lands on the Cancelled filter', () => {
    const navigate = vi.fn();
    render(<FailureBanner view={makeView({ status: 'cancelled' })} log={[]} navigate={navigate} />);
    const link = screen.getByTestId('failure-all-runs');
    expect(link).toHaveAttribute('href', '/everything?tab=sessions&filter=cancelled');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/everything?tab=sessions&filter=cancelled');
  });

  it('the operator\'s reject note is on the cancelled banner, in their words', () => {
    const view = makeView({ status: 'cancelled' });
    useProvenanceStore.setState((s) => ({ rejectNotes: { ...s.rejectNotes, [view.session.id]: 'not this week' } }));
    render(<FailureBanner view={view} log={[]} />);
    expect(screen.getByTestId('failure-reject-note')).toHaveTextContent('You rejected it: “not this week”');
  });
});

describe('an engine cancel is never attributed to the operator (studio#537)', () => {
  it('send-back then runCancelled with no reject ⇒ "Run cancelled — the engine stopped it", the send-back shown as a send-back', () => {
    const view = makeView({ status: 'cancelled' });
    useProvenanceStore.setState((s) => ({
      rejectNotes: { ...s.rejectNotes, [view.session.id]: null },
      cancelStories: { ...s.cancelStories, [view.session.id]: { rejectNote: null, sendBackNote: 'Fix the reviewer\'s failing items', engineTimedOut: true } },
    }));
    render(<FailureBanner view={view} log={[]} />);
    const banner = screen.getByTestId('failure-banner');
    expect(banner).toHaveAttribute('data-cause', 'engine-timeout');
    expect(banner).toHaveTextContent('Run cancelled — the engine stopped it');
    expect(banner).not.toHaveTextContent('You rejected it');
    expect(screen.queryByTestId('failure-reject-note')).toBeNull();
    expect(screen.getByTestId('failure-send-back-note')).toHaveTextContent('Your last send-back to the creator (acted on — not a rejection): “Fix the reviewer\'s failing items”');
  });

  it('a cancel with no story on record stays the plain "Run cancelled." — nothing is invented', () => {
    const view = makeView({ status: 'cancelled' });
    useProvenanceStore.setState((s) => ({
      rejectNotes: { ...s.rejectNotes, [view.session.id]: null },
      cancelStories: { ...s.cancelStories, [view.session.id]: { rejectNote: null, sendBackNote: null, engineTimedOut: false } },
    }));
    render(<FailureBanner view={view} log={[]} />);
    const banner = screen.getByTestId('failure-banner');
    expect(banner).toHaveAttribute('data-cause', 'unattributed');
    expect(banner.textContent).toContain('Run cancelled.');
    expect(banner).not.toHaveTextContent('the engine stopped it');
    expect(screen.queryByTestId('failure-send-back-note')).toBeNull();
  });

  it('a real rejection still reads "You rejected it" even when a turn also timed out', () => {
    const view = makeView({ status: 'cancelled' });
    useProvenanceStore.setState((s) => ({
      rejectNotes: { ...s.rejectNotes, [view.session.id]: 'not this week' },
      cancelStories: { ...s.cancelStories, [view.session.id]: { rejectNote: 'not this week', sendBackNote: 'earlier send-back', engineTimedOut: true } },
    }));
    render(<FailureBanner view={view} log={[]} />);
    expect(screen.getByTestId('failure-banner')).toHaveAttribute('data-cause', 'rejected');
    expect(screen.getByTestId('failure-reject-note')).toHaveTextContent('You rejected it: “not this week”');
    expect(screen.queryByTestId('failure-send-back-note')).toBeNull();
  });
});
