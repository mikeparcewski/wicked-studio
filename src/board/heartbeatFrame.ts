/**
 * A frame that proves a seat is alive but says nothing it did (studio#1368): the engine's `heartbeat`, and a quiet
 * seat's `toolActivity` frame in state `working`, sent every 15 s while the seat prints nothing (core#1207). Crew keeps
 * both off its stall clock (crew#1501, `isHeartbeatFrame` in crew's stall watchdog); every studio clock does the same,
 * so a wedged seat that still heartbeats reads silent, then stalled, never "Working".
 */
export function isHeartbeatFrame(event: { type?: unknown; state?: unknown; kind?: unknown }): boolean {
  return event.type === 'heartbeat' || (event.type === 'toolActivity' && (event.state === 'working' || event.kind === 'working'));
}
