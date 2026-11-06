import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { ChatPlanOffer, ProposalRevisionEdits, ProposalToken, SessionView } from '../../api/types.js';
import { ApiError } from '../../api/errors.js';
import { proposalRefusal } from '../../board/artifactProposal.js';
import { commitGateDecision, type GateAnswer } from '../../board/gateActions.js';
import {
  announceOf, changedTokenIds, foldLine, jobSettled, needsWords, proposalTarget, regionName, sentenceParts, settledLine, withWords,
  type JobLineage, type JobReply, type JobView,
} from '../../board/jobStream.js';
import { newRequestId } from '../../board/planModel.js';
import { deliverySummary, handedOf, outcomeLine } from '../../board/proposalCard.js';
import { seatResponder } from '../../board/responder.js';
import { isQueued, takeRestoredNote, undoDecision, useUndoQueue } from '../../board/undoQueue.js';
import { jobRunId, useJobLocal, useJobView } from '../../hooks/useJobStream.js';
import { useSessionDrafts } from '../../store/sessionDrafts.js';
import { Undocked } from './DecisionDock.js';
import { usePressBinding } from '../../hooks/usePressBinding.js';
import { useRoster } from '../../hooks/useRoster.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useGateStore } from '../../store/gates.js';
import { useRunEventStore } from '../../store/events.js';
import { failureWhy } from '../../board/failureWhy.js';
import { focusSessionComposer, useJobBinding } from '../../store/jobBinding.js';
import { openSheet, stopRun } from '../../store/sheets.js';
import { RunAssuranceLabel } from './AssuranceReceipt.js';
import { GateRow } from './GateRow.js';
import { ProposalCard } from './ProposalCard.js';
import { useRunChain } from './ChainLine.js';
import { proposalKindOf } from '../../board/proposalCard.js';
import { LiveActivity } from './LiveActivity.js';
import { RunQuestions } from './ThreadQuestions.js';
import { OrphanedRow } from './RunConversation.js';
import { RunArtifacts } from './RunArtifacts.js';
import { PowerPauseCard } from './PowerMode.js';
import { usePower } from '../../hooks/usePower.js';

/**
 * WICKED'S PASSAGE (DES-CATALOG-002 rev 7 §2.8.1, the v4 "Ink" direction, mockup new-job-v5): the job, inline in the
 * thread, with no box. A gold rule in the gutter and wicked's name, label and version in the margin; the sentence and
 * its tokens; crew's notes; the starting shape; the questions; the plan as an outline with Approve plan vN · Change;
 * while running, finished steps folded to one line, the current step with its own live report, the next step and the
 * checks; a gate unfolding under its step (GateRow, unchanged); the delivery. It changes in place.
 *
 * Every fact is crew's (§2.7.6): the passage only ever draws crew's newest record. A press counts only for what it
 * began on (§2.7.3 rule 6, `usePressBinding`); a swap, suggestion or question choice holds Start until crew answers
 * (Swap pending); `revising` holds Start; plan answers carry `ord` + `planRev`.
 */

/** What a queued decision does, in its own words (a Stop is never called an Approve). */
const QUEUED_WORD: Readonly<Record<string, string>> = { approve: 'Approve', 'request-changes': 'Send back', reject: 'Reject', stop: 'Stop the job', 'edit-plan': 'Add a step' };

const TOKEN_KIND: Readonly<Record<ProposalToken['kind'], string>> = {
  card: 'kind of job', option: 'kind of job', repo: 'repository', project: 'project', seats: 'who works on it',
  depth: 'how deep', checks: 'what checks it', detail: 'detail',
};

