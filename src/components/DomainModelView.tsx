/**
 * (J6 S1, DES-j6-build S4 + §7) A repository's domain model: the header in words, the rule groups by area, and the
 * follow-ups with the ruling that settles each. Rulings go to crew (`POST /repos/:id/requirements/rulings`) with the
 * statement key and target hash this model gives; every answer, saved or refused, is followed by a fresh read.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { DomainFollowup, DomainGroupSentence, DomainModel, DomainStatement } from '../api/domainModel-wire.js';
import {
  followupAction,
  followupsInOrder,
  groupsByArea,
  modelHeadline,
  rulingBodyFor,
  rulingRefusalWords,
  TARGET_CONFIRM_WORDS,
  whereLine,
} from '../board/domainModel.js';

export type DomainTab = 'rules' | 'followups';

const STATUS_WORDS: Record<DomainStatement['status'], string> = {
  Checked: 'Checked by a second helper',
  confirmed: 'Confirmed by you',
  open: 'Not confirmed: see its follow-up',
  stale: 'The code changed since: the next run checks it again',
};

const KIND_WORDS: Record<string, string> = {
  flagged: 'Flagged',
  open: 'Open',
  refused: 'Not stated',
  scope: 'Scope',
};

export function DomainModelHeadline({ model }: { model: DomainModel }): React.ReactElement {
  return (
    <span data-testid="domain-model-headline" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
      {modelHeadline(model)}
    </span>
  );
}

/** After any ruling answer (saved or refused): read the model again; null when the read landed, else why not. */
type Reread = (forRepo: string) => Promise<string | null>;

export function DomainModelView({ repoId, model, tab, held = false, onRuled }: {
  repoId: string;
  model: DomainModel;
  tab: DomainTab;
  /** The model on screen may be out of date (its last read failed): no ruling is offered on it. */
  held?: boolean;
  onRuled: Reread;
}): React.ReactElement {
  return tab === 'rules' ? <RulesTab model={model} /> : <FollowupsTab repoId={repoId} model={model} held={held} onRuled={onRuled} />;
}

/**
 * A ruling out, by repository and follow-up (codex S1 r1): it outlives the tab and the row that sent it, so a row shown
 * again holds its buttons until the answer and the read after it land, and says the outcome. An outcome that lands with
 * no row on screen (the Rules tab open) is said once, when the row shows next.
 */
const rulingsInFlight = new Map<string, Promise<string | null>>();
const rulingSaid = new Map<string, string>();
const rowsShown = new Map<string, number>();

