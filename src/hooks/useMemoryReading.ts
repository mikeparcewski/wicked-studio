import { useEffect, useState } from 'react';
import { isMemoryUnsupported, memoryCoverage } from '../api/memory.js';
import type { MemoryReading } from '../board/deskModel.js';

/**
 * How much memory the workspace holds (`GET /memory/coverage`, all scopes), for the Desk's setup items
 * (operator 2026-10-17: "if user just installed it's not unreachable, just may not have data"). Read once
 * when the Desk opens: `ok` with the total, `down` with the daemon's reason when the read fails, and
 * `unknown` for a daemon without the route (never read as empty).
 */
export function useMemoryReading(enabled: boolean): MemoryReading {
  const [reading, setReading] = useState<MemoryReading>({ state: 'unknown' });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    memoryCoverage().then(
      // A coverage answer without a total says nothing about emptiness.
      (c) => { if (live) setReading(typeof c.total === 'number' && Number.isFinite(c.total) ? { state: 'ok', total: c.total } : { state: 'unknown' }); },
      (e: unknown) => {
        if (!live) return;
        setReading(isMemoryUnsupported(e) ? { state: 'unknown' } : { state: 'down', reason: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => { live = false; };
  }, [enabled]);
  return reading;
}
