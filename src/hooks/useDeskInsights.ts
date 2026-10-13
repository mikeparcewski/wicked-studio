import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { ChatOpenBody } from '../api/types.js';
import { defaultSelection } from '../board/chatOpen.js';
import { getCachedRoster, setCachedRoster } from '../store/rosterCache.js';
import { useAskThreadStore } from '../store/askThread.js';

/**
 * "GENERATE INSIGHTS" ON UNDERSTAND (DES-desk-v2 §0.5): an inferred read of the comparison, through
 * the EXISTING Ask path. No new backend: it opens a chat exactly as the Ask dock does
 * (`POST /chats`, scope `system`, the roster's chat-eligible seats), sends ONE message
 * (`POST /chats/:id/messages`) carrying the numbers on screen and the evidence links, and reads the
 * reply from the frames the socket already folds into the Ask thread store (`chatDelta` /
 * `chatReply`). Then it closes the chat. It runs only on a click; the result is cached here per
 * selection (client-side, this page load) until regenerated or the selection changes.
 */

export type InsightState =
  | { phase: 'idle' }
  | { phase: 'loading'; text: string; chatId: string | null }
  | { phase: 'done'; text: string; at: number }
  | { phase: 'error'; error: string };

const cache = new Map<string, InsightState>();
const listeners = new Set<() => void>();
const emit = (): void => { for (const l of listeners) l(); };
const set = (key: string, s: InsightState): void => { cache.set(key, s); emit(); };

/** How long a reply may take before the panel says it gave up waiting (the chat is closed then). */
export const INSIGHT_TIMEOUT_MS = 180_000;

async function seats(): Promise<string[]> {
  let roster = getCachedRoster();
  if (roster === null) {
    const { roster: fetched } = await api.getRoster();
    setCachedRoster(fetched);
    roster = fetched;
  }
  // One seat answers (the first chat-eligible one, as the dock's default selection orders them).
  return defaultSelection(roster, false).slice(0, 1);
}

/** Per key, the newest request: an older one that answers late never overwrites it. */
const generation = new Map<string, number>();

export async function generateInsights(key: string, prompt: string): Promise<void> {
  const chatId = crypto.randomUUID();
  const gen = (generation.get(key) ?? 0) + 1;
  generation.set(key, gen);
  set(key, { phase: 'loading', text: '', chatId });
  let done = false;
  let opening = false;
  let unsub: (() => void) | null = null;
  // Settles once. The chat is closed whenever an open was attempted (closing an unknown id is harmless).
  const finish = (s: InsightState): void => {
    if (done) return;
    done = true;
    unsub?.();
    clearTimeout(timer);
    if (generation.get(key) === gen) set(key, s);
    if (opening) void api.closeChat(chatId).catch(() => undefined);
  };
  // The deadline covers every step: the roster read, opening the chat, sending and the reply.
  const timer = setTimeout(() => finish({ phase: 'error', error: 'No answer after 3 minutes. Try again.' }), INSIGHT_TIMEOUT_MS);
  try {
    const clis = await seats();
    if (done) return;
    if (clis.length === 0) throw new Error('No agent is signed in and able to chat, so nothing can answer.');
    const body: ChatOpenBody = { chatId, scopeKind: 'system', clis };
    opening = true;
    const opened = await api.openChat(body);
    if (done) { void api.closeChat(chatId).catch(() => undefined); return; } // gave up while it opened: never send
    if (!opened.seats.some((s) => s.ok)) throw new Error(`No agent came up to answer (${opened.seats.map((s) => `${s.cliKey}: ${s.error ?? 'failed'}`).join('; ') || 'none'}).`);
    const read = (): void => {
      if (done) return;
      const turns = useAskThreadStore.getState().turns[chatId] ?? [];
      const reply = [...turns].reverse().find((t) => t.who !== 'you');
      if (reply === undefined) return;
      if (reply.pending) { if (generation.get(key) === gen) set(key, { phase: 'loading', text: reply.text, chatId }); }
      else if (reply.ok === false) finish({ phase: 'error', error: reply.text.trim() !== '' ? reply.text : 'The agent could not answer.' });
      else finish({ phase: 'done', text: reply.text, at: Date.now() });
    };
    unsub = useAskThreadStore.subscribe(read);
    await api.sendChatMessage(chatId, prompt);
    read();
  } catch (e) {
    finish({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

export function useDeskInsights(key: string): InsightState {
  const [, bump] = useState(0);
  useEffect(() => { const l = (): void => bump((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return cache.get(key) ?? { phase: 'idle' };
}

/** Test hook. */
export function resetDeskInsights(): void { cache.clear(); generation.clear(); emit(); }
