import { useEffect, useId, useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '../../api/client.js';
import type { AskAnswer } from '../../api/ask.js';
import type { ArtifactProposal, ChatProposalView, ProposalSource } from '../../api/chatArtifacts-wire.js';
import {
  changeRoute,
  GO_WORDS,
  noteSettled,
  proposalAsk,
  proposalRecordLine,
  proposalRefusal,
  proposalResultWords,
  proposalTimeWords,
  type ProposalEntry,
} from '../../board/artifactProposal.js';
import { AskCard, AskRecord } from '../ask/AskCard.js';

/**
 * A CHAT'S PROPOSAL CARD (DES-CHAT-ARTIFACTS-001 §4.2, slice A2): what a seat proposed to make, drawn from crew's own
 * resolution — What, the brief or what to show, From (a struck source says why the draft will never see it), About,
 * Helpers, Time and cost, Stops, Filed in — answered on `AskCard` (`host: 'chat'`). The primary (Make it / Make the
 * change / Preview) is preselected but never focused, so Enter in the composer still sends a message. Only a click
 * answers it: Go and Not now go to `POST /chats/:id/proposals/:pid`; Change something is routed per kind (a note until
 * each kind's slice lands). Once answered or replaced, the card collapses to its headline and one record line, with the
 * facts behind Details; an interrupted Go offers Go again.
 */
export interface ArtifactProposalCardProps {
  chatId: string;
  /** The proposal as this tab draws it (already reconciled: a settled one never reopens). */
  entry: ProposalEntry;
  /** The proposing seat's display name ("Claude Code"). */
  seatName: string;
  /** The daemon runs the test configuration (Go starts nothing): said on the card. */
  stub: boolean;
  /** Something was recorded (or refused): re-read the chat. */
  onChanged: () => void;
}

const terminal = (s: ChatProposalView['state']): boolean => s === 'decided' || s === 'superseded';

export function ArtifactProposalCard({ chatId, entry, seatName, stub, onChanged }: ArtifactProposalCardProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  // The daemon's answer to THIS card's request, shown at once while the re-read catches up — only a settled one (an
  // open or accepting view from a refusal is left to the re-read, which carries crew's newest facts).
  const [answered, setAnswered] = useState<ProposalEntry | null>(null);
  const view: ProposalEntry = answered !== null && !terminal(entry.state) ? answered : entry;
  const p = view.proposal;
  const open = view.state === 'open';
  const detailsId = useId();
  // A card that settles drops what it said while it was open.
  useEffect(() => {
    if (!open) setNote(null);
  }, [open]);

  const decide = (decision: 'go' | 'not_now'): void => {
    setBusy(true);
    setError(null);
    setNote(null);
    const keep = (v: ChatProposalView): void => {
      if (!terminal(v.state)) return;
      const settled: ProposalEntry = { ...entry, ...v };
      noteSettled(chatId, settled);
      setAnswered(settled);
    };
    api.decideChatProposal(chatId, entry.pid, { decision })
      .then((r) => keep(r.view))
      .catch((err: unknown) => {
        const refusal = proposalRefusal(err);
        setError(refusal.words);
        if (refusal.view !== null) keep(refusal.view);
      })
      .finally(() => {
        setBusy(false);
        onChanged();
      });
  };
  const onAnswer = (a: AskAnswer): void => {
    if (a.option === 'go' || a.option === 'not_now') decide(a.option);
    else if (a.option === 'change') {
      setError(null);
      setNote(changeRoute(p.kind).note);
    }
  };

  const line = proposalRecordLine(view);
  const result = proposalResultWords(view);
  return (
    <section
      data-testid="artifact-proposal"
      data-pid={entry.pid}
      data-kind={p.kind}
      data-state={view.state}
      aria-label={`Proposal from ${seatName}: ${p.what.label}`}
      className={`wk-ask wk-proposal${open ? '' : ' wk-proposal--settled'}`}
    >
      <p className="wk-ask-who">
        <FileText size={16} aria-hidden />
        <span>{open ? `Proposal from ${seatName} · nothing starts until you choose` : `Proposal from ${seatName}`}</span>
      </p>
      <p className="wk-ask-q" data-testid="artifact-proposal-what">{p.what.label}</p>
      {open || view.state === 'accepting' || details ? (
        <>
          {p.what.outcome !== null && <p className="wk-ask-sub">{p.what.outcome}</p>}
          <ProposalLines p={p} id={detailsId} />
        </>
      ) : null}
      {open && p.blocked !== null && (
        <p data-testid="artifact-proposal-blocked" className="wk-proposal-blocked">
          <b>Can’t start here yet.</b> {p.blocked}. Nothing was started.
        </p>
      )}
      {open && stub && (
        <p data-testid="artifact-proposal-stub" className="wk-proposal-stub">Test configuration: {GO_WORDS[p.kind]} records your click and starts nothing.</p>
      )}
      {open ? (
        <AskCard ask={proposalAsk(view, { stub })} header={false} busy={busy} onAnswer={onAnswer}
          confirmLabel={(o) => (o.id === 'change' ? 'Change something' : o.label)}
          testIds={{ root: 'artifact-proposal-ask', confirm: 'artifact-proposal-confirm' }} />
      ) : view.state === 'accepting' ? (
        <div className="wk-proposal-again">
          <AskRecord line={line ?? ''} testId="artifact-proposal-record" />
          <button type="button" data-testid="artifact-proposal-go-again" className="wk-btn wk-btn--primary wk-btn--sm" disabled={busy} onClick={() => decide('go')}>Go again</button>
        </div>
      ) : (
        <div className="wk-proposal-settled">
          <AskRecord line={line ?? ''} testId="artifact-proposal-record" {...(result !== null ? { meta: result } : {})} />
          <button type="button" data-testid="artifact-proposal-details" className="wk-btn wk-btn--quiet wk-btn--sm"
            aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails((d) => !d)}>
            {details ? 'Hide details' : 'Details'}
          </button>
        </div>
      )}
      {open && note !== null && <p data-testid="artifact-proposal-note" role="status" className="wk-proposal-note">{note}</p>}
      {error !== null && view.state !== 'superseded' && <p data-testid="artifact-proposal-error" role="alert" className="wk-proposal-error">{error}</p>}
    </section>
  );
}

