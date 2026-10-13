import { create } from 'zustand';
import { api } from '../api/client.js';
import { readSetup, realProjects, setupSettled, type SetupState } from '../board/firstUse.js';
import type { ReadState } from './agentsReads.js';

/**
 * FIRST USE'S OWN READS (DES-seats-page §5.1): `GET /settings` (`studio.setup`), `GET /repos` and
 * `GET /projects`, read once and shared by the landing rule and the setup steps. The roster side
 * comes from the Agents reads. A failed read means no decision (no redirect, nothing persisted).
 */
export interface FirstUseReads {
  setup: SetupState;
  repos: number;
  projects: number;
  /** The repository and project counts were read (the landing may skip them for a settled setup). */
  counted: boolean;
  /** The last `studio.setup` write failed: the local setup was rolled back, and nothing retries on its own. */
  saveFailed: boolean;
  state: ReadState;
  /** `full`: read the counts even when setup is settled (the Setup guide shows them). */
  load: (full?: boolean) => Promise<void>;
  /** Persist `studio.setup` once (completed or skipped): a settled setup is never written again. */
  save: (patch: SetupState) => Promise<boolean>;
}

let inflight: Promise<void> | null = null;
let inflightFull = false;

export const useFirstUseReads = create<FirstUseReads>((set, get) => ({
  setup: {},
  repos: 0,
  projects: 0,
  counted: false,
  saveFailed: false,
  state: 'idle',
  load: (full = false) => {
    // A full read asked for while a settings-only one is out chains after it (codex S4 r2).
    if (inflight !== null) return full && !inflightFull ? inflight.then(() => (get().counted ? undefined : get().load(true))) : inflight;
    inflightFull = full;
    set({ state: 'loading' });
    // Settings first: for the landing, a finished (or skipped) setup needs nothing else.
    inflight = api.getAppearanceSettings()
      .then(async (s) => {
        // A setup settled here (saved, or being saved) is never reopened by a read (codex S4 r1, r3).
        const keep = (): ReturnType<typeof readSetup> => (setupSettled(get().setup) ? get().setup : readSetup(s?.settings));
        const setup = keep();
        if (setupSettled(setup) && !full) { set({ setup, state: 'ok' }); return; }
        const [r, p] = await Promise.all([api.listRepos(), api.listProjects()]);
        if (!Array.isArray(r?.repos) || !Array.isArray(p?.projects)) throw new Error('first use: no list');
        set({ setup: keep(), repos: r.repos.length, projects: realProjects(p.projects), counted: true, state: 'ok' });
      })
      .catch(() => set({ state: 'failed' }))
      .finally(() => { inflight = null; });
    return inflight;
  },
  save: (patch) => {
    // Only over a setup this load has READ (never over an unread completedAt), and once (codex S4 r2).
    if (get().state !== 'ok' || setupSettled(get().setup)) return Promise.resolve(get().state === 'ok');
    const before = get().setup;
    const next = { ...before, ...patch };
    set({ setup: next, saveFailed: false });
    return api.putSetupSettings(next).then(() => true, () => {
      // Roll back so the next load (or a click) can try again; the steps say it wasn't saved.
      set({ setup: before, saveFailed: true });
      return false;
    });
  },
}));

/** Tests only. */
export function resetFirstUseReads(): void {
  inflight = null;
  inflightFull = false;
  useFirstUseReads.setState({ setup: {}, repos: 0, projects: 0, counted: false, saveFailed: false, state: 'idle' });
}
