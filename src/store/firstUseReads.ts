import { create } from 'zustand';
import { api } from '../api/client.js';
import { readSetup, realProjects, setupSettled, setupChecks, UNCHECKED_SETUP, type SetupChecks, type SetupState } from '../board/firstUse.js';
import { getDiagnostics } from '../api/diagnostics.js';
import { getSystem } from '../api/system.js';
import type { ReadState } from './agentsReads.js';

/**
 * FIRST USE'S OWN READS (DES-seats-page §5.1): `GET /settings` (`studio.setup`), `GET /repos` and
 * `GET /projects`, shared by the landing rule and the setup steps. The roster side
 * comes from the Agents reads. A failed read means no decision (no redirect, nothing persisted).
 */
export interface FirstUseReads {
  setup: SetupState;
  checks: SetupChecks;
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
/** The `studio.setup` write in flight: a second save waits on it, never claims success early (codex #759 r1). */
let saving: Promise<boolean> | null = null;

export const useFirstUseReads = create<FirstUseReads>((set, get) => ({
  setup: {},
  checks: UNCHECKED_SETUP,
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
    // Settings first: only an explicit skip lets the landing omit the readiness reads.
    inflight = Promise.resolve().then(() => api.getAppearanceSettings())
      .then(async (s) => {
        // Keep a local completion/skip while its save is in flight; readiness still uses live checks.
        const keep = (): ReturnType<typeof readSetup> => ((get().setup.completedAt !== undefined || setupSettled(get().setup)) ? get().setup : readSetup(s?.settings));
        const setup = keep();
        set({ setup });
        if (setupSettled(setup) && !full) { set({ setup, state: 'ok' }); return; }
        const checksRead = (async (): Promise<SetupChecks> => {
          const [health, diagnostics] = await Promise.allSettled([
            Promise.resolve().then(() => api.getHealth()), getDiagnostics(),
          ]);
          const h = health.status === 'fulfilled' ? health.value : null;
          let snapshot = null;
          if (h?.capabilities?.system === true) {
            try { snapshot = await getSystem(); } catch { /* Keep absent readings unknown. */ }
          }
          return setupChecks(snapshot, h, diagnostics.status === 'fulfilled' ? diagnostics.value : null);
        })();
        const [r, p, checks] = await Promise.all([api.listRepos(), api.listProjects(), checksRead]);
        if (!Array.isArray(r?.repos) || !Array.isArray(p?.projects)) throw new Error('first use: no list');
        set({ setup: keep(), checks, repos: r.repos.length, projects: realProjects(p.projects), counted: true, state: 'ok' });
      })
      .catch(() => set({ checks: UNCHECKED_SETUP, state: 'failed' }))
      .finally(() => { inflight = null; });
    return inflight;
  },
  save: (patch) => {
    // Only over a setup this load has READ (never over an unread completedAt), and once (codex S4 r2).
    if (saving !== null) return saving;
    if (get().state !== 'ok' || setupSettled(get().setup) || patch.completedAt !== undefined && get().setup.completedAt !== undefined) return Promise.resolve(get().state === 'ok');
    const before = get().setup;
    const next = { ...before, ...patch };
    set({ setup: next, saveFailed: false });
    const write: Promise<boolean> = api.putSetupSettings(next).then(() => true, () => {
      // Roll back so the next load (or a click) can try again; the steps say it wasn't saved.
      if (saving === write) set({ setup: before, saveFailed: true });
      return false;
    }).finally(() => { if (saving === write) saving = null; });
    saving = write;
    return write;
  },
}));

/** Tests only. */
export function resetFirstUseReads(): void {
  inflight = null;
  inflightFull = false;
  saving = null;
  useFirstUseReads.setState({ setup: {}, checks: UNCHECKED_SETUP, repos: 0, projects: 0, counted: false, saveFailed: false, state: 'idle' });
}
