import { useEffect, useRef, useCallback } from 'react';
import { useConnectionStore } from '../store/connection.js';
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

  const connect = useCallback(() => {
    const ws = new WebSocket('ws://127.0.0.1:7701/ws');

    ws.onopen = () => setStatus('connected');

    ws.onmessage = (msg) => {
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
      setStatus('disconnected');
      // Reconnect after 3s; the runs hook re-reconciles on the next 'connected'.
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      setStatus('disconnected');
      ws.close();
    };
  }, [setStatus]);

  useEffect(() => {
    connect();
    // No cleanup — the socket reconnects itself on close.
  }, [connect]);
}
