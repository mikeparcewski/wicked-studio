// S16a-4e + concept A (DES-frontdoor): a new chat opens the Ask dock — fresh in the named project —
// and sends nothing (the Desk has no composer any more).
import { afterEach, describe, expect, it } from 'vitest';
import { seedNewChat } from '../src/board/chatMoves.js';
import { useAskDock } from '../src/store/askDock.js';

afterEach(() => { useAskDock.setState({ request: null }); });

describe('S16a-4e — a new chat', () => {
  it('opens the Ask dock scoped to the project, with nothing typed and nothing sent', () => {
    seedNewChat('notes');
    expect(useAskDock.getState().request).toMatchObject({ projectId: 'notes', seedText: '', fresh: true });
  });

  it('outside a project (or Unfiled) it opens the dock with its own default scope', () => {
    seedNewChat('default');
    expect(useAskDock.getState().request?.projectId).toBeNull();
    const first = useAskDock.getState().request!.nonce;
    seedNewChat(null);
    expect(useAskDock.getState().request!.nonce).toBe(first + 1);
  });
});
