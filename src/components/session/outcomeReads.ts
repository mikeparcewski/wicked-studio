import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { installRecordOf, installUnitOf, installWords, type InstallRecord, type InstallWords } from '../../board/installOutcome.js';
import { unitKeyOf } from '../../board/runConversation.js';

/**
 * A finished run's outcome reads (studio#1365, studio#1367), ONE per run and step: kept for the page's life, so leaving
 * the chat and coming back, a second passage on the same run, a re-render, or another surface reading the same outcome
 * (the passage's tone and the session header, studio#1382) reads nothing again. `again` (a press on Try again, or the
 * requirements view closing after a change) drops the kept answer and reads once more.
 */
const outcomeReads = new Map<string, Promise<unknown>>();

export type OutcomeRead<T> = { value: T | 'failed' | null; again: () => void };

export function useOutcomeRead<T>(key: string | null, read: () => Promise<T>): OutcomeRead<T> {
  const [state, setState] = useState<{ key: string | null; value: T | 'failed' | null }>({ key: null, value: null });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    let p = outcomeReads.get(key) as Promise<T> | undefined;
    if (p === undefined) {
      p = read();
      outcomeReads.set(key, p);
      // A failed read is not kept: the next mount (or Try again) reads once more.
      p.catch(() => { if (outcomeReads.get(key) === p) outcomeReads.delete(key); });
    }
    p.then((v) => { if (live) setState({ key, value: v }); }, () => { if (live) setState({ key, value: 'failed' }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` is the key's own read
  }, [key, tries]);
  return {
    value: state.key === key ? state.value : null,
    again: () => { if (key !== null) outcomeReads.delete(key); setState({ key: null, value: null }); setTries((n) => n + 1); },
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
  /** `registered` (or updated), `not-registered` (staged, nothing registered), `failed` (garden's failure record);
   *  null while reading, when the output held no record, or for a job with no install. */
  standing: 'registered' | 'not-registered' | 'failed' | null;
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
  const standing = record === null || words === null ? null : words.registered ? 'registered' : record.ok ? 'not-registered' : 'failed';
  return { read, record, words, standing };
}
