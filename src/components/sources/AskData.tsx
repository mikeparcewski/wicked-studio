import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, MessageSquare, X } from 'lucide-react';
import { ApiError } from '../../api/errors.js';
import { sourcesApi, type SourceCheckResponse, type SourceQueryResponse } from '../../api/sources.js';

type Ran = Extract<SourceQueryResponse, { ran: true }>;

/** What crew said about one exact SQL text: its check, and its run token when the check passed. */
interface Checked {
  text: string;
  check: SourceCheckResponse;
  confirm: string | null;
}

const words = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const codeOf = (e: unknown): string | null => {
  const c = e instanceof ApiError ? (e.body as { code?: unknown } | undefined)?.code : undefined;
  return typeof c === 'string' ? c : null;
};

/** A cell as text: `null` reads as null, JSON values as their JSON. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * The check in words: what it returns, or why crew refused it (and that nothing ran). `ran`: a run of this
 * text was tried since, so "nothing has run yet" is no longer said.
 */
export function checkWords(c: SourceCheckResponse, ran = false): { tone: 'ok' | 'fail'; text: string } {
  if (c.ok) {
    const cols = c.columns.map((x) => `${x.name} (${x.type})`).join(', ');
    return { tone: 'ok', text: `Passes the read policy${cols !== '' ? `: returns ${cols}` : ''}.${ran ? '' : ' Nothing has run yet.'}` };
  }
  return { tone: 'fail', text: `Refused (${c.code}): ${c.detail}. Nothing ran.` };
}

/** Why a draft could not be had, as a headline; crew's own words go under "Why". */
function draftFailure(e: unknown): { headline: string; why: string } {
  const code = codeOf(e);
  const why = words(e);
  if (code === 'no_seat' || code === 'ask_unavailable' || code === 'seat_failed') {
    return { headline: 'No agent could draft a query on this crew right now. You can write the SQL yourself.', why };
  }
  if (code === 'no_draft') return { headline: 'The agent did not answer with a query. Ask again in other words, or write the SQL yourself.', why };
  if (code === 'draft_holds_secret') return { headline: 'The agent’s answer held this source’s password, so nothing of it is shown. Write the SQL yourself, and change the password.', why };
  return { headline: 'The draft failed.', why };
}

/**
 * "ASK A QUESTION OF THIS DATA" (operator 2026-11-03), for a saved SQL source. The person's question goes to
 * crew, which hands ONE seat the question and the source's structure (what agents see; never a row or the
 * login) and checks the one read query it drafts with the read policy. The SQL and the seat's one line show
 * here first; nothing has run. The person may edit it (crew checks the new text) or write their own. Run is
 * live only for the exact text crew checked and answered a token for; the rows come back to this box only,
 * and no model ever sees them.
 */
