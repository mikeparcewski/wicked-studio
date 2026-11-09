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
afterEach(() => { vi.unstubAllGlobals(); useCapabilities.setState({ chatJobProposals: false, chatOnboard: false }); });

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

// crew-0182: `onboard` (crew 0.18.2 `chatArtifacts.onboard`): declared only where crew advertises it, beside `job`.
describe('accepts: ["onboard"]', () => {
  it.each([
    [{ chatJobProposals: false, chatOnboard: true }, ['onboard']],
    [{ chatJobProposals: true, chatOnboard: true }, ['job', 'onboard']],
    [{ chatJobProposals: true, chatOnboard: false }, ['job']],
  ])('with %j the open and each message declare %j', async (caps, accepts) => {
    useCapabilities.setState(caps);
    await api.openChat({ chatId: 'c1', scopeKind: 'system' });
    await api.sendChatMessage('c1', 'onboard this');
    expect(bodies).toEqual([
      { path: '/chats', body: { chatId: 'c1', scopeKind: 'system', accepts } },
      { path: '/chats/c1/messages', body: { text: 'onboard this', accepts } },
    ]);
  });

  it('the capability is read from crew\'s health (chatArtifacts.onboard)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'ok', capabilities: { chatArtifacts: { context: true, proposals: true, create: true, refine: true, theme: true, demo: false, onboard: true } } }), { status: 200, headers: { 'content-type': 'application/json' } }))));
    useCapabilities.setState({ loaded: false, chatOnboard: false });
    await useCapabilities.getState().load();
    expect(useCapabilities.getState().chatOnboard).toBe(true);
  });
});
