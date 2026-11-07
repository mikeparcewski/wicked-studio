import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { foldChatProposals, reconcileProposals, type ProposalEntry } from '../../board/artifactProposal.js';
import { useAskThreadStore } from '../../store/askThread.js';
import { proposalIsStub, useCapabilities } from '../../store/capabilities.js';
import { seatLabel } from '../../board/seatNames.js';
import { getCachedRoster } from '../../store/rosterCache.js';
import { ArtifactProposalCard } from './ArtifactProposalCard.js';

/** How often a started refine's run is read while it may still land, and for how long. */
const RUN_POLL_MS = 5_000;
const RUN_POLL_FOR_MS = 15 * 60_000;

/**
 * A CHAT'S PROPOSAL CARDS WHERE THE CHAT IS SHOWN BESIDE SOMETHING (e2e 2026-11-07, plugins-complete G4): the document's
 * side chat ("Ask about this"), the page chat and the system chat draw a conversation as dock bubbles, not as the
 * session thread — so a refine the seat proposed there showed only its prose, and the card (Keep it / Let this change
 * it, Make the change) lived only on the chat's full view (`/s/<chat>`). This is the same card, folded from the same
 * transcript records with the same rules (`foldChatProposals`, `reconcileProposals`): one card per proposal, a
 * superseded one hidden, answered through `POST /chats/:id/proposals/:pid` like everywhere else.
 *
 * The transcript is read when the block opens and again whenever crew says the chat changed (a `chatProposal`,
 * `chatReply`, `chatDecisions` or `chatCitations` frame ticks the chat's `replySeq`), or the card recorded an answer.
 * A started refine's run is read so its card can say what became of it (landed, or crew's reason it did not).
 */
export function ChatProposalCards({ chatId }: { chatId: string }): React.ReactElement | null {
  const proposalsOn = useCapabilities((s) => s.chatProposals);
  const historyOn = useCapabilities((s) => s.chatList);
  const stub = useCapabilities((s) => s.chatArtifactsStub);
  const stubOps = useCapabilities((s) => s.chatArtifactsStubOps);
  const replySeq = useAskThreadStore((s) => s.replySeq[chatId] ?? 0);
  const [tick, setTick] = useState(0);
  const [records, setRecords] = useState<{ chatId: string; records: readonly unknown[] } | null>(null);

  useEffect(() => {
    if (!proposalsOn) return undefined;
    let cancelled = false;
    // An open chat's live transcript; an ended chat's kept history (its open proposal stays answerable).
    api.getChat(chatId)
      .then(async (d) => {
        const detail = d as unknown as { status?: unknown; messages?: unknown };
        const closed = detail.status === 'closed' || (Array.isArray((d as { seats?: unknown }).seats) && (d as { seats: unknown[] }).seats.length === 0);
        if (closed && historyOn) {
          try {
            return (await api.getChatMessages(chatId)).messages as readonly unknown[];
          } catch {
            /* the live read is what there is */
          }
        }
        return Array.isArray(detail.messages) ? (detail.messages as readonly unknown[]) : [];
      })
      .then((r) => { if (!cancelled) setRecords({ chatId, records: r }); })
      // A failed read keeps what the cards last showed (never a blank flash that drops an answer just given).
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [chatId, proposalsOn, historyOn, replySeq, tick]);

  const entries = useMemo<ProposalEntry[]>(() => {
    if (!proposalsOn || records === null || records.chatId !== chatId) return [];
    // Superseded cards say nothing a person can act on here; the full view keeps them.
    return reconcileProposals(chatId, foldChatProposals(records.records)).filter((e) => e.state !== 'superseded');
  }, [proposalsOn, records, chatId]);

  const runs = useStartedRuns(entries, tick + replySeq);
  // The proposing seat's one name (the roster's, else its key title-cased), as the full view names it.
  const seatName = (key: string): string => seatLabel(getCachedRoster()?.find((r) => r.key === key) ?? { key });
  if (entries.length === 0) return null;
  return (
    <div data-testid="chat-proposal-cards" className="wk-dock-proposals">
      {entries.map((e) => (
        <ArtifactProposalCard
          key={e.pid}
          chatId={chatId}
          entry={e}
          seatName={seatName(e.proposal.seat)}
          stub={proposalIsStub(stub, stubOps, e.proposal.kind)}
          onChanged={() => setTick((n) => n + 1)}
          run={e.result?.runId !== undefined ? runs[e.result.runId] ?? null : null}
        />
      ))}
    </div>
  );
}

/** The runs Go started for a refine, read until each is terminal (or failed to land), at most 15 minutes. */
function useStartedRuns(entries: readonly ProposalEntry[], seq: number): Record<string, SessionView> {
  const ids = useMemo(
    () => entries.filter((e) => e.state === 'decided' && e.decision === 'go' && e.proposal.kind === 'refine' && e.result?.stub !== true && typeof e.result?.runId === 'string').map((e) => e.result!.runId),
    [entries],
  );
  const key = ids.join('\u0000');
  const [runs, setRuns] = useState<Record<string, SessionView>>({});
  const startedAt = useRef<number>(Date.now());
  useEffect(() => { startedAt.current = Date.now(); }, [key, seq]);
  useEffect(() => {
    if (ids.length === 0) return undefined;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      const got = await Promise.all(ids.map((id) => api.getRun(id).then((r) => r.run).catch(() => null)));
      if (stop) return;
      setRuns((prev) => {
        const next = { ...prev };
        for (const r of got) if (r !== null) next[r.session.id] = r;
        return next;
      });
      const settled = got.every((r) => r !== null && (['completed', 'failed', 'cancelled'].includes(String(r.session.status))
        || (r.session as { landing_failed?: unknown }).landing_failed != null));
      // A completed run is read a few more times: its version lands (or its landing fails) seconds after it ends.
      if (!stop && Date.now() - startedAt.current < (settled ? 60_000 : RUN_POLL_FOR_MS)) timer = setTimeout(() => void read(), RUN_POLL_MS);
    };
    void read();
    return () => {
      stop = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // `seq` re-reads when crew says the chat changed.
  }, [key, seq]); // eslint-disable-line react-hooks/exhaustive-deps
  return runs;
}