export function AskData({ source, 'data-testid': testId = 'source-ask' }: {
  source: string;
  'data-testid'?: string;
}): React.ReactElement {
  const [question, setQuestion] = useState('');
  const [sql, setSql] = useState('');
  /** The SQL editor is shown: after a draft, or when the person writes their own. */
  const [editing, setEditing] = useState(false);
  const [drafted, setDrafted] = useState<{ explanation: string; seat: string; sql: string } | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [result, setResult] = useState<(Ran & { text: string }) | null>(null);
  /** The text a run was last tried for (its check no longer says "nothing has run"). */
  const [ranText, setRanText] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'draft' | 'check' | 'run'>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ headline: string; why: string } | null>(null);
  /** One request at a time; an answer for an older text is dropped. */
  const inFlight = useRef(false);
  const gen = useRef(0);
  /** "Write the SQL yourself" moves the focus into the editor it reveals. */
  const sqlBox = useRef<HTMLTextAreaElement | null>(null);
  const focusSql = useRef(false);
  useEffect(() => {
    if (editing && focusSql.current) { focusSql.current = false; sqlBox.current?.focus(); }
  }, [editing]);

  /** Crew's token is for exactly the text it checked: shown text and checked text must be the same. */
  const current = checked !== null && checked.text === sql ? checked : null;
  const runnable = current !== null && current.check.ok && current.confirm !== null;
  const stale = checked !== null && checked.text !== sql && sql.trim() !== '';

  const draft = async (): Promise<void> => {
    const q = question.trim();
    if (q === '' || inFlight.current) return;
    inFlight.current = true;
    const mine = ++gen.current;
    setBusy('draft');
    setError(null);
    setFailure(null);
    setResult(null);
    try {
      const r = await sourcesApi.ask(source, q);
      if (mine !== gen.current) return;
      setDrafted({ explanation: r.explanation, seat: r.seat, sql: r.sql });
      setSql(r.sql);
      setEditing(r.sql !== '');
      setRanText(null);
      setChecked(r.check === null ? null : { text: r.sql, check: r.check, confirm: r.confirm });
    } catch (e) {
      if (mine === gen.current) setFailure(draftFailure(e));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const check = async (): Promise<void> => {
    const text = sql;
    if (text.trim() === '' || inFlight.current) return;
    inFlight.current = true;
    const mine = ++gen.current;
    setBusy('check');
    setError(null);
    setResult(null);
    try {
      const r = await sourcesApi.query(source, text);
      if (mine !== gen.current) return;
      // A check never runs: an answer that says it did is not one to show as a check.
      if (r.ran) setError('crew answered the check with a run, which it should never do: nothing is shown. Check it again.');
      else { setChecked({ text, check: r.check, confirm: r.confirm }); setRanText(null); }
    } catch (e) {
      if (mine === gen.current) setError(`The check failed: ${words(e)}.`);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const run = async (): Promise<void> => {
    if (!runnable || inFlight.current) return;
    inFlight.current = true;
    // Exactly the text crew checked, with its token.
    const sending = current;
    const mine = ++gen.current;
    setBusy('run');
    setError(null);
    setResult(null);
    setRanText(sending.text);
    try {
      const r = await sourcesApi.query(source, sending.text, sending.confirm ?? undefined);
      if (mine !== gen.current) return;
      if (r.ran) setResult({ ...r, text: sending.text });
      else {
        // Crew checked instead of running: show that check (and its token, if any); nothing ran.
        setChecked({ text: sending.text, check: r.check, confirm: r.confirm });
        setRanText(null);
        setError('crew checked this SQL again instead of running it. Nothing ran.');
      }
    } catch (e) {
      if (mine !== gen.current) return;
      // Whatever went wrong, this check is spent: the person checks the text again before another run.
      setChecked(null);
      if (codeOf(e) === 'query_changed') {
        setError('The check this run relied on is no longer valid (the source changed, or crew restarted). Nothing ran. Check it again, then run it.');
      } else {
        setError(`The query failed: ${words(e)}. Check it again before another run.`);
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const writeOwn = (): void => {
    gen.current++;
    focusSql.current = true;
    setEditing(true);
    setDrafted(null);
    setChecked(null);
    setResult(null);
    setRanText(null);
    setError(null);
    setFailure(null);
  };

  const shownCheck = current !== null ? checkWords(current.check, ranText === current.text) : null;
  /** The seat's line describes the SQL it drafted: shown only while that is the SQL in the box. */
  const draftShown = drafted !== null && (drafted.sql === '' || drafted.sql === sql);

  return (
    <div className="wk-src-box wk-src-ask" data-testid={testId}>
      <div className="wk-src-box-head">
        <MessageSquare size={16} aria-hidden className="wk-src-ico" />
        <span className="wk-src-strong">Ask a question of this data</span>
      </div>
      <form className="wk-src-ask-q" onSubmit={(e) => { e.preventDefault(); void draft(); }}>
        <input data-testid={`${testId}-question`} aria-label="Your question" className="wk-field wk-src-input" maxLength={1000} placeholder="How many tickets are open?"
          disabled={busy !== null} value={question} onChange={(e) => { setQuestion(e.target.value); setDrafted(null); setFailure(null); }} />
        <button type="submit" className="wk-btn wk-btn--secondary" data-testid={`${testId}-draft`} disabled={busy !== null || question.trim() === ''}>{busy === 'draft' ? 'Drafting…' : 'Draft a query'}</button>
      </form>
      <div className="wk-src-row-btns">
        <span className="wk-src-cap wk-src-grow-text">A model drafts one read query from the structure only (what agents see, never a row). Nothing runs until you click Run.</span>
        {!editing && <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid={`${testId}-write-own`} disabled={busy !== null} onClick={writeOwn}>Write the SQL yourself</button>}
      </div>
      {failure !== null && (
        <div className="wk-src-lines" role="alert" data-testid={`${testId}-error`}>
          <p className="wk-src-okline wk-src-tone-warn"><AlertTriangle size={16} aria-hidden className="wk-src-ico wk-src-tone-warn" /><span>{failure.headline}</span></p>
          <details className="wk-src-note"><summary>Why</summary>{failure.why}</details>
        </div>
      )}
      {draftShown && drafted !== null && (
        <p role="status" className={`wk-src-okline${drafted.sql === '' ? ' wk-src-tone-warn' : ''}`} data-testid={`${testId}-explanation`}>
          {drafted.sql === '' ? <AlertTriangle size={16} aria-hidden className="wk-src-ico wk-src-tone-warn" /> : <MessageSquare size={16} aria-hidden className="wk-src-ico" />}
          <span>{drafted.sql === '' ? `${drafted.seat} could not write a query: ` : `${drafted.seat}: `}{drafted.explanation || 'no explanation given'}</span>
        </p>
      )}
      {editing && (
        <>
          <label className="wk-src-field">
            <span className="wk-src-label">SQL{drafted !== null && drafted.sql !== '' ? (drafted.sql === sql ? ' (drafted; you can edit it)' : ' (drafted, then edited)') : ''}</span>
            <textarea ref={sqlBox} data-testid={`${testId}-sql`} className="wk-field wk-src-textarea" rows={4} spellCheck={false} disabled={busy === 'run'} value={sql}
              placeholder="SELECT count(*) FROM support.tickets WHERE status = 'open'"
              onChange={(e) => { gen.current++; setSql(e.target.value); setResult(null); setError(null); }} />
          </label>
          {shownCheck !== null && (
            <p role={shownCheck.tone === 'fail' ? 'alert' : 'status'} className={`wk-src-okline${shownCheck.tone === 'fail' ? ' wk-src-tone-fail' : ''}`} data-testid={`${testId}-check`} data-ok={shownCheck.tone === 'ok' ? 'yes' : 'no'}>
              {shownCheck.tone === 'ok' ? <Check size={16} aria-hidden className="wk-src-ico wk-src-tone-ok" /> : <X size={16} aria-hidden className="wk-src-ico wk-src-tone-fail" />}
              <span>{shownCheck.text}</span>
            </p>
          )}
          {stale && <p className="wk-src-note wk-src-tone-warn" data-testid={`${testId}-stale`}>Changed since crew checked it: check it again before it can run.</p>}
          <div className="wk-src-row-btns">
            {runnable ? (
              <button type="button" className="wk-btn wk-btn--primary" data-testid={`${testId}-run`} disabled={busy !== null} onClick={() => void run()}>{busy === 'run' ? 'Running…' : 'Run'}</button>
            ) : (
              <button type="button" className="wk-btn wk-btn--secondary" data-testid={`${testId}-check-run`} disabled={busy !== null || sql.trim() === ''} onClick={() => void check()}>{busy === 'check' ? 'Checking…' : 'Check'}</button>
            )}
            <span className="wk-src-cap">Read only, 10 s at most, the first 50 rows.</span>
          </div>
        </>
      )}
      {result !== null && (
        <div className="wk-src-result" data-testid={`${testId}-result`} data-truncated={result.truncated ? 'yes' : 'no'}>
          <p className="wk-src-okline" role="status" data-testid={`${testId}-summary`}>
            <Check size={16} aria-hidden className="wk-src-ico wk-src-tone-ok" />
            <span>{result.rows.length} row{result.rows.length === 1 ? '' : 's'} in {result.ms} ms{result.truncated ? `: there are more than shown (at most ${result.rowCap} rows and 1 MB come back)` : ''}. Shown to you only; no model sees them.</span>
          </p>
          <p className="wk-src-cap">A very long value shows shortened, ending in “…”.</p>
          <div className="wk-src-scroll wk-src-scroll--focus" tabIndex={0} role="region" aria-label="Query result" data-testid={`${testId}-scroll`}>
            <table className="wk-src-table wk-src-table--result" data-testid={`${testId}-rows`}>
              <thead><tr>{result.columns.map((c, i) => <th key={i} scope="col" title={c.type}>{c.name}</th>)}</tr></thead>
              <tbody>{result.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className={v === null ? 'wk-src-cap' : undefined}>{cellText(v)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
      {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail" data-testid={`${testId}-run-error`}>{error}</p>}
    </div>
  );
}
