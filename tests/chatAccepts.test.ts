import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-CATALOG-002 §4.6: studio declares what it renders. With `GET /health.capabilities.chatJobProposals`, a chat's
 * open (`POST /chats`) and each message (`POST /chats/:id/messages`) carry `accepts: ['job']` (crew makes a job proposal
 * only for a chat whose newest declaration accepts it). Without the capability the request is exactly today's: an
 * older daemon's strict body would refuse the field.
 */

const { api } = await import('../src/api/client.js');
const { useCapabilities } = await import('../src/store/capabilities.js');

const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];
beforeEach(() => {
  bodies.length = 0;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    bodies.push({ path: new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, ''), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return Promise.resolve(new Response(JSON.stringify({ chatId: 'c1', seats: [], turnId: 't1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); useCapabilities.setState({ chatJobProposals: false }); });

describe('accepts: ["job"]', () => {
  it('is declared on the open and on each message when the daemon serves job proposals', async () => {
    useCapabilities.setState({ chatJobProposals: true });
    await api.openChat({ chatId: 'c1', scopeKind: 'system' });
    await api.sendChatMessage('c1', 'fix the double charge');
    expect(bodies).toEqual([
      { path: '/chats', body: { chatId: 'c1', scopeKind: 'system', accepts: ['job'] } },
      { path: '/chats/c1/messages', body: { text: 'fix the double charge', accepts: ['job'] } },
    ]);
  });

  it('is absent without the capability: an older daemon gets exactly today’s request', async () => {
    useCapabilities.setState({ chatJobProposals: false });
    await api.openChat({ chatId: 'c1', scopeKind: 'system' });
    await api.sendChatMessage('c1', 'fix the double charge', undefined, ['a1']);
    expect(bodies).toEqual([
      { path: '/chats', body: { chatId: 'c1', scopeKind: 'system' } },
      { path: '/chats/c1/messages', body: { text: 'fix the double charge', attachments: ['a1'] } },
    ]);
  });
});
