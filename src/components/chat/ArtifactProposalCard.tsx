import { useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '../../api/client.js';
import type { AskAnswer } from '../../api/ask.js';
import type { ChatProposalView, ProposalSource } from '../../api/chatArtifacts-wire.js';
import {
  changeRoute,
  GO_WORDS,
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
 * resolution — What, From (a struck chip says why the draft will never see it), About, Helpers, Time and cost, Stops,
 * Filed in — answered on `AskCard` (`host: 'chat'`). The primary (Make it / Make the change / Preview) is preselected
 * but never focused, so Enter in the composer still sends a message. Only a click answers it: Go and Not now go to
 * `POST /chats/:id/proposals/:pid`; Change something is routed per kind (a stub until each kind's slice lands). Once
 * answered, replaced or interrupted, the card is one plain line.
 */
export interface ArtifactProposalCardProps {
  chatId: string;
  entry: ProposalEntry;
  /** The proposing seat's display name ("Claude Code"). */
  seatName: string;
  /** The daemon runs the test configuration (Go starts nothing): said on the card. */
  stub: boolean;
  /** Something was recorded (or refused): re-read the chat. */
  onChanged: () => void;
}

export function ArtifactProposalCard({ chatId, entry, seatName, stub, onChanged }: ArtifactProposalCardProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The daemon's answer, shown at once while the re-read catches up.
  const [answered, setAnswered] = useState<ChatProposalView | null>(null);
  const view: ProposalEntry = answered !== null && rank(answered.state) >= rank(entry.state) ? { ...entry, ...answered } : entry;
  const p = view.proposal;

  const decide = (decision: 'go' | 'not_now'): void => {
    setBusy(true);
    setError(null);
    setNote(null);
    api.decideChatProposal(chatId, entry.pid, { decision })
      .then((r) => setAnswered(r.view))
      .catch((err: unknown) => {
        const refusal = proposalRefusal(err);
        setError(refusal.words);
        if (refusal.view !== null) setAnswered(refusal.view);
      })
      .finally(() => {
        setBusy(false);
        onChanged();
      });
  };
  const onAnswer = (a: AskAnswer): void => {
    if (a.option === 'go' || a.option === 'not_now') decide(a.option);
    else if (a.option === 'change') setNote(changeRoute(p.kind).note);
  };

  const line = proposalRecordLine(view);
  return (
    <section
      data-testid="artifact-proposal"
      data-pid={entry.pid}
      data-kind={p.kind}
      data-state={view.state}
      aria-label={`Proposal from ${seatName}: ${p.what.label}`}
      className={`wk-ask wk-proposal${view.state === 'open' ? '' : ' wk-proposal--settled'}`}
    >
      <p className="wk-ask-who">
        <FileText size={16} aria-hidden />
        <span>Proposal from {seatName} · nothing starts until you choose</span>
      </p>
      <p className="wk-ask-q" data-testid="artifact-proposal-what">{p.what.label}</p>
      {p.what.outcome !== null && <p className="wk-ask-sub">{p.what.outcome}</p>}
      <dl className="wk-proposal-lines" data-testid="artifact-proposal-lines">
        {p.target !== undefined && <Row k="Changes" testId="artifact-proposal-target">{p.target.title} · v{p.target.base}{p.brief !== null ? ` · “${p.brief}”` : ''}</Row>}
        {p.theme !== undefined && <Row k="Changes" testId="artifact-proposal-theme">{p.theme.changes.join(', ')}</Row>}
        {p.demo !== undefined && <Row k="Records" testId="artifact-proposal-demo">{p.demo.url}{p.demo.audience !== null ? ` · for ${p.demo.audience}` : ''}</Row>}
        {p.sources.length > 0 && (
          <Row k="From" testId="artifact-proposal-from">
            <span className="wk-proposal-chips">{p.sources.map((s) => <SourceChip key={s.token} s={s} />)}</span>
          </Row>
        )}
        {p.repos.length > 0 && <Row k="About" testId="artifact-proposal-about">{p.repos.join(', ')}</Row>}
        {p.helpers !== null && <Row k="Helpers" testId="artifact-proposal-helpers">{p.helpers.label}</Row>}
        {proposalTimeWords(p) !== null && <Row k="Time, cost" testId="artifact-proposal-time">{proposalTimeWords(p)}</Row>}
        {p.stops !== null && <Row k="Stops" testId="artifact-proposal-stops">{p.stops}</Row>}
        <Row k="Filed in" testId="artifact-proposal-filed">{p.filedIn.label}</Row>
      </dl>
      {view.state === 'open' && p.blocked !== null && (
        <p data-testid="artifact-proposal-blocked" className="wk-proposal-blocked">
          <b>Can’t start here yet.</b> {p.blocked}. Nothing was started.
        </p>
      )}
      {view.state === 'open' && stub && (
        <p data-testid="artifact-proposal-stub" className="wk-proposal-stub">Test configuration: {GO_WORDS[p.kind]} records your click and starts nothing.</p>
      )}
      {view.state === 'open' ? (
        <AskCard ask={proposalAsk(view, { stub })} header={false} busy={busy} onAnswer={onAnswer}
          confirmLabel={(o) => (o.id === 'change' ? 'Change something' : o.label)}
          testIds={{ root: 'artifact-proposal-ask', confirm: 'artifact-proposal-confirm' }} />
      ) : view.state === 'accepting' ? (
        <div className="wk-proposal-again">
          <AskRecord line={line ?? ''} testId="artifact-proposal-record" />
          <button type="button" data-testid="artifact-proposal-go-again" className="wk-btn wk-btn--primary wk-btn--sm" disabled={busy} onClick={() => decide('go')}>Go again</button>
        </div>
      ) : (
        <AskRecord line={line ?? ''} testId="artifact-proposal-record" {...(proposalResultWords(view) !== null ? { meta: proposalResultWords(view) } : {})} />
      )}
      {note !== null && <p data-testid="artifact-proposal-note" role="status" className="wk-proposal-note">{note}</p>}
      {error !== null && <p data-testid="artifact-proposal-error" role="alert" className="wk-proposal-error">{error}</p>}
    </section>
  );
}

/** Settled states only move forward (a stale read never reopens what the daemon just answered). */
function rank(state: ChatProposalView['state']): number {
  return state === 'open' ? 0 : state === 'accepting' ? 1 : 2;
}

function Row({ k, testId, children }: { k: string; testId: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="wk-proposal-row" data-testid={testId}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function SourceChip({ s }: { s: ProposalSource }): React.ReactElement {
  if (s.status === 'ok') return <span data-testid="artifact-proposal-source" data-status="ok" className="wk-proposal-chip">{s.label}</span>;
  return (
    <span data-testid="artifact-proposal-source" data-status="struck" className="wk-proposal-chip wk-proposal-chip--struck"
      aria-label={`${s.label}: left out, ${s.reason ?? 'not authorized'}`}>
      <s>{s.label}</s>
      <span className="wk-proposal-chip-why"> · {s.reason ?? 'left out'}</span>
    </span>
  );
}
