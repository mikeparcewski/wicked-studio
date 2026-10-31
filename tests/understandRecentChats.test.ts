import { describe, expect, it } from 'vitest';
import { askedWithChats } from '../src/board/understandModel.js';

// Round-3 look on :7721: a page chat asked from Understand (run debf4287) was not in Recent answers, which read only
// this browser's memory. Crew's chat history lists every chat started on Understand, in flight or finished.
describe('Recent answers from crew\'s chat history', () => {
  const chat = (id: string, title: string, route: string | null, createdAt: string) => ({ id, title, startedOn: route === null ? null : { route }, createdAt });
  it('lists Understand\'s chats, in flight or finished, merged with this browser\'s, newest first', () => {
    const merged = askedWithChats(
      [{ chatId: 'b', question: 'Who calls the deliver step?', at: Date.parse('2026-10-31T08:00:00Z') }],
      [
        chat('a', 'Read-only question, change nothing: in one short paragraph, where does wicked-c…', '/understand', '2026-10-31T07:33:27Z'),
        chat('b', 'Who calls the deliver step? Answer from the code itself and cite the files you read.…', '/understand', '2026-10-31T07:59:00Z'),
        chat('c', 'Convert 5 km', '/mcp', '2026-10-31T09:00:00Z'),
        chat('d', 'New chat', '/understand', '2026-10-31T09:00:00Z'),
        chat('e', 'In a project', '/p/kes/understand', '2026-10-31T06:00:00Z'),
      ],
    );
    expect(merged.map((m) => m.chatId)).toEqual(['b', 'a', 'e']);
    expect(merged[0]!.question).toBe('Who calls the deliver step?');
    expect(merged[1]!.question).toBe('Read-only question, change nothing: in one short paragraph, where does wicked-c');
  });
  it('reads as this browser\'s list when crew has none', () => {
    expect(askedWithChats([{ chatId: 'x', question: 'Q', at: 1 }], null)).toEqual([{ chatId: 'x', question: 'Q', at: 1 }]);
  });
});
