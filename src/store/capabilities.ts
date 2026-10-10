import { create } from 'zustand';

/**
 * The daemon's `GET /health.capabilities` the session surfaces read (S6a): read once at startup.
 * `runChatId` (C1, api-types 0.71.0) — runs carry `chat_id`, so a chat and its runs are one
 * session. Absent, or a failed read, is `false`: every run is its own session (§7).
 */
interface CapabilitiesStore {
  loaded: boolean;
  runChatId: boolean;
  /** `walkthroughRoots` (WT-W1, api-types 0.74.0) — repo-bound runs get an evidence root, so a
   *  walkthrough step can record; absent, the walkthrough artifact is not offered. */
  walkthroughRoots: boolean;
  /** `askPath` (DES-ASK-TEAM-CHAT-001 §5.1, api-types 0.92.0) — an ask starts a team path: one primary
   *  helper answers, a reviewer watches, help requests are rows on the bus. Absent or false (an older
   *  daemon): every helper answers at once and the thread says so (§8 F13). */
  askPath: boolean;
  /** `chatIdOnLaunch` (crew#619, api-types 0.39.0) — a launch may name the chat it was promoted from
   *  (`POST /runs {chatId}`), so the run lands in that chat's session. Absent or false (an older
   *  daemon): studio sends no key and a launch from a chat opens its own `run:<id>` session (S19a). */
  chatIdOnLaunch: boolean;
  /** `deliverGate` (F-E2E-030; crew 0.7.33 / core-ts 0.7.24) — a delivering launch's push is gated
   *  by a human by default, and an unattended posture may opt out with `deliverGate: 'auto'`. Absent
   *  or false (an older daemon): studio sends no key so the older launch schema never rejects it. */
  deliverGate: boolean;
  /** `reducedAssurance` (wicked-core#850) — a launch may opt into reduced assurance
   *  (`POST /runs {reducedAssurance: true}`). Absent or false (an older daemon): the opt-in is not
   *  offered and the key is never sent. */
  reducedAssurance: boolean;
  load: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useCapabilities = create<CapabilitiesStore>((set, get) => ({
  loaded: false,
  runChatId: false,
  walkthroughRoots: false,
  askPath: false,
  chatIdOnLaunch: false,
  deliverGate: false,
  reducedAssurance: false,
  load: () => {
    if (get().loaded) return Promise.resolve();
    // The HTTP client is reached lazily: the stores that read a capability (gates, the ask thread)
    // import this module, and a store must not pull the client into every importer's module graph.
    inflight ??= import('../api/client.js').then(({ api }) => api.getHealth())
      .then((h) => {
        const caps = ((h as unknown as { capabilities?: Record<string, unknown> }).capabilities) ?? {};
        set({ loaded: true, runChatId: caps['runChatId'] === true, walkthroughRoots: caps['walkthroughRoots'] === true, askPath: caps['askPath'] === true, chatIdOnLaunch: caps['chatIdOnLaunch'] === true, deliverGate: caps['deliverGate'] === true, reducedAssurance: caps['reducedAssurance'] === true });
      })
      .catch(() => { set({ loaded: true, runChatId: false, walkthroughRoots: false, askPath: false, chatIdOnLaunch: false, deliverGate: false, reducedAssurance: false }); })
      .finally(() => { inflight = null; });
    return inflight;
  },
}));
