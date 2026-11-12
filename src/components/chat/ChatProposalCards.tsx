import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { foldChatProposals, reconcileProposals, type ProposalEntry } from '../../board/artifactProposal.js';
import { foldJobLineages } from '../../board/jobStream.js';
import { seatLabel } from '../../board/seatNames.js';
import { useAskThreadStore } from '../../store/askThread.js';
import { proposalIsStub, useCapabilities } from '../../store/capabilities.js';
import { useConnectionStore } from '../../store/connection.js';
import { getCachedRoster } from '../../store/rosterCache.js';
import { ArtifactProposalCard } from './ArtifactProposalCard.js';

/** How often a started refine's run is read, for how long before it ends, and for how long after (its version lands,
 *  or its landing fails, seconds after the run itself ends). */
const RUN_POLL_MS = 5_000;
const RUN_POLL_FOR_MS = 15 * 60_000;
const RUN_LANDING_GRACE_MS = 2 * 60_000;

/**
 * A CHAT'S PROPOSAL CARDS WHERE THE CHAT IS SHOWN BESIDE SOMETHING (e2e 2026-11-07, plugins-complete G4): the document's
 * side chat ("Ask about this"), the page chat and the system chat draw a conversation as dock bubbles, not as the
 * session thread — so a refine the seat proposed there showed only its prose, and the card (Keep it / Let this change
 * it, Make the change) lived only on the chat's full view (`/s/<chat>`). This is the same card, folded from the same
 * transcript records with the same rules as the full view (`foldChatProposals`, `reconcileProposals`; a job's or a v2
 * create's proposal belongs to its passage there, so an open one points to the full chat here; a superseded card says
 * nothing to act on), answered through `POST /chats/:id/proposals/:pid` like everywhere else.
 *
 * The transcript is read when the block opens, whenever crew says the chat changed (a `chatProposal`, `chatReply`,
 * `chatDecisions` or `chatCitations` frame ticks the chat's `replySeq`), when the socket comes back (frames are not
 * replayed), and after a card recorded an answer. A read that fails keeps what the cards showed. A started refine's run
 * is read so its card can say what became of it.
 */