function RulesTab({ model }: { model: DomainModel }): React.ReactElement {
  const areas = groupsByArea(model);
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(model.statements.map((s) => [s.id, s] as const));
  if (areas.length === 0) {
    return (
      <p data-testid="domain-rules-empty" className="text-sm p-6" style={{ color: 'var(--ink-muted)' }}>
        No rule groups yet. The statements and follow-ups are still listed: check the Follow-ups tab.
      </p>
    );
  }
  const sentence = (s: DomainGroupSentence, lead: boolean): React.ReactElement => {
    const cited = s.cites.map((c) => byId.get(c)).filter((x): x is DomainStatement => x !== undefined);
    const shown = open === s.id;
    return (
      <li key={s.id} className="wk-domain-sentence" data-lead={lead ? 'true' : 'false'}>
        <button
          type="button"
          className="wk-domain-sentence-text"
          aria-expanded={shown}
          data-testid="domain-sentence"
          onClick={() => setOpen(shown ? null : s.id)}
        >
          {s.text}
          <span className="wk-domain-cites">{cited.length === 1 ? '1 statement' : `${cited.length} statements`}</span>
        </button>
        {shown && (
          <ul className="wk-domain-statements" data-testid="domain-sentence-statements">
            {cited.map((st) => (
              <li key={st.id} data-status={st.status}>
                <div className="wk-domain-statement-meta">
                  <span>{STATUS_WORDS[st.status] ?? st.status}</span>
                  {st.sourceRef !== null && <code>{st.sourceRef.replace('#L', ':').replace('-L', '-')}</code>}
                </div>
                <pre className="wk-domain-statement-text">{st.text}</pre>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };
  return (
    <div data-testid="domain-rules" className="wk-domain-rules">
      {areas.map(({ area, groups }, i) => (
        <section key={`${i}:${area}`} className="wk-domain-area" data-testid="domain-area">
          <h3 className="wk-domain-area-title">{area}</h3>
          {groups.map((g) => (
            <article key={g.id} className="wk-domain-group" data-kind={g.kind} data-testid="domain-group">
              <h4 className="wk-domain-group-title">
                {g.title}
                {g.kind === 'housekeeping' && <span className="wk-domain-tag">Housekeeping</span>}
                {g.stale && <span className="wk-domain-tag" data-tone="warn">Code changed since</span>}
              </h4>
              <ul className="wk-domain-sentences">
                {g.rule !== null && sentence(g.rule, true)}
                {g.details.map((d) => sentence(d, false))}
              </ul>
              {g.withheld.length > 0 && (
                <details className="wk-domain-withheld" data-testid="domain-withheld">
                  <summary>{g.withheld.length === 1 ? '1 sentence withheld' : `${g.withheld.length} sentences withheld`}: the check did not support {g.withheld.length === 1 ? 'it' : 'them'}</summary>
                  <ul>
                    {g.withheld.map((w) => <li key={w.id}>{w.text} <span className="wk-domain-why">({w.reason})</span></li>)}
                  </ul>
                </details>
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function FollowupsTab({ repoId, model, held, onRuled }: { repoId: string; model: DomainModel; held: boolean; onRuled: Reread }): React.ReactElement {
  const rows = followupsInOrder(model);
  if (rows.length === 0) {
    return <p data-testid="domain-followups-empty" className="text-sm p-6" style={{ color: 'var(--ink-muted)' }}>Nothing to follow up: every target is accounted for.</p>;
  }
  return (
    <ol data-testid="domain-followups" className="wk-domain-followups">
      {rows.map((f) => <FollowupRow key={`${repoId}\u0000${f.id}`} repoId={repoId} model={model} f={f} held={held} onRuled={onRuled} />)}
    </ol>
  );
}

function FollowupRow({ repoId, model, f, held, onRuled }: { repoId: string; model: DomainModel; f: DomainFollowup; held: boolean; onRuled: Reread }): React.ReactElement {
  const action = followupAction(model, f);
  const id = `${repoId}\u0000${f.id}`;
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(() => rulingsInFlight.has(id));
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const settle = (said: string | null, saved: boolean): void => {
    if (!alive.current) return;
    setBusy(false);
    setError(said);
    if (saved) setRejecting(false);
  };
  useEffect(() => {
    alive.current = true;
    rowsShown.set(id, (rowsShown.get(id) ?? 0) + 1);
    // Shown again while its ruling is still out: held, and told the outcome; or told an outcome that landed unseen.
    const pending = rulingsInFlight.get(id);
    if (pending !== undefined) void pending.then((said) => settle(said, false));
    else if (rulingSaid.has(id)) {
      setError(rulingSaid.get(id)!);
      rulingSaid.delete(id);
    }
    return () => {
      alive.current = false;
      rowsShown.set(id, (rowsShown.get(id) ?? 1) - 1);
    };
  }, [id]);
  const where = whereLine(f);
  const statement = f.statement !== null ? model.statements.find((st) => st.id === f.statement) ?? null : null;
  function rule(kind: 'confirm' | 'reject'): void {
    const body = rulingBodyFor(model, f, kind, note);
    if (body === null || held || rulingsInFlight.has(id)) return;
    setBusy(true);
    setError(null);
    rulingSaid.delete(id);
    let saved = false;
    // The buttons stay held until the answer AND the read after it land: the row is never offered again on the model
    // the ruling was made against.
    const out = (async (): Promise<string | null> => {
      let said: string | null = null;
      try {
        const r = await api.domainRuling(repoId, body);
        saved = true;
        if (!r.build.rebuilt) said = `Saved. The model was not rebuilt yet: ${r.build.error}`;
      } catch (e: unknown) {
        said = rulingRefusalWords(e);
      }
      const reread = await onRuled(repoId);
      if (reread !== null) said = `${said ?? (saved ? 'Saved.' : '')} The model could not be read again: ${reread}`.trim();
      return said;
    })();
    rulingsInFlight.set(id, out);
    void out.then((said) => {
      rulingsInFlight.delete(id);
      if (alive.current) settle(said, saved);
      else if (said !== null && (rowsShown.get(id) ?? 0) === 0) rulingSaid.set(id, said);
    });
  }
  return (
    <li className="wk-domain-followup" data-testid="domain-followup" data-kind={f.kind} data-ruled={f.ruling !== null ? f.ruling.action : 'no'}>
      <div className="wk-domain-followup-head">
        <span className="wk-domain-tag" data-tone={f.kind === 'flagged' ? 'warn' : undefined}>{KIND_WORDS[f.kind] ?? f.kind}</span>
        {where !== null && <code data-testid="domain-followup-where">{where}</code>}
        {f.ruling !== null && (
          <span className="wk-domain-ruled" data-testid="domain-followup-ruled">
            {f.ruling.action === 'confirm' ? 'Confirmed' : 'Rejected'} by {f.ruling.by}{f.ruling.note !== undefined ? `: ${f.ruling.note}` : ''}
          </span>
        )}
      </div>
      <dl className="wk-domain-followup-body">
        {statement !== null && (
          <>
            <dt>The statement</dt>
            <dd><pre className="wk-domain-statement-text" data-testid="domain-followup-statement">{statement.text}</pre></dd>
          </>
        )}
        <dt>What is unknown</dt>
        <dd>{f.unknown}</dd>
        <dt>What to check</dt>
        <dd>{f.check}</dd>
      </dl>
      {action !== 'none' && !rejecting && (
        <div className="wk-domain-followup-actions">
          <button type="button" className="wk-btn wk-btn--primary" data-testid="domain-followup-confirm" disabled={busy || held} onClick={() => rule('confirm')}>
            {action === 'target' ? `Confirm: ${TARGET_CONFIRM_WORDS.toLowerCase()}` : 'Confirm: it holds'}
          </button>
          {action === 'statement' && (
            <button type="button" className="wk-btn" data-testid="domain-followup-reject" disabled={busy || held} onClick={() => setRejecting(true)}>
              Reject…
            </button>
          )}
        </div>
      )}
      {rejecting && (
        <form
          className="wk-domain-followup-reject"
          onSubmit={(e) => {
            e.preventDefault();
            rule('reject');
          }}
        >
          <label>
            What is wrong? The next run reads this.
            <textarea data-testid="domain-followup-note" className="wk-field" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="wk-domain-followup-actions">
            <button type="submit" className="wk-btn wk-btn--primary" data-testid="domain-followup-reject-send" disabled={busy || held || note.trim() === ''}>Reject</button>
            <button type="button" className="wk-btn" disabled={busy} onClick={() => { setRejecting(false); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}
      {error !== null && <p role="alert" data-testid="domain-followup-error" className="wk-domain-error">{error}</p>}
    </li>
  );
}
