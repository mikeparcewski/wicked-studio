import { useCallback, useEffect, useMemo, useState } from 'react';
import { postCapture, toCaptureFile, type CaptureBody } from '../api/capture.js';
import { listProposals } from '../api/proposals.js';
import type { SessionView } from '../api/types.js';
import { captureFiled, type CaptureFiled } from '../board/captureModel.js';
import { useCaptureStore, type LastCapture } from '../store/capture.js';
import { useNeedsSources } from '../store/needsSources.js';

/**
 * CAPTURE (Studio OS behaviour 8) — the behaviour; `CaptureDrop` is a skin over it.
 *
 * `send` posts notes and files to `POST /projects/:id/capture`; crew files a small run whose only
 * output is proposals in the ONE queue. While that run works, the pending queue is re-read and
 * DEPOSITED into the needs-you sources (`depositProposals`), so the rows appear in Home's existing
 * proposal triage (Wave B, idea 4) — the one place they are accepted or rejected. One last read
 * when the run ends; polling stops there (or after `MAX_POLL_MS`).
 */

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'cancelled', 'failed']);
/** A capture that never reports an end stops being watched after this long. */
export const MAX_POLL_MS = 15 * 60_000;

export interface CaptureState {
  sending: boolean;
  error: string | null;
  last: LastCapture | null;
  /** What the last capture filed so far, or null when there is none. */
  filed: CaptureFiled | null;
  /** The last capture's run reached a terminal state. */
  done: boolean;
  /** Resolves true when the daemon took the capture. */
  send: (projectId: string, projectName: string, notes: string, files: readonly File[]) => Promise<boolean>;
  clear: () => void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useCapture(runs: readonly SessionView[], pollMs = 3000): CaptureState {
  const last = useCaptureStore((s) => s.last);
  const seenIds = useCaptureStore((s) => s.seenIds);
  const pending = useNeedsSources((s) => s.proposals);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = last === null ? null : (runs.find((r) => r.session.id === last.runId)?.session.status ?? null);
  const done = status !== null && TERMINAL.has(status);

  const send = useCallback(
    async (projectId: string, projectName: string, notes: string, files: readonly File[]): Promise<boolean> => {
      if (notes.trim() === '' && files.length === 0) {
        setError('Add notes or a file to capture.');
        return false;
      }
      setSending(true);
      setError(null);
      try {
        const body: CaptureBody = {};
        if (notes.trim() !== '') body.notes = notes;
        if (files.length > 0) body.files = await Promise.all(files.map((f) => toCaptureFile(f)));
        const { runId } = await postCapture(projectId, body);
        useCaptureStore.getState().start({ runId, projectId, projectName, at: Date.now() });
        return true;
      } catch (e) {
        setError(errText(e));
        return false;
      } finally {
        setSending(false);
      }
    },
    [],
  );

  // Re-read the pending queue while the capture run works; one last read once it has ended.
  const runId = last?.runId ?? null;
  const startedAt = last?.at ?? 0;
  useEffect(() => {
    if (runId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      try {
        const rows = await listProposals({ state: 'pending' });
        if (cancelled) return;
        useNeedsSources.getState().depositProposals(rows);
        useCaptureStore.getState().see(rows.filter((p) => p.provenance.run_id === runId).map((p) => p.id));
      } catch {
        /* a failed read is retried on the next tick; the queue keeps its last answer */
      }
      if (!cancelled && !done && Date.now() - startedAt < MAX_POLL_MS) timer = setTimeout(() => void read(), pollMs);
    };
    void read();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [runId, startedAt, done, pollMs]);

  const filed = useMemo(
    () => (last === null ? null : captureFiled(pending ?? [], last.runId, seenIds)),
    [last, pending, seenIds],
  );

  const clear = useCallback(() => {
    useCaptureStore.getState().clear();
    setError(null);
  }, []);

  return { sending, error, last, filed, done, send, clear };
}