export function ChatProposalCards({ chatId, onOpenFull }: { chatId: string; onOpenFull?: (() => void) | undefined }): React.ReactElement | null {
  const proposalsOn = useCapabilities((s) => s.chatProposals);
  const historyOn = useCapabilities((s) => s.chatList);
  const jobsOn = useCapabilities((s) => s.chatJobProposals);
  const stub = useCapabilities((s) => s.chatArtifactsStub);
  const stubOps = useCapabilities((s) => s.chatArtifactsStubOps);
  const replySeq = useAskThreadStore((s) => s.replySeq[chatId] ?? 0);
  const [tick, setTick] = useState(0);
  const [records, setRecords] = useState<{ chatId: string; records: readonly unknown[] } | null>(null);

  // `/ws` replays nothing: what was recorded while the socket was down is read back when it returns.
  const wsStatus = useConnectionStore((s) => s.status);
  const wasConnected = useRef(wsStatus === 'connected');
  useEffect(() => {
    const now = wsStatus === 'connected';
    if (now && !wasConnected.current) setTick((n) => n + 1);
    wasConnected.current = now;
  }, [wsStatus]);

  useEffect(() => {
    if (!proposalsOn) return undefined;
    let cancelled = false;
    const keep = (r: readonly unknown[]): void => { if (!cancelled) setRecords({ chatId, records: r }); };
    api.getChat(chatId)
      .then(async (d) => {
        const live = Array.isArray((d as { messages?: unknown }).messages) ? ((d as { messages: unknown[] }).messages as readonly unknown[]) : [];
        // A chat no seat holds any more has ended: its kept history holds its records (an open proposal stays
        // answerable). A history that cannot be read keeps what the cards showed; only a 404 says there is none.
        if (d.seats.length === 0 && historyOn) {
          try {
            keep((await api.getChatMessages(chatId)).messages as readonly unknown[]);
          } catch (e) {
            if ((e as { status?: unknown }).status === 404) keep(live);
          }
          return;
        }
        keep(live);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [chatId, proposalsOn, historyOn, replySeq, tick]);

  const { entries, pointers } = useMemo(() => {
    if (!proposalsOn || records === null || records.chatId !== chatId) return { entries: [], pointers: [] };
    // The proposals a job's passage owns (and a v2 create under job proposals) are answered there, as on the full view.
    const lineages = jobsOn ? foldJobLineages(records.records) : [];
    const passage = new Set(lineages.flatMap((l) => l.versions.map((v) => v.pid)));
    const folded = reconcileProposals(chatId, foldChatProposals(records.records));
    const passageOwns = (e: ProposalEntry): boolean => passage.has(e.pid) || (jobsOn && (e.proposal as { sentence?: unknown }).sentence !== undefined);
    const entries = folded.filter((e) => e.state !== 'superseded' && !passageOwns(e));
    const byPid = new Map(folded.map((e) => [e.pid, e]));
    // One pointer per open lineage head; reconciliation keeps a stale read from reopening a settled proposal.
    // A v2 create outside the lineage fold still gets the same pointer, under the same ownership rule.
    const pointers = [
      ...lineages.filter((l) => l.state === 'open' && (byPid.get(l.head.pid)?.state ?? 'open') === 'open').map((l) => l.head),
      ...folded.filter((e) => e.state === 'open' && !passage.has(e.pid) && passageOwns(e)),
    ];
    return { entries, pointers };
  }, [proposalsOn, jobsOn, records, chatId]);

  const runs = useStartedRuns(entries, tick + replySeq);
  if (entries.length === 0 && pointers.length === 0) return null;
  // The proposing seat's one name (the roster's, else its key title-cased), as the full view names it.
  const seatName = (key: string): string => seatLabel(getCachedRoster()?.find((r) => r.key === key) ?? { key });
  return (
    <div data-testid="chat-proposal-cards" className="wk-dock-proposals">
      {pointers.map((p) => (
        <section key={p.pid} data-testid="chat-job-pointer" data-pid={p.pid} className="wk-ask wk-proposal">
          <p className="wk-ask-q">{p.proposal.what.label}</p>
          <p className="wk-ask-sub">Proposal from {seatName(p.proposal.seat)} · nothing starts until you choose · Open the full chat to answer it.</p>
          {onOpenFull !== undefined && (
            <div>
              <button type="button" data-testid="chat-job-pointer-open" className="wk-btn wk-btn--primary wk-btn--sm" onClick={onOpenFull}>
                Open in full chat
              </button>
            </div>
          )}
        </section>
      ))}
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

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * The runs Go started for a refine, each read on its own clock: while it runs, up to 15 minutes from when it was first
 * asked for; once it ended, for two more minutes (its version lands, or its landing fails, after it ends); never after
 * crew recorded `landing_failed`. A chat event or the socket coming back reads every one of them once, without
 * renewing any clock.
 */
function useStartedRuns(entries: readonly ProposalEntry[], seq: number): Record<string, SessionView> {
  const ids = useMemo(
    () => entries.filter((e) => e.state === 'decided' && e.decision === 'go' && e.proposal.kind === 'refine' && e.result?.stub !== true && typeof e.result?.runId === 'string').map((e) => e.result!.runId),
    [entries],
  );
  const key = ids.join('\u0000');
  const [runs, setRuns] = useState<Record<string, SessionView>>({});
  /** Per run: when first asked for, and when first seen ended. */
  const clocks = useRef(new Map<string, { seen: number; ended: number | null }>());
  useEffect(() => {
    if (ids.length === 0) return undefined;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const due = (id: string, now: number): boolean => {
      const c = clocks.current.get(id);
      if (c === undefined) return true;
      return c.ended !== null ? now - c.ended < RUN_LANDING_GRACE_MS : now - c.seen < RUN_POLL_FOR_MS;
    };
    // The first read answers what woke it (a chat event, the socket back, a card's answer): every run, whatever its
    // clock says. Only the reads after it, on the timer, are bounded by the clocks.
    const read = async (first: boolean): Promise<void> => {
      const now = Date.now();
      const want = first ? ids : ids.filter((id) => due(id, now));
      if (want.length === 0) return;
      // A run's clock starts when it is first asked for, not when an answer lands (a read a newer event cancels
      // would otherwise never start it).
      for (const id of want) if (!clocks.current.has(id)) clocks.current.set(id, { seen: now, ended: null });
      const got = await Promise.all(want.map((id) => api.getRun(id).then((r) => r.run).catch(() => null)));
      if (stop) return;
      const at = Date.now();
      for (const [i, id] of want.entries()) {
        const r = got[i] ?? null;
        const c = clocks.current.get(id) ?? { seen: now, ended: null };
        if (r !== null && (r.session as { landing_failed?: unknown }).landing_failed != null) c.ended = at - RUN_LANDING_GRACE_MS; // nothing more to learn
        else if (r !== null && TERMINAL.has(String(r.session.status)) && c.ended === null) c.ended = at;
        clocks.current.set(id, c);
      }
      setRuns((prev) => {
        const next = { ...prev };
        for (const r of got) if (r !== null) next[r.session.id] = r;
        return next;
      });
      if (!stop && ids.some((id) => due(id, Date.now()))) timer = setTimeout(() => void read(false), RUN_POLL_MS);
    };
    void read(true);
    return () => {
      stop = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // `seq` reads at once when crew says the chat changed; the clocks are per run and never renewed by it.
  }, [key, seq]); // eslint-disable-line react-hooks/exhaustive-deps
  return runs;
}
