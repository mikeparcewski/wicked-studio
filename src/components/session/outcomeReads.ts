import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { installRecordOf, installUnitOf, installWords, type InstallRecord, type InstallWords } from '../../board/installOutcome.js';
import { unitKeyOf } from '../../board/runConversation.js';

/**
 * A finished run's outcome reads (studio#1365, studio#1367), ONE per run and step: kept for the page's life, so leaving
 * the chat and coming back, a second passage on the same run, a re-render, or another surface reading the same outcome
 * (the passage's edge and the session header, studio#1382) reads nothing again. Every reader of a key sees the same
 * answer: a read that settles, a failure, and `again` (a press on Try again, or the requirements view closing after a
 * change) reach every mounted reader (codex/agy r1 on #1392). A failed read is not kept: the next mount reads once more.
 */
interface OutcomeEntry { value: unknown; read: Promise<unknown> | null }
const outcomeReads = new Map<string, OutcomeEntry>();
const outcomeListeners = new Map<string, Set<() => void>>();

function notify(key: string): void { outcomeListeners.get(key)?.forEach((fn) => fn()); }

/** Start the key's read unless one is in flight or answered: nothing kept, or only a failure. */
function ensureRead(key: string, read: () => Promise<unknown>, force = false): void {
  const had = outcomeReads.get(key);
  if (!force && had !== undefined && (had.read !== null || had.value !== 'failed')) return;
  const p = read();
  outcomeReads.set(key, { value: null, read: p });
  notify(key);
  p.then(
    (v) => { if (outcomeReads.get(key)?.read === p) { outcomeReads.set(key, { value: v, read: null }); notify(key); } },
    () => { if (outcomeReads.get(key)?.read === p) { outcomeReads.set(key, { value: 'failed', read: null }); notify(key); } },
  );
}

export type OutcomeRead<T> = { value: T | 'failed' | null; again: () => void };

export function useOutcomeRead<T>(key: string | null, read: () => Promise<T>): OutcomeRead<T> {
  const value = useSyncExternalStore(
    useCallback((onChange: () => void) => {
      if (key === null) return () => {};
      let set = outcomeListeners.get(key);
      if (set === undefined) { set = new Set(); outcomeListeners.set(key, set); }
      set.add(onChange);
      return () => { set.delete(onChange); if (set.size === 0) outcomeListeners.delete(key); };
    }, [key]),
    () => (key === null ? null : (outcomeReads.get(key)?.value ?? null)),
  ) as T | 'failed' | null;
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => { if (key !== null) ensureRead(key, () => readRef.current()); }, [key]);
  return {
    value,
    again: () => { if (key !== null) ensureRead(key, () => readRef.current(), true); },
  };
}

/** Tests: forget every kept outcome read. */
export function resetOutcomeReadsForTest(): void { outcomeReads.clear(); }

/** What an MCP-server job's install came to, as every surface that says it reads it (studio#1382). */
export interface InstallOutcome {
  /** The install step's output read (null while reading, 'failed' when it could not be read). */
  read: OutcomeRead<string | null>;
  record: InstallRecord | null;
  words: InstallWords | null;
  /** `loading` while the output is read, `registered` (or updated), `not-registered` (staged, nothing registered),
   *  `failed` (garden's failure record); null when the read failed, the output held no record, or the job has no
   *  install. */
  standing: 'loading' | 'registered' | 'not-registered' | 'failed' | null;
}

/**
 * The install step's record (garden's `install.py --json`, studio#1367), off the one kept read per run and step. Pass
 * null (or a run with no install step) to read nothing: only a finished job's install has said what it did.
 */
export function useInstallOutcome(run: SessionView | null): InstallOutcome {
  const install = run === null ? null : installUnitOf(run);
  const installKey = run === null || install === null ? null : unitKeyOf(run.session.id, install);
  const read = useOutcomeRead<string | null>(installKey === null ? null : `install:${run!.session.id}:${installKey}`,
    () => api.getUnitOutput(run!.session.id, installKey!).then(({ output }) => output));
  const record = typeof read.value === 'string' ? installRecordOf(read.value) : null;
  const words = record === null ? null : installWords(record);
  const standing = installKey !== null && read.value === null ? 'loading'
    : record === null || words === null ? null : words.registered ? 'registered' : record.ok ? 'not-registered' : 'failed';
  return { read, record, words, standing };
}
