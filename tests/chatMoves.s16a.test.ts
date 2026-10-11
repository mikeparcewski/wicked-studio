// S16a-4e: a new chat starts in the Desk composer (X1 retired the `/chat/…` addresses).
import { afterEach, describe, expect, it } from 'vitest';
import { seedNewChat } from '../src/board/chatMoves.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { useSessionDrafts } from '../src/store/sessionDrafts.js';

afterEach(() => { useComposerChips.setState({ byComposer: {} } as never); });

describe('S16a-4e — a new chat', () => {
  it('seeding a new chat puts the project\'s @ chip on the Desk composer and sends nothing', () => {
    seedNewChat('notes', 'Notes');
    const chips = (useComposerChips.getState() as unknown as { byComposer: Record<string, { kind: string; projectId?: string }[]> }).byComposer['desk'] ?? [];
    expect(chips.some((c) => c.kind === 'project' && c.projectId === 'notes')).toBe(true);
    expect(useSessionDrafts.getState().drafts['desk'] ?? '').toBe('');
  });
});
