import { useCallback, useEffect, useState } from 'react';
import { getDemo } from '../../api/demo.js';
import { isWalkthroughUnsupported, walkthroughApi } from '../../api/walkthrough.js';
import { isLive, recordingOf, recordingOfDemo, type Recording, type RecordingKind } from '../../board/walkthroughModel.js';
import { publishRecording, withdrawRecording } from '../../store/recordings.js';

const POLL_MS = 2500;
/** A read that keeps failing is retried this many times (5 s apart), then left: the line says it failed. */
const MAX_FAILED_READS = 5;

type Load = { kind: 'loading' } | { kind: 'absent' } | { kind: 'failed'; message: string } | { kind: 'ready'; rec: Recording };

export function useRecording(runId: string, kind: RecordingKind, step: string | null, runStatus: string): { load: Load; reload: () => void } {
  // What is read belongs to ONE (kind, run, step): after any of them changes, the previous
  // recording is never shown — or acted on — under the new identity, not even while the new read fails.
  const ident = `${kind}\u0000${runId}\u0000${step ?? ''}`;
  const [held, setHeld] = useState<{ ident: string; load: Load }>({ ident, load: { kind: 'loading' } });
  const load: Load = held.ident === ident ? held.load : { kind: 'loading' };
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const setLoad = (next: Load | ((was: Load) => Load)): void => setHeld((h) => {
      const was: Load = h.ident === ident ? h.load : { kind: 'loading' };
      return { ident, load: typeof next === 'function' ? next(was) : next };
    });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fails = 0;
    const read = async (): Promise<void> => {
      try {
        const rec = kind === 'demo-video' ? recordingOfDemo(await getDemo(runId)) : recordingOf(await walkthroughApi.view(runId, step));
        if (cancelled) return;
        fails = 0;
        publishRecording(rec); // WT-U2: the chain's chips place their moments by this take's chapter marks
        setLoad(kind === 'walkthrough' && rec.step === null && rec.planStep === null ? { kind: 'absent' } : { kind: 'ready', rec });
        if (isLive(rec.state)) timer = setTimeout(() => void read(), POLL_MS);
      } catch (e) {
        if (cancelled) return;
        if (kind === 'walkthrough') withdrawRecording(runId); // WT-U2: no chip moment from a take not re-read
        // A read that fails while a recording is on screen keeps it (a blip must not blank the take).
        setLoad((was) => (isWalkthroughUnsupported(e) ? { kind: 'absent' }
          : was.kind === 'ready' ? was : { kind: 'failed', message: e instanceof Error ? e.message : String(e) }));
        fails += 1;
        if (!isWalkthroughUnsupported(e) && fails < MAX_FAILED_READS) timer = setTimeout(() => void read(), POLL_MS * 2);
      }
    };
    void read();
    return () => { cancelled = true; if (timer !== null) clearTimeout(timer); };
  }, [runId, kind, step, runStatus, tick, ident]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { load, reload };
}

