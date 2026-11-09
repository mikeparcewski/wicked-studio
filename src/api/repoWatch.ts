/**
 * THE REPO WATCHER's wire (crew 0.18.3, api-types 0.201.0): crew keeps each onboarded repository's code map current with
 * no click (`GET /repo-watch`, `PUT /repos/:id/watch`, `POST /repos/:id/graph/reindex`). Declared here, tolerantly, so
 * studio builds against the api-types pin it has; an older crew answers 404 and the surfaces show nothing about it.
 *
 * "Current" covers symbols, files and references for what is on disk now (crew's `covers` sentence says so on the wire);
 * clusters are not re-run by the watcher, so no line here claims them.
 */

import { useEffect } from 'react';
import { create } from 'zustand';

import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';
import { relTime } from '../board/relTime.js';

export interface RepoWatchHold {
  runId: string;
  reason: 'executing' | 'domain-mapping';
}

export type RepoWatchState = 'starting' | 'current' | 'changed' | 'indexing' | 'waiting-runs' | 'failed' | 'off' | 'capped';

export interface RepoGraphWatch {
  repoId: string;
  state: RepoWatchState;
  enabled: boolean;
  lastIndexedAt: number | null;
  lastPolledAt: number | null;
  changedAt: number | null;
  waitingOn: RepoWatchHold[];
  error: string | null;
  remedy: string | null;
}

export interface RepoWatchStatus {
  enabled: boolean;
  disabledBy: 'env' | null;
  cap: number;
  covers: string;
  repos: RepoGraphWatch[];
}

const STATES: ReadonlySet<string> = new Set(['starting', 'current', 'changed', 'indexing', 'waiting-runs', 'failed', 'off', 'capped']);

/** A tolerant reading of `GET /repo-watch`: anything unexpected drops the row, never the page. */
export function readRepoWatch(raw: unknown): RepoWatchStatus | null {
  const o = raw as Partial<RepoWatchStatus> | null;
  if (o === null || typeof o !== 'object' || !Array.isArray(o.repos)) return null;
  const repos = o.repos.flatMap((r): RepoGraphWatch[] => {
    const x = r as Partial<RepoGraphWatch> | null;
    if (x === null || typeof x !== 'object' || typeof x.repoId !== 'string' || typeof x.state !== 'string' || !STATES.has(x.state)) return [];
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
    return [{
      repoId: x.repoId, state: x.state as RepoWatchState, enabled: x.enabled !== false,
      lastIndexedAt: num(x.lastIndexedAt), lastPolledAt: num(x.lastPolledAt), changedAt: num(x.changedAt),
      waitingOn: Array.isArray(x.waitingOn)
        ? x.waitingOn.flatMap((h) => (h !== null && typeof h === 'object' && typeof (h as RepoWatchHold).runId === 'string'
          ? [{ runId: (h as RepoWatchHold).runId, reason: (h as RepoWatchHold).reason === 'domain-mapping' ? 'domain-mapping' as const : 'executing' as const }] : []))
        : [],
      error: str(x.error), remedy: str(x.remedy),
    }];
  });
  return {
    enabled: o.enabled !== false,
    disabledBy: o.disabledBy === 'env' ? 'env' : null,
    cap: typeof o.cap === 'number' ? o.cap : 0,
    covers: typeof o.covers === 'string' ? o.covers : '',
    repos,
  };
}

export const repoWatchApi = {
  get: async (): Promise<RepoWatchStatus | null> => readRepoWatch(await apiFetch<unknown>('/repo-watch')),
  setEnabled: (repoId: string, enabled: boolean) =>
    apiFetch<unknown>(`/repos/${encodeURIComponent(repoId)}/watch`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  reindex: (repoId: string) => apiFetch<unknown>(`/repos/${encodeURIComponent(repoId)}/graph/reindex`, { method: 'POST' }),
};

/** How often an open Repositories list or repo page reads the watcher again. */
export const REPO_WATCH_POLL_MS = 5_000;

interface RepoWatchStore {
  /** `undefined` = not read yet; `null` = this crew has no watcher (an older daemon). */
  status: RepoWatchStatus | null | undefined;
  failed: boolean;
  load: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useRepoWatchStore = create<RepoWatchStore>((set) => ({
  status: undefined,
  failed: false,
  load: () => {
    if (inflight !== null) return inflight;
    inflight = repoWatchApi.get().then(
      (status) => set({ status, failed: false }),
      (e: unknown) => set(isRouteUnsupported(e) ? { status: null, failed: false } : { failed: true }),
    ).finally(() => { inflight = null; });
    return inflight;
  },
}));

/** Test hook. */
export function resetRepoWatch(): void {
  inflight = null;
  useRepoWatchStore.setState({ status: undefined, failed: false });
}

/** The line a repository shows about keeping its code map current: words, a tone, and what it is about. */
export interface WatchLine {
  state: RepoWatchState | 'daemon-off';
  tone: 'ok' | 'busy' | 'wait' | 'bad' | 'quiet';
  words: string;
  /** The remedy (failed), or the limit's (capped). */
  remedy: string | null;
  waitingOn: RepoWatchHold[];
}

/** One repository's watch line, or null when this crew has no watcher or does not watch the repo (not onboarded yet). */
export function watchLine(status: RepoWatchStatus | null | undefined, repoId: string, now: number): WatchLine | null {
  if (status === null || status === undefined) return null;
  if (!status.enabled) return { state: 'daemon-off', tone: 'quiet', words: 'Not kept current: the repo watcher is off on this computer', remedy: null, waitingOn: [] };
  const r = status.repos.find((x) => x.repoId === repoId);
  if (r === undefined) return null;
  const when = r.lastIndexedAt !== null ? ` · indexed ${relTime(r.lastIndexedAt, now)}` : '';
  switch (r.state) {
    case 'current': return { state: r.state, tone: 'ok', words: `Watching for changes${when}`, remedy: null, waitingOn: [] };
    case 'starting': return { state: r.state, tone: 'ok', words: `Watching for changes${when}`, remedy: null, waitingOn: [] };
    case 'changed': return { state: r.state, tone: 'busy', words: 'Changes seen · re-indexing shortly', remedy: null, waitingOn: [] };
    case 'indexing': return { state: r.state, tone: 'busy', words: 'Re-indexing now…', remedy: null, waitingOn: [] };
    case 'waiting-runs': {
      const n = r.waitingOn.length;
      return { state: r.state, tone: 'wait', words: `Waiting: ${n === 1 ? '1 job on this repo is' : `${n} jobs on this repo are`} using its code map`, remedy: null, waitingOn: r.waitingOn };
    }
    case 'failed': return { state: r.state, tone: 'bad', words: `Couldn’t re-index: ${r.error ?? 'the re-index failed'}`, remedy: r.remedy, waitingOn: [] };
    case 'off': return { state: r.state, tone: 'quiet', words: 'Not kept current (turned off)', remedy: null, waitingOn: [] };
    case 'capped': return { state: r.state, tone: 'quiet', words: `Not kept current: ${status.cap} repositories is the limit`, remedy: r.remedy, waitingOn: [] };
  }
}

/** Read the watcher now and every {@link REPO_WATCH_POLL_MS} while the calling surface is mounted (paused while hidden). */
export function useRepoWatch(): RepoWatchStatus | null | undefined {
  const status = useRepoWatchStore((s) => s.status);
  useEffect(() => {
    const load = (): void => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void useRepoWatchStore.getState().load(); };
    load();
    const t = setInterval(load, REPO_WATCH_POLL_MS);
    return () => clearInterval(t);
  }, []);
  return status;
}
