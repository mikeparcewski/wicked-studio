import { useMemo, useState } from 'react';
import {
  getVersions, injectDocMessage, postFork, UNFILED_MOUNT,
  type ForkResult, type VersionManifest,
} from '../api/interactive.js';
import { fileProposal } from '../api/proposals.js';
import { versionPath, type Navigate } from './useRoute.js';
import {
  asksByVersion, otherTake, pickConsequence, pickForks, preferenceContent, remixBlockedReason,
  remixSteer, takeSource, takesOf, type Take, type TakeNo,
} from '../interactive/takes.js';
import { nextMsgId, threadKey, useDocThreadStore, type DocMsg } from '../store/docThread.js';

/**
 * The takes' moves (Wave C, idea 12) over a compare split — see `interactive/takes.ts` for the
 * model. The pick is two independent, real writes, both reported: the preference proposal
 * (crew `POST /proposals`) and, when the picked take is not the head, the bridge's fork that
 * makes it the working version. The remix is ONE steer on the doc thread's inject wire (the same
 * wire and bookkeeping the thread's composer uses), forking first when it builds on an older take.
 */

export type PickState =
  | { phase: 'idle' }
  | { phase: 'preview' | 'sending'; picked: Take; other: Take; consequence: string };

export interface PickReceipt {
  picked: Take;
  other: Take;
  /** The pending proposal id, or why filing it failed. */
  proposal: { id: string } | { error: string };
  /** The working version after the pick, or why making it the working version failed. */
  working: { version: number | null; forked: boolean } | { error: string };
}

export interface TakesControl {
  /** The two takes on screen, or null when the canvas is not a side-by-side split. */
  takes: [Take, Take] | null;
  pick: PickState;
  previewPick: (n: TakeNo) => void;
  cancelPick: () => void;
  confirmPick: () => Promise<void>;
  receipt: PickReceipt | null;
  dismissReceipt: () => void;
  remix: {
    buildOn: TakeNo;
    keep: string;
    /** The steer verbatim, or null while it cannot be sent. */
    steer: string | null;
    blocked: string | null;
    sending: boolean;
    error: string | null;
  };
  setRemixBuildOn: (n: TakeNo) => void;
  setRemixKeep: (keep: string) => void;
  sendRemix: () => Promise<void>;
}

const NO_MSGS: DocMsg[] = [];

function why(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useTakes({
  projectId, docId, manifest, split, navigate, onForked, exitCompare, onShowChat,
}: {
  projectId: string;
  docId: string;
  /** Null while the manifest loads — there are no takes then. */
  manifest: VersionManifest | null;
  /** The split's panes (left, right), or null when not comparing side by side. */
  split: { left: number; right: number } | null;
  navigate: Navigate;
  /** The owner's fork landing: re-read the manifest and route to the service's version. */
  onForked: (result: ForkResult) => void;
  exitCompare: () => void;
  /** Put the thread in view — where a sent remix shows up. */
  onShowChat: () => void;
}): TakesControl {
  const key = threadKey(projectId, docId);
  const msgs = useDocThreadStore((s) => s.messages[key] ?? NO_MSGS);
  const genState = useDocThreadStore((s) => s.genState[key]) ?? 'terminal';
  const asks = useMemo(() => asksByVersion(msgs), [msgs]);
  const left = split?.left ?? null;
  const right = split?.right ?? null;
  const takes = useMemo(
    () => (left === null || right === null ? null : takesOf(left, right, asks)),
    [left, right, asks],
  );
  const pairOnScreen = manifest === null ? null : takes;

  const [pick, setPick] = useState<PickState>({ phase: 'idle' });
  const [receipt, setReceipt] = useState<PickReceipt | null>(null);
  const [buildOn, setBuildOn] = useState<TakeNo>(2);
  const [keep, setKeep] = useState('');
  const [sending, setSending] = useState(false);
  const [remixError, setRemixError] = useState<string | null>(null);

  function previewPick(n: TakeNo): void {
    if (takes === null || manifest === null) return;
    const picked = n === 1 ? takes[0] : takes[1];
    const other = otherTake(takes, n);
    setReceipt(null);
    setPick({ phase: 'preview', picked, other, consequence: pickConsequence(manifest, picked, other) });
  }

  async function confirmPick(): Promise<void> {
    if (pick.phase !== 'preview' || manifest === null) return;
    const { picked, other } = pick;
    setPick({ ...pick, phase: 'sending' });
    const forks = pickForks(manifest, picked);
    const [filed, working] = await Promise.allSettled([
      fileProposal({
        content: preferenceContent(docId, picked, other),
        ...(projectId === UNFILED_MOUNT ? {} : { project: projectId }),
        source: takeSource(docId, picked.version),
      }),
      forks ? postFork(projectId, docId, picked.version) : Promise.resolve(null),
    ]);
    setReceipt({
      picked,
      other,
      proposal: filed.status === 'fulfilled' ? { id: filed.value.id } : { error: why(filed.reason) },
      working: working.status === 'fulfilled'
        ? { version: working.value?.version ?? picked.version, forked: working.value !== null }
        : { error: why(working.reason) },
    });
    setPick({ phase: 'idle' });
    exitCompare();
    if (working.status === 'fulfilled' && working.value !== null) onForked(working.value);
    else if (working.status === 'fulfilled') navigate(versionPath(projectId, docId, null));
  }

  const blocked = takes === null ? 'Put two takes side by side first.' : remixBlockedReason(genState, keep);
  const steer = takes === null || blocked !== null
    ? null
    : remixSteer(buildOn === 1 ? takes[0] : takes[1], otherTake(takes, buildOn), keep);

  async function sendRemix(): Promise<void> {
    if (takes === null || steer === null || sending) return;
    const base = buildOn === 1 ? takes[0] : takes[1];
    const store = useDocThreadStore.getState();
    const msgId = nextMsgId();
    setSending(true);
    setRemixError(null);
    try {
      // The composer's rule (DocumentThread §7.10): a finished document forks only when the
      // steer builds on a version that is not the head; a live one takes the steer as is.
      let forkedTo: number | null = null;
      if ((store.genState[key] ?? 'terminal') === 'terminal') {
        const head = (await getVersions(projectId, docId)).head;
        if (base.version !== head) {
          const forked = await postFork(projectId, docId, base.version, msgId);
          store.expectDivider(key, msgId, forked.version);
          forkedTo = forked.version;
        }
      }
      store.addUserMsg(key, msgId, steer);
      store.setGenState(key, 'generating');
      try {
        await injectDocMessage(projectId, docId, steer, msgId);
      } catch {
        // The thread's visible failure: the message stays, wearing the failed chip + retry.
        store.markSendFailed(key, msgId, true);
        const after = useDocThreadStore.getState();
        if ((after.pending[key] ?? []).length === 0 && after.genState[key] === 'generating') {
          store.setGenState(key, 'terminal');
        }
      }
      setKeep('');
      exitCompare();
      navigate(versionPath(projectId, docId, forkedTo));
      onShowChat();
    } catch (e) {
      setRemixError(why(e));
    } finally {
      setSending(false);
    }
  }

  return {
    takes: pairOnScreen,
    pick,
    previewPick,
    cancelPick: () => setPick({ phase: 'idle' }),
    confirmPick,
    receipt,
    dismissReceipt: () => setReceipt(null),
    remix: { buildOn, keep, steer, blocked, sending, error: remixError },
    setRemixBuildOn: setBuildOn,
    setRemixKeep: (k: string) => { setKeep(k); setRemixError(null); },
    sendRemix,
  };
}
