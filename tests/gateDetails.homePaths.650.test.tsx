import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * studio#650 (codex r1): the rest of the gate's Details — the verdict diff's criteria, claims and
 * note, and the reviewed phase's "output unavailable" sentence — draw home paths as `~/…` and the
 * macOS per-user temp dir as `$TMPDIR`, like the raw prompt above them.
 */

const HOME = '/Users/reel-operator/wicked-rig/repos/library-booking';
const TMP = '/var/folders/q1/abc123/T/guard.exclude';

vi.mock('../src/hooks/useVerdictDiff.js', () => ({
  useVerdictDiff: () => ({
    creator: 'build',
    state: 'ready',
    rows: [{ criterion: `the tree at ${HOME} is unchanged`, claim: `left ${TMP} in place` }],
    note: `the creator's transcript at ${HOME}/out.txt was truncated`,
  }),
}));
vi.mock('../src/api/client.js', () => ({
  api: { getUnitOutput: () => Promise.resolve({ output: null, outputUnavailable: `no transcript: ${HOME}/wicked-worktrees/r1 is gone` }) },
}));

const { VerdictDiff } = await import('../src/components/VerdictDiff.js');
const { GateUnderReview } = await import('../src/components/GateUnderReview.js');
const { makeUnit } = await import('./factories.js');

afterEach(cleanup);

describe('gate Details: worker and engine text is masked (studio#650)', () => {
  it('the verdict diff: criterion, claim and note', () => {
    render(<VerdictDiff runId="r1" units={[]} reviewedOrd={null} items={['x']} />);
    fireEvent.click(screen.getByTestId('verdict-diff-toggle'));
    expect(screen.getByTestId('verdict-diff-criterion')).toHaveTextContent('the tree at ~/wicked-rig/repos/library-booking is unchanged');
    expect(screen.getByTestId('verdict-diff-claim')).toHaveTextContent('left $TMPDIR/guard.exclude in place');
    expect(screen.getByTestId('verdict-diff-note')).toHaveTextContent("the creator's transcript at ~/wicked-rig/repos/library-booking/out.txt was truncated");
    expect(screen.getByTestId('verdict-diff').textContent).not.toMatch(/reel-operator|\/var\/folders/);
  });

  it('the reviewed phase\'s "output unavailable" sentence', async () => {
    const unit = makeUnit({ ord: 1 });
    render(<GateUnderReview runId="r1" units={[unit]} reviewed={unit} next={null} />);
    const details = screen.getByTestId('gate-under-review').querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(await screen.findByTestId('gate-under-review-note')).toHaveTextContent('no transcript: ~/wicked-rig/repos/library-booking/wicked-worktrees/r1 is gone');
  });
});
