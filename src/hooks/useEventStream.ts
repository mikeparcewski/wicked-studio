import { useEffect, useRef } from 'react';
import { useConnectionStore } from '../store/connection.js';
import { wsBase } from '../api/client.js';
import type { CoreEvent } from '../api/types.js';

/**
 * The daemon fans the Rust core's `CoreEvent` stream out to `/ws` verbatim: each
 * frame is a tagged-JSON object `{ type, ...fields }` (DES-STUDIO-001 §2.1). This
 * hook parses each frame and hands it to `onEvent`, which switches on `type`.
 * Unknown / future variants (campaign*, terminal*) are simply passed through —
 * the consumer's switch ignores them, so the stream is additive-safe (§5.1).
 *
 * Late-join gets no replay; the studio reconciles run state with a one-shot
 * `GET /runs` on (re)connect (owned by the runs hook), merged with the daemon
 * gate cache (§3.3).
 */
type EventHandler = (event: CoreEvent) => void;

export function useEventStream(onEvent: EventHandler): void {
  const setStatus = useConnectionStore((s) => s.setStatus);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    // cancelledRef gates reconnect loops; activeWs lets cleanup close the socket.
    // Both live inside the effect so React 18 StrictMode's synthetic remount gets a
    // fresh pair and the first mount's socket is terminated by the cleanup function.
    let cancelled = false;
    let activeWs: WebSocket | null = null;

    function connect(): void {
      if (cancelled) return;
      const ws = new WebSocket(`${wsBase()}/ws`);
      activeWs = ws;

      // Gate every handler on `activeWs === ws` so stale sockets from a previous
      // connect cycle (e.g. slow-connecting socket that gets superseded on reconnect)
      // cannot update global status or dispatch events after they're replaced.
      ws.onopen = () => { if (activeWs === ws) setStatus('connected'); };

      ws.onmessage = (msg) => {
        if (activeWs !== ws) return;
        try {
          const parsed: unknown = JSON.parse(String(msg.data));
          // A CoreEvent frame is always a tagged object with a string `type`.
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            typeof (parsed as { type?: unknown }).type === 'string'
          ) {
            onEventRef.current(parsed as CoreEvent);
          }
        } catch {
          /* malformed frame — skip (additive-safe) */
        }
      };

      ws.onclose = () => {
        if (activeWs === ws) setStatus('disconnected');
        // Only reconnect if the hook is still mounted (not cleaned up).
        if (!cancelled) setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (activeWs && activeWs.readyState !== WebSocket.CLOSED && activeWs.readyState !== WebSocket.CLOSING) {
        activeWs.close();
      }
      activeWs = null;
    };
  }, [setStatus]);
}
