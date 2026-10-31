import { describe, it, expect } from 'vitest';
import { launchChatId } from '../src/components/launch/launchChatId.js';

describe('launchChatId — only a real chat id rides a launch', () => {
  it('a chat composer key is the chat the run lands in', () => {
    expect(launchChatId('chat-7f3a', true)).toBe('chat-7f3a');
  });
  it('the repository page\'s key (repo:<id>) is not a chat: crew would 400 it', () => {
    expect(launchChatId('repo:tiny-math', true)).toBeNull();
  });
  it('the desk, a run, no key, or a daemon without the capability send none', () => {
    expect(launchChatId('desk', true)).toBeNull();
    expect(launchChatId('run:abc', true)).toBeNull();
    expect(launchChatId(null, true)).toBeNull();
    expect(launchChatId('chat-7f3a', false)).toBeNull();
    expect(launchChatId('chat-7f3a', undefined)).toBeNull();
  });
});
