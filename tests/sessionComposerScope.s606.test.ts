// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composerScopeNote, MESSAGE_JOB_NOTE, SEPARATE_ASK_NOTE } from '../src/board/sessionModel.js';
import type { SessionView } from '../src/api/types.js';

/** studio#606 (4): the session composer says Send starts a separate Ask while a run here is live. */

const run = (status: string): SessionView => ({ session: { id: `r-${status}`, status } } as unknown as SessionView);
/** An ask turn's run (`ask_path`): studio#1442 keeps the plain note for these. */
const ask = (status: string): SessionView => ({ session: { id: `a-${status}`, status, ask_path: true } } as unknown as SessionView);

describe('composerScopeNote', () => {
  it('a live run in the session: Send is a separate Ask, said before Send', () => {
    expect(composerScopeNote([ask('executing')], false)).toBe(SEPARATE_ASK_NOTE);
    expect(composerScopeNote([run('completed'), ask('awaiting_human')], false)).toBe(SEPARATE_ASK_NOTE);
    expect(SEPARATE_ASK_NOTE).toContain('does not steer this one');
  });
  it('studio#1442: a live job here also names where a message for it goes, in a live chat too', () => {
    expect(composerScopeNote([run('executing')], false)).toBe(MESSAGE_JOB_NOTE);
    expect(composerScopeNote([run('executing')], true)).toBe(MESSAGE_JOB_NOTE);
    expect(MESSAGE_JOB_NOTE).toContain('does not steer this one');
  });
  it('nothing live, or a live chat of asks that the text replies into: no note', () => {
    expect(composerScopeNote([], false)).toBeNull();
    expect(composerScopeNote([run('completed'), run('failed'), run('cancelled')], false)).toBeNull();
    expect(composerScopeNote([ask('executing')], true)).toBeNull();
  });
});
