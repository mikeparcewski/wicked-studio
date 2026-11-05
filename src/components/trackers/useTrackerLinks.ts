import { useCallback, useEffect, useRef, useState } from 'react';
import { readErrorKind } from '../../api/errors.js';
import { trackerLinksOf, trackerRefusal, trackersApi, type TrackerLinksResponse } from '../../api/trackers.js';

/** One read of `GET /tracker-links` for a target, as a card shows it. */
export type TrackerLinksRead =
  | { phase: 'loading' }
  | { phase: 'ok'; links: TrackerLinksResponse }
  /** crew answered, but not its whole answer for this target: said, never shown as a shorter list. */
  | { phase: 'unreadable' }
  | { phase: 'failed'; kind: 'offline' | 'error'; message: string };

/**
 * Reads crew's links for one target (a project, a repo, or a job's project and repo) while `enabled`. Only the newest
 * read for the CURRENT target lands: a slow answer for the previous project or a read older than a removal never
 * shows. `reload` reads again (after a link or a removal: the card shows crew's answer, never a guess).
 */
export function useTrackerLinks(target: { project?: string | null; repo?: string | null }, enabled: boolean, refresh = ''): { read: TrackerLinksRead; reload: () => Promise<void> } {
  const project = target.project ?? null;
  const repo = target.repo ?? null;
  const key = `${project ?? ''}\u0000${repo ?? ''}`;
  const [state, setState] = useState<{ key: string; read: TrackerLinksRead }>({ key, read: { phase: 'loading' } });
  const gen = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const reload = useCallback(async (): Promise<void> => {
    if (!enabled || (project === null && repo === null)) return;
    const mine = ++gen.current;
    try {
      const raw = await trackersApi.links({ project, repo });
      if (!mounted.current || mine !== gen.current) return;
      const links = trackerLinksOf(raw, { project, repo });
      setState({ key, read: links === null ? { phase: 'unreadable' } : { phase: 'ok', links } });
    } catch (e) {
      if (!mounted.current || mine !== gen.current) return;
      setState({ key, read: { phase: 'failed', kind: readErrorKind(e), message: trackerRefusal(e, 'read') } });
    }
  }, [enabled, project, repo, key]);
  // A new target starts from "loading"; a `refresh` change (the project's repositories changed) reads again in place.
  useEffect(() => {
    setState((cur) => (cur.key === key ? cur : { key, read: { phase: 'loading' } }));
    void reload();
  }, [reload, key, refresh]);
  return { read: state.key === key ? state.read : { phase: 'loading' }, reload };
}