export function JobPassage({ chatId, lineage, runs, sessionId, settled = false, navigate, say, onChanged }: {
  chatId: string;
  lineage: JobLineage;
  /** The chat's runs (the launched run is found here, by the lineage's result or `from_proposal`). */
  runs: readonly SessionView[];
  sessionId: string;
  /** A later job in this chat followed this one: once it is over, it settles to one line (§2.8.1). */
  settled?: boolean;
  navigate?: Navigate;
  /** Send words to the chat as the person's message ("Something else…" on a token binds the composer to this). */
  say: (text: string) => void;
  /** Re-read the chat (a response landed; crew's frame follows too). */
  onChanged: () => void;
}): React.ReactElement {
  // The clock: a queued answer's countdown (from the queue's own deadline) and a fresh Go's starting window.
  const [now, setNow] = useState(() => Date.now());
  const ticking = useJobTicking(lineage, runs);
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  const { view: v, run, inputs, planRetry, runRetry } = useJobView(lineage, runs, now);
  const roster = useRoster();
  const press = usePressBinding();
  const local = useJobLocal();
  const swapToken = useJobLocal((s) => s.swapToken[lineage.lineage] ?? null);
  const binding = useJobBinding((s) => s.binding);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  /** The run the open "Stop the job?" confirm was made for: it never stops another run. */
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [openSwap, setOpenSwap] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);
  const head = lineage.head;
  const pid = head.pid;
  const runId = run?.session.id ?? lineage.runId;
  const gate = useGateStore((st) => (runId === null ? undefined : st.gates[runId]));
  const runEvents = useRunEventStore((st) => (runId === null ? undefined : st.byRun[runId]));
  const pt = proposalTarget(head.proposal);
  // A confirm made for one run closes when the job's run is another.
  useEffect(() => { if (confirmStop !== null && confirmStop !== runId) setConfirmStop(null); }, [confirmStop, runId]);
  // A swap listbox open on one version closes when crew's next version lands; a press note about an old version goes.
  const clearNote = press.clearNote;
  useEffect(() => { setOpenSwap(null); clearNote(); }, [pt, v.plan?.planRev, clearNote]);
  // Leaving the passage leaves no binding behind it (a binding answers only what this passage drew).
  useEffect(() => () => { const b = useJobBinding.getState().binding; if (b !== null && b.replyKey.startsWith(`${lineage.lineage}:`)) useJobBinding.getState().clear(b.replyKey); }, [lineage.lineage]);

  // A swap this tab sent is answered once crew's newer version lands (or its refusal clears it): Swap pending ends.
  const swapPending = useJobLocal((s) => s.swapPending[lineage.lineage] ?? null);
  useEffect(() => {
    if (swapPending !== null && swapPending !== pid) local.setSwap(lineage.lineage, null);
  }, [swapPending, pid, lineage.lineage, local]);
  /** A revision whose answer never came (the connection dropped): its hold stays until crew's next version, and
   *  "Try again" re-sends it under the same request id (crew answers a repeat with the same proposal). */
  const [lost, setLost] = useState<{ body: Parameters<typeof api.reviseChatProposal>[1]; token: string | null } | null>(null);

  // Only what changed moves (§2.7.3 rule 1): tokens whose label changed since the version seen when this passage
  // mounted wash; a page that opens on v2 washes nothing. Under reduced motion the wash is static and clears when the
  // person next interacts with the passage.
  const seenVersion = useRef(v.version);
  const [washFrom, setWashFrom] = useState<number | null>(null);
  useEffect(() => {
    if (v.version > seenVersion.current) setWashFrom(seenVersion.current);
    seenVersion.current = v.version;
  }, [v.version]);
  const washed = useMemo(() => (washFrom === null ? new Set<string>() : changedTokenIds(lineage.versions[washFrom - 1]?.proposal ?? null, v.proposal)), [washFrom, lineage.versions, v.proposal]);

  // One polite announcement of what changed, once (§2.8.6).
  const prevView = useRef<JobView | null>(null);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const said = announceOf(prevView.current, v);
    if (said !== null) setAnnounce(said);
    prevView.current = v;
  }, [v]);

  // The reply that bound the composer is marked "· answering"; a Send after its target moved is refused there.
  const bound = binding !== null && binding.sessionId === sessionId && binding.replyKey.startsWith(`${lineage.lineage}:`) ? binding : null;

  // Who leads, from the proposal drawn (what Go accepted once started), never a version Go did not take.
  const lead = (v.proposal.seats?.lead ?? null);
  const leadName = lead !== null ? seatResponder(lead, roster).name : 'The lead';

  // ── the routes ────────────────────────────────────────────────────────────────────────────────────────────────────
  const decide = (decision: 'go' | 'not_now'): void => {
    setError(null);
    local.setDeciding(lineage.lineage, true);
    api.decideChatProposal(chatId, pid, { decision })
      .then(() => onChanged())
      .catch((e: unknown) => { setError(proposalRefusal(e).words); onChanged(); })
      .finally(() => local.setDeciding(lineage.lineage, false));
  };
  const sendRevision = (body: Parameters<typeof api.reviseChatProposal>[1], token: string | null, typed: string | null = null): void => {
    setError(null);
    setLost(null);
    local.setSwap(lineage.lineage, body.revises, token, body.requestId);
    api.reviseChatProposal(chatId, body)
      .then(() => onChanged())
      .catch((e: unknown) => {
        if (!(e instanceof ApiError) || e.status === 0) {
          // No answer from crew: it may have taken the change. The hold stays; the next version or a retry ends it.
          // Only the request that still owns the hold offers a retry: an older one's late failure is moot.
          if (useJobLocal.getState().swapRequest[lineage.lineage] === body.requestId) setLost({ body, token });
          onChanged();
          return;
        }
        // Crew's refusal restores the unchanged proposal: this request's hold ends (never a newer one's), and words the
        // person typed for it come back to a free box (a fresh answer is a fresh binding).
        local.endSwap(lineage.lineage, body.requestId);
        setError(proposalRefusal(e).words);
        if (typed !== null && typed.trim() !== '' && composerFree()) useSessionDrafts.getState().setDraft(sessionId, typed);
        onChanged();
      });
  };
  const revise = (edits: ProposalRevisionEdits, source: 'swap' | 'suggestion' | 'question', words?: string, token: string | null = null, typed: string | null = null): void => {
    sendRevision({ revises: pid, edits, source, requestId: newRequestId(), ...(words !== undefined ? { words } : {}) }, token, typed);
  };
  const gateExpect = (): { ord: number; receivedAt: number } | null => {
    if (runId === null || inputs.plan === null) return null;
    const g = useGateStore.getState().gates[runId];
    return g !== undefined && g.ord === inputs.plan.ord ? { ord: g.ord, receivedAt: g.receivedAt } : null;
  };
  const approve = (): void => {
    const p = inputs.plan;
    const expect = gateExpect();
    if (p === null || runId === null || expect === null) { setError('The plan isn’t open any more. Nothing was sent.'); return; }
    setError(null);
    commitGateDecision(runId, { approve: true, planRev: p.planRev } as GateAnswer, {
      expect,
      notice: { preview: `Plan v${p.planRev} runs; nothing is delivered until you say so.`, sent: `Approved plan v${p.planRev}.` },
      receipt: { kind: 'plan', chosenLabel: `Approve plan v${p.planRev}` },
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const composerFree = (): boolean => (useSessionDrafts.getState().drafts[sessionId] ?? '').trim() === '' && useJobBinding.getState().binding === null;
  const sendBack = (words: string, planRev: number, rebind: JobReply | null): boolean => {
    const text = words.trim();
    const expect = gateExpect();
    if (text === '' || runId === null || expect === null || inputs.plan?.planRev !== planRev || isQueued(runId)) { setError('The plan moved on, or an answer is already queued. Nothing was sent.'); return false; }
    setError(null);
    const run0 = runId;
    commitGateDecision(run0, { approve: false, action: 'request_changes', amend: text, planRev } as GateAnswer, {
      expect,
      notice: { preview: `Sends plan v${planRev} back with your words; nothing runs until you approve a new version.`, sent: `Sent plan v${planRev} back with your words.` },
      receipt: { kind: 'plan', chosenLabel: 'Change' },
    }).then((outcome) => {
      if (outcome === 'sent') local.setSentBack(run0, planRev);
      // Undo hands the words back to the box, bound again to the SAME plan version (never a newer one), and only into an
      // empty box (a newer draft is never overwritten).
      // Undo, or the world cancelling it (the gate moved): the words come back, only into a box nobody else owns now
      // (no newer draft, no other binding); otherwise they stay where the queue left them and nothing is rebound. Only
      // an Undo rebinds, and only to the same plan version.
      if (outcome !== 'sent') {
        if (!composerFree()) return;
        // The queue hands an Undo's or a cancel's words back; a send refused before it queued (dropped) has them here.
        const back = takeRestoredNote(run0) || text;
        if (back !== '') useSessionDrafts.getState().setDraft(sessionId, back);
        if (outcome === 'undone' && rebind !== null && currentTarget.current.get(rebind.id) === rebind.target) bindChange(rebind, planRev);
      }
    }).catch((e: unknown) => {
      // The send failed: crew's words say why, and the person's words are not lost.
      setError(e instanceof Error ? e.message : String(e));
      if (composerFree()) useSessionDrafts.getState().setDraft(sessionId, text);
    });
    return true;
  };
  const reshape = (o: ChatPlanOffer): void => {
    const r = o.reshape;
    // Never beside an answer already queued or being sent for this plan (the reshape answers the same plan).
    if (r === undefined || runId === null || isQueued(runId) || v.offerHeld !== null || v.reshapeHeld !== null) return;
    setError(null);
    // One reshape per offer: a retry reuses its request id (crew answers a repeat with the same result), and while it is
    // in flight every other answer to this plan is held.
    const requestId = reshapeIds.current.get(o.id) ?? newRequestId();
    reshapeIds.current.set(o.id, requestId);
    const run0 = runId;
    local.setReshaping(run0, true);
    api.reshapeRun(run0, {
      card: r.card, option: r.option, depth: r.depth, requestId, confirmLoss: [...r.lost, ...r.lostSeats], ord: o.ord, planRev: o.planRev,
    }).then(() => onChanged()).catch((e: unknown) => { setError(proposalRefusal(e).words); onChanged(); })
      .finally(() => local.setReshaping(run0, false));
  };
  const reshapeIds = useRef(new Map<string, string>());
  const bind = (reply: JobReply, label: string, placeholder: string, send: (text: string) => boolean): void => {
    const target = reply.target;
    useJobBinding.getState().bind({
      sessionId, replyKey: `${lineage.lineage}:${reply.id}`, label, placeholder, instance: target,
      current: () => currentTarget.current.get(reply.id) ?? null,
      send,
    });
    focusSessionComposer();
  };
  // The targets the replies have NOW, for a binding's Send (a binding never answers another version).
  const currentTarget = useRef(new Map<string, string>());
  // Only replies that can be pressed now: a binding to a held reply (an answer queued) sends nothing.
  currentTarget.current = new Map(v.replies.filter((r) => r.enabled).map((r) => [r.id, r.target]));
  const bindChange = (r: JobReply, rev: number): void => {
    bind(r, `Answering: what should change in plan v${rev}`, `Tell ${leadName} what to change in plan v${rev}…`, (t) => sendBack(t, rev, r));
  };

  const act = (r: JobReply): void => {
    if (r.id === 'start' || r.id === 'go_again') decide('go');
    else if (r.id === 'not_now') decide('not_now');
    else if (r.id.startsWith('suggestion:')) {
      const s = head.proposal.suggestions?.[Number(r.id.slice('suggestion:'.length))];
      if (s !== undefined) revise(s.edit, 'suggestion', s.label);
    } else if (r.id.startsWith('choice:')) {
      const q = head.proposal.question;
      const c = q?.choices[Number(r.id.slice('choice:'.length))];
      if (q == null || c === undefined) return;
      if (needsWords(q, c.edit)) {
        bind(r, `Answering: ${q.input?.label ?? q.text}`, q.input?.label ?? 'Say why…', (t) => {
          if (t.trim() === '') return false;
          revise(withWords(q, c.edit, t), 'question', undefined, null, t);
          return true;
        });
      }
      else revise(c.edit, 'question');
    } else if (r.id === 'approve') approve();
    else if (r.id === 'change') {
      const rev = inputs.plan?.planRev;
      if (rev === undefined) return;
      bindChange(r, rev);
    } else if (r.id === 'stop' && runId !== null) setConfirmStop(runId);
  };
  const changedWords = v.plan !== null ? `Plan changed to v${v.plan.planRev}. Read it, then approve.` : `The job changed to v${v.version}. Read it, then press again.`;

  // ── the sentence ──────────────────────────────────────────────────────────────────────────────────────────────────
  const sentence = v.proposal.sentence;
  const parts = sentence === undefined ? [] : sentenceParts(sentence.text, sentence.tokens);
  /** The version the open listbox was opened on: a pick counts only for it (§2.7.3 rule 6). */
  const swapOpenedOn = useRef<string | null>(null);
  const tokenRefs = useRef(new Map<string, HTMLSpanElement | null>());
  const pickSwap = (t: ProposalToken, i: number | 'else'): void => {
    setOpenSwap(null);
    // Focus stays on the token the person was changing (it stays focusable while the change is in flight).
    if (swapOpenedOn.current !== pt) { press.say('The job changed while you picked. Nothing was sent.'); return; }
    if (i === 'else') {
      // Something else…: the composer, with the token named (a typed correction is the seat's revision).
      useJobBinding.getState().bind({
        sessionId, replyKey: `${lineage.lineage}:token:${t.id}`, label: `Answering: something else for “${t.label}”`,
        placeholder: `Say what to change about ${TOKEN_KIND[t.kind]}…`, instance: pt,
        current: () => lineageHead.current, send: (text) => { if (text.trim() === '') return false; say(text); return true; },
      });
      focusSessionComposer();
      return;
    }
    const c = t.swap?.choices[i];
    if (c !== undefined) revise(c.edit, 'swap', undefined, t.id);
  };
  const lineageHead = useRef<string | null>(pt);
  lineageHead.current = v.tokensLive && !v.tokensHeld ? pt : null;
  const lede = (
    <p data-testid="job-passage-sentence" className={`wk-pass-lede${v.phase === 'revising' || v.phase === 'swapPending' ? ' wk-pass-lede--wet' : ''}`}>
      {parts.map((x, i) => {
        if ('text' in x) return <Fragment key={i}>{x.text}</Fragment>;
        const t = x.token;
        const pending = v.phase === 'swapPending' && swapToken === t.id;
        const label = pending ? '…' : t.label;
        const wash = washed.has(t.id) ? ' wk-pass-tok--chg' : '';
        if (!v.tokensLive || (t.swap === null && t.kind !== 'checks')) {
          return <b key={i} data-testid="job-passage-fact" data-token={t.id} className={`wk-pass-fact${wash}`}>{label}{t.kind === 'checks' && <span aria-hidden className="wk-pass-lock" />}</b>;
        }
        return (
          <TokenButton key={i} token={t} label={label} wash={wash} open={openSwap === t.id} held={v.tokensHeld}
            tokenRef={(el) => { tokenRefs.current.set(t.id, el); }} explainId={`${lineage.lineage}-why`}
            onOpen={() => {
              if (v.tokensHeld) return;
              if (t.kind === 'checks') { setExplain((e) => !e); return; }
              swapOpenedOn.current = pt;
              setOpenSwap((o) => (o === t.id ? null : t.id));
            }}
            onPick={(c) => pickSwap(t, c)} onClose={() => setOpenSwap(null)} expanded={t.kind === 'checks' ? explain : openSwap === t.id} />
        );
      })}
      {v.tokensLive && sentence?.ask != null && v.question === null && <> {sentence.ask}</>}
    </p>
  );

  // ── settled: one line built from the records (§2.8.1, Q45) ─────────────────────────────────────────────────────────
  if (settled && jobSettled(v.phase)) {
    const pr = run !== null ? deliverySummary(run) : null;
    return (
      <section role="region" aria-label={regionName(v)} data-testid="job-passage" data-phase={v.phase} data-settled="true" data-lineage={lineage.lineage} className="wk-pass wk-pass--settled">
        <p className="wk-pass-settled">
          {settledLine(v, { pr })}
          {runId !== null && <> · <button type="button" className="wk-pass-inl" data-testid="job-passage-details" onClick={() => openSheet({ kind: 'session', sessionId: `run:${runId}` })}>Details ›</button></>}
        </p>
        <div aria-live="polite" className="wk-visually-hidden" data-testid="job-passage-live">{announce}</div>
      </section>
    );
  }

  const tone = v.needsYou ? ' wk-pass--needs' : v.phase === 'delivered' ? ' wk-pass--ok' : v.phase === 'failed' || v.phase === 'stopped' ? ' wk-pass--bad'
    : v.phase === 'revising' || v.phase === 'swapPending' || v.phase === 'planning' || v.phase === 'replanning' || v.phase === 'starting' ? ' wk-pass--busy' : '';
  const replies = v.replies;
  const queued = inputs.pending;
  const progress = v.progress;

  return (
    <section
      role="region" aria-label={regionName(v)}
      data-testid="job-passage" data-phase={v.phase} data-version={v.version} data-lineage={lineage.lineage}
      {...(runId !== null ? { 'data-run-id': runId } : {})}
      className={`wk-pass${tone}`}
      onPointerDown={() => setWashFrom(null)}
      onKeyDownCapture={() => setWashFrom(null)}
      onKeyDown={(e) => { if (e.key === 'Escape') { setOpenSwap(null); setExplain(false); } }}
    >
      {/* wicked's mark: the name, the label and the version, read first (§2.8.6); the authority is in the words. */}
      <div className="wk-pass-mg" data-testid="job-passage-margin">
        <span className="wk-pass-mg-who">wicked</span>{' '}
        <span className="wk-pass-mg-label">{v.label}</span>{' '}
        <span className="wk-pass-mg-v" data-testid="job-passage-version">{v.versionLabel}</span>
      </div>

      {lede}
      {v.notes.map((n, i) => <p key={i} data-testid="job-passage-note" className="wk-pass-aside">{n}</p>)}
      {explain && (
        <p id={`${lineage.lineage}-why`} data-testid="job-passage-checks-why" role="note" className="wk-pass-sub">
          These checks are the job’s own and stay with it: words in the chat can’t remove them. Only your press on wicked’s question changes them.
        </p>
      )}

      {/* the starting shape: crew's composed steps, labelled as such (rev 6 §2.7.2) */}
      {v.sketch !== null && (v.phase === 'proposed' || v.phase === 'asking' || v.phase === 'revising' || v.phase === 'swapPending') && (
        <p data-testid="job-passage-sketch" className="wk-pass-then">
          <span>Starting shape</span>{' '}
          {v.sketch.map((s, i) => (
            <Fragment key={i}>
              {i > 0 && <i aria-hidden> → </i>}
              <b>{s}</b>{v.sketchAsks[i] === true && <em> (asks you)</em>}
            </Fragment>
          ))}
        </p>
      )}

      {v.phase === 'asking' && v.question !== null && (
        <div data-testid="job-passage-question" className="wk-pass-ask">
          <span className="wk-pass-ask-who">{v.question.kind === 'lost_check' ? 'wicked asks · only your press changes the checks' : 'wicked asks'}</span>
          <p>{v.question.text}</p>
        </div>
      )}
      {(v.phase === 'revising' || v.phase === 'swapPending') && (
        <p data-testid="job-passage-updating" className="wk-pass-sub wk-pass-grey">Updating from your {v.phase === 'revising' ? 'message' : 'change'}… Start waits until it settles.</p>
      )}
      {v.phase === 'coming' && <p className="wk-pass-sub" data-testid="job-passage-coming">{head.proposal.coming?.note ?? 'This one comes in a later release; it has no Start yet.'}</p>}
      {v.phase === 'notStarted' && <p className="wk-pass-sub wk-pass-grey" data-testid="job-passage-not-started">Not started. Say so in the chat to bring it back.</p>}
      {v.phase === 'replaced' && <p className="wk-pass-sub wk-pass-grey">A newer proposal replaced this one. Nothing was started.</p>}
      {v.phase === 'starting' && <p className="wk-pass-sub wk-pass-grey" data-testid="job-passage-starting">Starting the job…</p>}
      {v.phase === 'interrupted' && <p className="wk-pass-sub">Interrupted before it was recorded as started. Go again resumes the same job.</p>}
      {v.phase === 'stub' && <p className="wk-pass-sub wk-pass-grey">Test configuration: your Start was recorded, and nothing was started.</p>}

      {v.phase === 'planning' && (
        <>
          <p data-testid="job-passage-planning" className="wk-pass-sub">{leadName} is planning the real steps. I’ll show you the plan before anything changes.</p>
          {v.sketch !== null && <ol aria-label="Starting shape" className="wk-pass-ol wk-pass-ol--ghost">{v.sketch.map((s, i) => <li key={i}><span className="n">{i + 1}</span><span className="l">{s}</span></li>)}</ol>}
        </>
      )}
      {v.plan !== null && (
        <>
          <p data-testid="job-passage-plan-head" className="wk-pass-sub">
            {v.phase === 'replanning'
              ? `${leadName} is re-planning with your words. No version can be approved while it re-plans.`
              : <>{leadName}’s plan, <b>version {v.plan.planRev}</b>, {v.plan.steps.length} steps.</>}
          </p>
          <ol data-testid="job-passage-plan" aria-label={`Plan version ${v.plan.planRev}`} className={`wk-pass-ol${v.phase === 'replanning' ? ' wk-pass-ol--dim' : ''}`}>
            {v.plan.steps.map((s, i) => <li key={`${i}:${s}`}><span className="n">{i + 1}</span><span className="l"><b>{s}</b></span></li>)}
          </ol>
        </>
      )}
      {v.phase === 'replanning' && v.plan === null && (
        <p data-testid="job-passage-replanning" className="wk-pass-sub">{leadName} is re-planning with your words. No version can be approved while it re-plans.</p>
      )}

      {progress !== null && (
        <>
          <p data-testid="job-passage-fold" className="wk-pass-fold">
            <span aria-hidden className="wk-pass-ok">✓ </span>{foldLine(progress)}
            {runId !== null && <> <button type="button" className="wk-pass-inl" data-testid="job-passage-details" onClick={() => openSheet({ kind: 'session', sessionId: `run:${runId}` })}>Details ›</button></>}
          </p>
          {progress.current !== null && run !== null && (v.phase === 'running' || v.phase === 'gate' || v.phase === 'runQuestion') && (
            <div data-testid="job-passage-now" className="wk-pass-now">
              <p><span className="n">{progress.current.ord + 1}</span> <b>{progress.current.label}</b>{progress.current.state === 'waiting' && <em className="wk-pass-asks"> asks you</em>}</p>
              {v.phase === 'running' && (
                <div className={`wk-pass-report${moreOpen ? '' : ' wk-pass-report--clamp'}`}>
                  <LiveActivity runId={run.session.id} ord={progress.current.ord} kind="step" seat={progress.current.seat} label="this step" />
                </div>
              )}
              {v.phase === 'running' && (runEvents?.length ?? 0) > 0 && (
                <button type="button" className="wk-pass-inl" data-testid="job-passage-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((m) => !m)}>{moreOpen ? 'Less' : 'More'}</button>
              )}
              {/* A gate unfolds under its step: the existing gate renderer, its replies and its 10 s undo unchanged. */}
            </div>
          )}
          {/* The gate unfolds under its step, anchored to its own ord (drawn even when no step row matches it). */}
          {run !== null && v.phase === 'gate' && <PassageGate run={run} gate={gate} {...(navigate !== undefined ? { navigate } : {})} />}
          {/* A run's question (and a stalled step handed to you), answered here: never only a marker for a dock it isn't in. */}
          {run !== null && (v.phase === 'running' || v.phase === 'gate' || v.phase === 'runQuestion') && (
            <div className="wk-pass-gate" data-testid="job-passage-run-question"><Undocked><RunQuestions view={run} /></Undocked></div>
          )}
          {progress.next !== null && (v.phase === 'running' || v.phase === 'gate' || v.phase === 'runQuestion') && (
            <p data-testid="job-passage-next" className="wk-pass-next"><span>next</span> {progress.next.label}{progress.more > 0 && ` · ${progress.more} more`}</p>
          )}
        </>
      )}
      {v.checks.length > 0 && (v.phase === 'running' || v.phase === 'gate' || v.phase === 'runQuestion' || v.phase === 'planHeld') && (
        <p data-testid="job-passage-checks" className="wk-pass-checks">
          {/* The checks the job carries, by name and fixed to it. Their results are their records' (Details): none is
              claimed here, passed or not run. */}
          <span className="wk-pass-grey">checked by</span>
          {v.checks.map((c) => <span key={c.id}>{c.label}<span aria-hidden className="wk-pass-lock" /></span>)}
        </p>
      )}

      {v.phase === 'delivered' && run !== null && <Delivered run={run} />}
      {v.phase === 'stopped' && run !== null && (
        <p data-testid="job-passage-stopped" className="wk-pass-sub">Stopped. {progress !== null ? `${progress.done} of ${progress.total} steps had run.` : ''} {deliverySummary(run) ?? ''}</p>
      )}
      {v.phase === 'failed' && run !== null && (
        <p data-testid="job-passage-failed" className="wk-pass-sub">
          Failed. {failureWhy(run, (runEvents ?? []) as unknown as Record<string, unknown>[]).plain} {deliverySummary(run) ?? ''}{' '}
          <button type="button" className="wk-pass-inl" onClick={() => openSheet({ kind: 'session', sessionId: `run:${run.session.id}` })}>Look underneath</button>
        </p>
      )}

      {v.phase === 'planHeld' && v.plan === null && planRetry !== null && (
        <p data-testid="job-passage-plan-unread" role="alert" className="wk-pass-sub wk-pass-error">
          The plan couldn’t be read, so nothing can be approved yet.{' '}
          <button type="button" className="wk-pass-inl" data-testid="job-passage-plan-retry" onClick={planRetry}>Retry</button>
        </p>
      )}
      {v.phase === 'starting' && runRetry !== null && (
        <p data-testid="job-passage-run-unread" role="alert" className="wk-pass-sub wk-pass-error">
          The job’s run couldn’t be read.{' '}
          <button type="button" className="wk-pass-inl" onClick={runRetry}>Retry</button>
        </p>
      )}
      {/* What the run's block drew for it and the passage now holds: a restart's Resume, a power checkpoint's answer,
          and what the run made (a document, a deck, a walkthrough, a demo video). */}
      {run !== null && <PassageRunExtras run={run} sessionId={sessionId} gateOpen={gate !== undefined} />}

      {/* crew's offers at the plan held now (Lane D): only a press on one calls a route, bound to its version. */}
      {v.offers.filter((o) => !dismissed.has(o.id)).map((o) => (
        <div key={o.id} data-testid="job-passage-offer" data-kind={o.kind} className="wk-pass-ask">
          <span className="wk-pass-ask-who">wicked offers · plan v{o.planRev}</span>
          <p>{o.text}</p>
          <div role="group" aria-label="Answer wicked's offer" className="wk-pass-acts">
            {o.choices.map((c, i) => {
              const id = `offer:${o.id}:${c.action}` as const;
              const target = `offer:${o.id}:${o.ord}:${o.planRev}`;
              const reshapeHeld = c.action === 'dismiss' ? null : v.offerHeld !== null ? v.offerHeld
                : c.action === 'reshape' && v.reshapeHeld !== null ? v.reshapeHeld
                : c.action === 'reshape' && (o.reshape?.needs.length ?? 0) > 0 ? `it needs ${o.reshape!.needs.join(', ')}: say it in the chat` : null;
              const go = (): void => {
                if (c.action === 'dismiss') setDismissed((d) => new Set([...d, o.id]));
                else if (c.action === 'send_back') sendBack(o.note ?? '', o.planRev, null);
                else reshape(o);
              };
              return (
                <Fragment key={c.action}>
                  {i > 0 && <span aria-hidden className="wk-pass-dot">·</span>}
                  <button type="button" data-testid="job-passage-offer-choice" data-action={c.action} disabled={reshapeHeld !== null}
                    className={`wk-pass-act${i === 0 ? ' wk-pass-act--go' : ''}`} {...press.bind(id, target, go, changedWords)}>{c.label}</button>
                  {reshapeHeld !== null && <span className="wk-pass-why">{reshapeHeld}</span>}
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}

      {/* studio's own receipt for an answer in its undo window: never a tick, until crew records it (rev 6 §2.7.1). */}
      {queued !== null && (v.phase === 'planHeld' || v.phase === 'replanning') && (
        <p data-testid="job-passage-queued" className="wk-pass-receipt">
          {QUEUED_WORD[queued.verb] ?? 'Your answer'}: queued, not sent yet · sends in {Math.max(0, Math.ceil((queued.dueAt - Math.max(now, queued.queuedAt)) / 1000))} s ·{' '}
          <button type="button" data-testid="job-passage-undo" className="wk-pass-act" {...press.bind('undo', `queued:${queued.id}`, () => undoDecision(queued.id), 'That answer was replaced.')}>Undo</button>
        </p>
      )}

      {replies.length > 0 && confirmStop === null && (
        <div role="group" aria-label={`Replies to the job, ${v.versionLabel}`} data-testid="job-passage-replies" className="wk-pass-acts">
          {replies.map((r, i) => {
            const binds = bound !== null && bound.replyKey === `${lineage.lineage}:${r.id}`;
            return (
              <Fragment key={r.id}>
                {i > 0 && <span aria-hidden className="wk-pass-dot">·</span>}
                <button type="button" data-testid="job-passage-reply" data-reply={r.id} disabled={!r.enabled}
                  className={`wk-pass-act wk-pass-act--${r.tone}`} {...press.bind(r.id, r.target, () => act(r), changedWords)}>
                  {r.label}{r.id === 'start' && r.enabled ? ' →' : ''}{binds ? ' · answering' : ''}
                </button>
                {!r.enabled && r.held !== undefined && <span data-testid="job-passage-held" className="wk-pass-why">{r.held}</span>}
              </Fragment>
            );
          })}
          {(v.phase === 'proposed') && <span className="wk-pass-why">or just say what to change</span>}
        </div>
      )}
      {confirmStop !== null && confirmStop === runId && (
        <div role="group" aria-label="Stop the job?" className="wk-pass-acts" data-testid="job-passage-stop-confirm">
          <span className="wk-pass-why">Stop the job? What it did so far is kept, and you have 10 s to undo.</span>
          <button type="button" className="wk-pass-act wk-pass-act--go" data-testid="job-passage-stop-yes"
            {...press.bind('stop-yes', `stop:${confirmStop}`, () => { const id = confirmStop; setConfirmStop(null); stopRun([id], `“${v.proposal.what.label}”`); }, 'The job’s run changed.')}>Stop the job</button>
          <span aria-hidden className="wk-pass-dot">·</span>
          <button type="button" className="wk-pass-act" onClick={() => setConfirmStop(null)}>Keep going</button>
        </div>
      )}
      {press.note !== null && <p data-testid="job-passage-press-note" role="status" className="wk-pass-why">{press.note.text}</p>}
      {lost !== null && v.phase === 'swapPending' && (
        <p data-testid="job-passage-lost" role="alert" className="wk-pass-sub wk-pass-error">
          Studio’s service didn’t answer, so your change may or may not have landed. Start waits until it does.{' '}
          <button type="button" className="wk-pass-inl" data-testid="job-passage-retry"
            onClick={() => { if (lost.body.revises === pid && useJobLocal.getState().swapRequest[lineage.lineage] === lost.body.requestId) sendRevision(lost.body, lost.token); else setLost(null); }}>Try again</button>
        </p>
      )}
      {error !== null && <p data-testid="job-passage-error" role="alert" className="wk-pass-sub wk-pass-error">{error}</p>}
      <div aria-live="polite" className="wk-visually-hidden" data-testid="job-passage-live">{announce}</div>
    </section>
  );
}

/** A swappable token: an inline `role="button"` (a native button cannot break across lines, §8.7) opening a listbox
 *  of crew's choices plus "Something else…". The checks token opens an explanation instead. */
function TokenButton({ token, label, wash, open, expanded, held, tokenRef, explainId, onOpen, onPick, onClose }: {
  token: ProposalToken; label: string; wash: string; open: boolean; expanded: boolean;
  /** A change is in flight: the token stays focusable, says it is held, and opens nothing. */
  held: boolean;
  tokenRef: (el: HTMLSpanElement | null) => void;
  /** The checks explanation's id (a disclosure, not a dialog). */
  explainId: string;
  onOpen: () => void; onPick: (i: number | 'else') => void; onClose: () => void;
}): React.ReactElement {
  const ref = useRef<HTMLSpanElement | null>(null);
  const listId = useId();
  const choices = token.swap?.choices ?? [];
  const [cursor, setCursor] = useState(0);
  const count = choices.length + 1;
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  useEffect(() => { if (open) { setCursor(0); queueMicrotask(() => optionRefs.current[0]?.focus()); } }, [open]);
  // The listbox closed (a pick, or crew's next version closed it): focus that was in it comes back to the token, never
  // to the page; focus the pick sent elsewhere (Something else… → the composer) stays there.
  const wasOpen = useRef(open);
  /** Focus is in the listbox (set on focus within it, cleared when it leaves for somewhere else). */
  const focusIn = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const a = document.activeElement;
      if (focusIn.current && (a === null || a === document.body)) ref.current?.focus();
    }
    if (!open) focusIn.current = false;
    wasOpen.current = open;
  }, [open]);
  const close = (): void => { onClose(); ref.current?.focus(); };
  const checks = token.kind === 'checks';
  return (
    <span className="wk-pass-tokwrap">
      <span
        ref={(el) => { ref.current = el; tokenRef(el); }} role="button" tabIndex={0} data-testid="job-passage-token" data-token={token.id} data-kind={token.kind}
        {...(held ? { 'aria-disabled': true } : {})}
        {...(checks ? (expanded ? { 'aria-controls': explainId } : {}) : { 'aria-haspopup': 'listbox' as const })} aria-expanded={expanded} {...(open ? { 'aria-controls': listId } : {})}
        aria-label={`${label}, ${TOKEN_KIND[token.kind]}`} aria-description={checks ? 'Why these checks stay' : 'Change it'}
        className={`wk-pass-tok${checks ? ' wk-pass-tok--chk' : ''}${wash}`}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      >{label}{checks && <span aria-hidden className="wk-pass-lock" />}</span>
      {open && !checks && (
        <ul id={listId} role="listbox" aria-label={`Change ${TOKEN_KIND[token.kind]}`} data-testid="job-passage-swap" className="wk-pass-swap"
          onFocus={() => { focusIn.current = true; }}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusIn.current = false; }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); const n = (cursor + 1) % count; setCursor(n); optionRefs.current[n]?.focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); const n = (cursor - 1 + count) % count; setCursor(n); optionRefs.current[n]?.focus(); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(cursor < choices.length ? cursor : 'else'); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
          }}>
          {choices.map((c, i) => (
            <li key={i} ref={(el) => { optionRefs.current[i] = el; }} role="option" tabIndex={-1} aria-selected={cursor === i}
              data-testid="job-passage-swap-option" onClick={() => onPick(i)}>{c.label}</li>
          ))}
          <li ref={(el) => { optionRefs.current[choices.length] = el; }} role="option" tabIndex={-1} aria-selected={cursor === choices.length}
            data-testid="job-passage-swap-else" onClick={() => onPick('else')}>Something else…</li>
        </ul>
      )}
    </span>
  );
}