/** Crew's facts, one per line, each only when crew stated it. */
function ProposalLines({ p, id }: { p: ArtifactProposal; id: string }): React.ReactElement {
  const time = proposalTimeWords(p);
  return (
    <dl id={id} className="wk-proposal-lines" data-testid="artifact-proposal-lines">
      {p.target !== undefined && <Row k="Changes" testId="artifact-proposal-target">{p.target.title} · v{p.target.base}</Row>}
      {p.kind === 'refine' && p.brief !== null && <Row k="Ask" testId="artifact-proposal-brief">{p.brief}</Row>}
      {p.kind === 'create' && p.brief !== null && p.brief !== '' && <Row k="Brief" testId="artifact-proposal-brief">{p.brief}</Row>}
      {p.touches !== undefined && p.touches.length > 0 && <Row k="Parts" testId="artifact-proposal-touches">{p.touches.join(', ')}</Row>}
      {p.theme !== undefined && <Row k="Changes" testId="artifact-proposal-theme">{p.theme.changes.join(', ')}</Row>}
      {p.demo !== undefined && <Row k="Records" testId="artifact-proposal-demo">{p.demo.url}</Row>}
      {p.demo !== undefined && p.demo.audience !== null && <Row k="For" testId="artifact-proposal-audience">{p.demo.audience}</Row>}
      {p.demo !== undefined && p.demo.show !== null && <Row k="Shows" testId="artifact-proposal-show">{p.demo.show}</Row>}
      {p.sources.length > 0 && (
        <Row k="From" testId="artifact-proposal-from">
          <span className="wk-proposal-chips">{p.sources.map((s) => <SourceChip key={s.token} s={s} />)}</span>
        </Row>
      )}
      {p.repos.length > 0 && <Row k="About" testId="artifact-proposal-about">{p.repos.join(', ')}</Row>}
      {p.helpers !== null && <Row k="Helpers" testId="artifact-proposal-helpers">{p.helpers.label}</Row>}
      {time !== null && <Row k="Time, cost" testId="artifact-proposal-time">{time}</Row>}
      {p.stops !== null && <Row k="Stops" testId="artifact-proposal-stops">{p.stops}</Row>}
      <Row k="Filed in" testId="artifact-proposal-filed">{p.filedIn.label}</Row>
      {p.reason !== null && p.reason !== '' && <Row k="Why" testId="artifact-proposal-reason">{p.reason}</Row>}
    </dl>
  );
}

function Row({ k, testId, children }: { k: string; testId: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="wk-proposal-row" data-testid={testId}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A source chip. A struck one says so in words (read the same way aloud and on screen), with crew's reason verbatim. */
function SourceChip({ s }: { s: ProposalSource }): React.ReactElement {
  if (s.status === 'ok') return <span data-testid="artifact-proposal-source" data-status="ok" className="wk-proposal-chip">{s.label}</span>;
  const reason = s.reason !== undefined && s.reason.trim() !== '' ? s.reason : null;
  return (
    <span data-testid="artifact-proposal-source" data-status="struck" className="wk-proposal-chip wk-proposal-chip--struck">
      <span className="wk-sr-only">Left out: </span>
      <s>{s.label}</s>
      <span className="wk-proposal-chip-why">{reason !== null ? ` · ${reason}` : ' · left out'}</span>
    </span>
  );
}
