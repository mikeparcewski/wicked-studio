import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import * as rowModel from '../src/board/gateRowModel.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import type { OpenGate } from '../src/store/gates.js';
import { makeView } from './factories.js';
import { BOUNDARY_DENIAL, BOUNDARY_EVENTS, BOUNDARY_PROMPT, BOUNDARY_REFUSED, BOUNDARY_RUN, BOUNDARY_UNITS } from './fixtures/gateMove.js';

const gate: OpenGate = { runId: BOUNDARY_RUN, ord: 3, gateKind: 'escalation', prompt: BOUNDARY_PROMPT, lifecycle: 'open', receivedAt: 1_700_000_000_000 };
const evaluation = (denial: unknown, attempt = 1, ord = 3): CoreEvent => ({ type: 'gateEvaluated', session: BOUNDARY_RUN, ord, attempt, denial }) as unknown as CoreEvent;
function show(events = BOUNDARY_EVENTS): void {
  useRunEventStore.setState({ byRun: { [BOUNDARY_RUN]: events } });
  render(<GateRow view={makeView({ id: BOUNDARY_RUN, status: 'awaiting_human' }, BOUNDARY_UNITS)} gate={gate} />);
}
beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe('wicked-studio#1255 / wicked-core#1702: refusedCall', () => {
  it('returns the latest attempt for this ord, ignoring evaluations of other units', () => {
    const refused = { ...BOUNDARY_REFUSED, path: '/work/repos/other', command: 'cat /work/repos/other', access: 'read' };
    expect(rowModel.refusedCall([...BOUNDARY_EVENTS, evaluation({ ...BOUNDARY_DENIAL, refused }), evaluation(null, 2, 4)], 3)).toMatchObject({
      tool: 'Bash', path: refused.path, access: 'read', rule: refused.rule, command: refused.command,
    });
  });
  it.each([undefined, null])('returns null when the latest evaluation has no denial (%s)', (denial) => {
    expect(rowModel.refusedCall([...BOUNDARY_EVENTS, evaluation(denial)], 3)).toBeNull();
  });
  it.each([null, [], 'text', { path: '', rule: 'rule' }, { path: '/work', rule: '  ' }].map((refused) => ({ refused })))('rejects incomplete refused data: $refused', ({ refused }) => {
    expect(rowModel.refusedCall([evaluation({ ...BOUNDARY_DENIAL, refused })], 3)).toBeNull();
  });
  it('returns null without events or an evaluation for this ord', () => {
    expect(rowModel.refusedCall(null, 3)).toBeNull();
    expect(rowModel.refusedCall(BOUNDARY_EVENTS, 4)).toBeNull();
  });
});

describe('wicked-studio#1255: boundary denial card', () => {
  it.each([
    { command: 'cd ../..', reason: 'Outside the folder', access: 'write', verb: 'cd into' },
    { command: 'env bash script.sh', reason: 'Bash `cd` leaves the unit boundary', access: 'write', verb: 'cd into' },
    { command: 'touch ../file', reason: 'Outside the folder', access: 'write', verb: 'write to' },
    { command: 'cat ../file', reason: 'Outside the folder', access: 'read', verb: 'read' },
  ])('says $verb from the command, reason, or access', ({ verb, ...fields }) => {
    show([evaluation({ ...BOUNDARY_DENIAL, refused: { ...BOUNDARY_REFUSED, ...fields } }), ...BOUNDARY_EVENTS.slice(1)]);
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === `Tried to ${verb} ${BOUNDARY_REFUSED.path}, outside this job’s folder`)).toBeTruthy();
  });
  it('keeps a long path in the title and shortens only its middle on the face', () => {
    const path = `/work/${'very-long-folder-name/'.repeat(16)}tiny-math`;
    show([evaluation({ ...BOUNDARY_DENIAL, refused: { ...BOUNDARY_REFUSED, path } }), ...BOUNDARY_EVENTS.slice(1)]);
    const shown = screen.getByTitle(path).textContent!;
    expect(shown.length).toBeLessThanOrEqual(72);
    expect(shown).toMatch(/^\/work\/.*….*tiny-math$/);
    expect(screen.getAllByTestId('session-gate-choice').length).toBeGreaterThan(0);
  });
  it.each([
    '/home/alex.rivera/repos/tiny-math',
    '/home/alex/repos/tiny-math',
    'C:\\Users\\Alex\\repos\\tiny-math',
  ])('shows a path under a home folder as ~/… in the text and the tooltip (%s)', (path) => {
    show([evaluation({ ...BOUNDARY_DENIAL, refused: { ...BOUNDARY_REFUSED, path } }), ...BOUNDARY_EVENTS.slice(1)]);
    const shown = screen.getByTitle(/^~[\\/]repos[\\/]tiny-math$/);
    expect(shown.textContent).toMatch(/^~[\\/]repos[\\/]tiny-math$/);
    expect(document.body.textContent).not.toMatch(/alex/i);
  });
  it('does not show a stale refusal after a later evaluation clears the denial', () => {
    show([...BOUNDARY_EVENTS, evaluation(null)]);
    expect(screen.queryByText(/^Tried to /)).toBeNull();
    expect(screen.queryByText(/^Rule:/)).toBeNull();
  });
  it('shows the refused path and rule on the face, keeping the headline', () => {
    show();
    expect(screen.getByTestId('session-gate-question').textContent).toBe('A Bash call was blocked by the job’s rules');
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Tried to cd into /work/repos/tiny-math, outside this job’s folder')).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Rule: engine:filesystem-boundary-write')).toBeTruthy();
    expect(screen.getByTitle(BOUNDARY_REFUSED.path).textContent).toBe(BOUNDARY_REFUSED.path);
    expect(screen.getByText(BOUNDARY_REFUSED.rule).tagName).toBe('CODE');
  });
  it('keeps today’s card when an older engine sends no refused call', () => {
    const denial = { ...BOUNDARY_DENIAL, refused: undefined };
    show([evaluation(denial), ...BOUNDARY_EVENTS.slice(1)]);
    expect(screen.getByTestId('session-gate-question').textContent).toBe('A Bash call was blocked by the job’s rules');
    expect(screen.queryByText(/^Tried to /)).toBeNull();
    expect(screen.queryByText(/^Rule:/)).toBeNull();
  });
});
