import { expect, it } from 'vitest';
import { offersSkipQeHere } from '../src/board/qeSkip.js';

it('E: a quoted skip offer before the last engine arms is no offer', () => {
  const quote = 'skip QE acceptance with a written reason (action `skip_qe`: the step counts)';
  expect(offersSkipQeHere(`Failure quoted: ${quote}. Or confirm to retry the phase, or reject to cancel.`)).toBe(false);
  expect(offersSkipQeHere(quote)).toBe(false);
  expect(offersSkipQeHere(`Failure. Or confirm to retry the phase, ${quote}, or reject to cancel.`)).toBe(true);
});
