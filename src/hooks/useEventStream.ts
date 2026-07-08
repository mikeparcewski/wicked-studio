import { useEffect, useRef, useCallback } from 'react';
import { useConnectionStore } from '../store/connection.js';

export type CrewEvent = {
  type: string;
  payload: Record<string, unknown>;
  ts: string;
};

type EventHandler = (event: CrewEvent) => void;

export function useEventStream(onEvent: EventHandler): void {
  const setStatus = useConnectionStore((s) => s.setStatus);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    const ws = new WebSocket('ws://127.0.0.1:7701/ws');

    ws.onopen = () => setStatus('connected');

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(String(msg.data)) as CrewEvent;
        onEventRef.current(event);
      } catch { /* malformed message — skip */ }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      setStatus('disconnected');
      ws.close();
    };
  }, [setStatus]);

  useEffect(() => {
    connect();
    // No cleanup needed — WebSocket reconnects on close
  }, [connect]);
}
