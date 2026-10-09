// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composerScopeNote, SEPARATE_ASK_NOTE } from '../src/board/sessionModel.js';
import type { SessionView } from '../src/api/types.js';

/** studio#606 (4): the session composer says Send starts a separate Ask while a run here is live. */

const run = (status: string): SessionView => ({ session: { id: `r-${status}`, status } } as unknown as SessionView);

describe('composerScopeNote', () => {
  it('a live run in the session: Send is a separate Ask, said before Send', () => {
    expect(composerScopeNote([run('executing')], false)).toBe(SEPARATE_ASK_NOTE);
    expect(composerScopeNote([run('completed'), run('awaiting_human')], false)).toBe(SEPARATE_ASK_NOTE);
    expect(SEPARATE_ASK_NOTE).toContain('does not steer this one');
  });
  it('nothing live, or a live chat that the text replies into: no note', () => {
    expect(composerScopeNote([], false)).toBeNull();
    expect(composerScopeNote([run('completed'), run('failed'), run('cancelled')], false)).toBeNull();
    expect(composerScopeNote([run('executing')], true)).toBeNull();
  });
});
