import { useEffect, useState } from 'react';
import { getDiagnostics } from '../api/diagnostics.js';

/**
 * This daemon's own rule store path — `GET /diagnostics` `stores[name = core.db]`, the `--db` the
 * engine judges evals against. `undefined` while reading; `null` when the daemon can't say (an older
 * crew without diagnostics, or a failed read): the Evaluate surface then says nothing about stores
 * rather than guessing.
 */
export function useDaemonRuleStore(): string | null | undefined {
  const [path, setPath] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void getDiagnostics()
      .then((d) => { if (!cancelled) setPath(d.stores.find((s) => s.name === 'core.db')?.path ?? null); })
      .catch(() => { if (!cancelled) setPath(null); });
    return () => { cancelled = true; };
  }, []);
  return path;
}
