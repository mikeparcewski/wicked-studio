// S16a-4e: a chat IS its session — the chat addresses move; a new chat starts in the Desk composer.
import { afterEach, describe, expect, it } from 'vitest';
import { chatSessionMove, newChatOf, seedNewChat } from '../src/board/chatMoves.js';
import { parseRoute } from '../src/hooks/useRoute.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { useSessionDrafts } from '../src/store/sessionDrafts.js';

afterEach(() => { useComposerChips.setState({ byComposer: {} } as never); });

describe('S16a-4e — the chat moves', () => {
  it('/chat/:id → /s/:id and /p/:pid/chat/:run → /s/run%3A:run, search and hash kept', () => {
    expect(chatSessionMove('/chat/chat-pay', '?x=1', '#gate')).toBe('/s/chat-pay?x=1#gate');
    expect(chatSessionMove('/p/notes/chat/r9', '', '')).toBe('/s/run%3Ar9');
    expect(chatSessionMove('/chat/new', '', '')).toBeNull();
    expect(chatSessionMove('/p/notes/chat', '', '')).toBeNull();
    expect(parseRoute('/chat/chat-pay')).toMatchObject({ panel: 'session', artifactId: 'chat-pay' });
    expect(parseRoute('/chat/chat-pay/x').panel).toBe('not-found');
  });

  it('the new-chat forms land on the Desk (with the project when named)', () => {
    expect(newChatOf('/chat/new')).toStrictEqual({ projectId: null });
    expect(newChatOf('/p/notes/chat')).toStrictEqual({ projectId: 'notes' });
    expect(newChatOf('/p/notes/chat/new')).toStrictEqual({ projectId: 'notes' });
    expect(newChatOf('/p/notes/chat/r9')).toBeNull();
    expect(parseRoute('/chat/new').panel).toBe('home');
    expect(parseRoute('/p/notes/chat').panel).toBe('home');
  });

  it('seeding a new chat puts the project\'s @ chip on the Desk composer and sends nothing', () => {
    seedNewChat('notes', 'Notes');
    const chips = (useComposerChips.getState() as unknown as { byComposer: Record<string, { kind: string; projectId?: string }[]> }).byComposer['desk'] ?? [];
    expect(chips.some((c) => c.kind === 'project' && c.projectId === 'notes')).toBe(true);
    expect(useSessionDrafts.getState().drafts['desk'] ?? '').toBe('');
  });
});