/** The delivery: what the run handed over and what was checked, each from its record (never more than it says). */
function Delivered({ run }: { run: SessionView }): React.ReactElement {
  const handed = handedOf(run);
  const pr = deliverySummary(run);
  return (
    <div data-testid="job-passage-delivered" className="wk-pass-done">
      <p className="wk-pass-sub">
        <b>Done.</b> {outcomeLine(run)}
        {handed?.href != null && <> · <a href={handed.href} target="_blank" rel="noreferrer">{pr ?? 'the pull request'}</a></>}
        {handed?.href == null && handed?.branch != null && <> · branch <code>{handed.branch}</code></>}
      </p>
      <RunAssuranceLabel view={run} />
      <p className="wk-pass-grey wk-pass-sub">What was checked, each from its record, is in{' '}
        <button type="button" className="wk-pass-inl" onClick={() => openSheet({ kind: 'session', sessionId: `run:${run.session.id}` })}>Details ›</button>
      </p>
    </div>
  );
}

/** Whether the passage needs a clock: an answer of this job waits in its undo window, or a Go is starting. */
function useJobTicking(lineage: JobLineage, runs: readonly SessionView[]): boolean {
  const run = jobRunId(lineage, runs);
  const queued = useUndoQueue((s) => run !== null && s.pending.some((p) => p.runIds.includes(run)));
  return queued || lineage.state === 'accepting';
}

/** A gate under its step (§2.8.1): the existing renderers, unchanged and in place. A hand-over is the plan and
 *  hand-over card's (its consent, receipt and drift), every other gate GateRow's. */
function PassageGate({ run, gate, navigate }: { run: SessionView; gate: ReturnType<typeof useGateStore.getState>['gates'][string] | undefined; navigate?: Navigate }): React.ReactElement {
  const { chain } = useRunChain(run);
  const deliver = gate !== undefined && proposalKindOf(run.session.id, gate, run.units) === 'deliver';
  return (
    <div className="wk-pass-gate" data-testid="job-passage-gate" data-kind={deliver ? 'deliver' : 'gate'}>
      <Undocked>
        {deliver ? <ProposalCard view={run} chain={chain} variant="chat" /> : <GateRow view={run} gate={gate} {...(navigate !== undefined ? { navigate } : {})} />}
      </Undocked>
    </div>
  );
}

/** The run's other in-place renderers, unchanged: a daemon restart's Resume, a power checkpoint (not an engine gate:
 *  the run stays executing), and what the run made, each growing inline → pane → full as on the run's block. */
function PassageRunExtras({ run, sessionId, gateOpen }: { run: SessionView; sessionId: string; gateOpen: boolean }): React.ReactElement {
  const { chain } = useRunChain(run);
  const power = usePower(run);
  const live = !['completed', 'cancelled', 'failed'].includes(run.session.status);
  return (
    <Undocked>
      <OrphanedRow view={run} />
      {power?.pause != null && live && !gateOpen && <div className="wk-pass-gate" data-testid="job-passage-power"><PowerPauseCard view={run} power={power} /></div>}
      <RunArtifacts view={run} composerKey={sessionId} chain={chain} only="made" frame={(_who, _suffix, cards) => <div className="wk-pass-made" data-testid="job-passage-made">{cards}</div>} />
    </Undocked>
  );
}
