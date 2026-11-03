import { useRef, useState } from 'react';
import { ApiError } from '../../api/errors.js';
import { sourcesApi, type SourceTestCallRequest, type SourceTestCallResponse } from '../../api/sources.js';

/** The request as the sheet names it before anything is sent. */
export function RequestView({ request, testId }: { request: SourceTestCallRequest; testId: string }): React.ReactElement {
  const body = request.kind === 'mcp' ? request.args : request.body;
  return (
    <div className="wk-src-request" data-testid={testId}>
      <code className="wk-src-code" data-testid={`${testId}-summary`}>{request.summary}</code>
      {request.headers !== undefined && request.headers.length > 0 && (
        <p className="wk-src-note">Headers: {request.headers.join(', ')} (names only; the secret’s value is never shown)</p>
      )}
      {body !== undefined && body !== null && (typeof body !== 'object' || Object.keys(body as object).length > 0) && (
        <pre className="wk-src-pre" data-testid={`${testId}-body`}>{typeof body === 'string' ? body : JSON.stringify(body, null, 2)}</pre>
      )}
    </div>
  );
}

/**
 * THE TEST CALL (G6, DES-APPS-001 §5.1): one live READ the sheet names before sending. "Name the request"
 * asks crew for the exact request (method, URL, header names, body) and sends nothing; "Send this
 * request" sends exactly that one, bound by its hash. Editing anything drops the named request, and a
 * request that changed at crew since it was named (409 `request_changed`) is named again, never sent.
 */
export function TestCall({ source, kind, reads, 'data-testid': testId = 'source-test-call' }: {
  source: string;
  kind: 'rest' | 'graphql' | 'mcp';
  /** REST and MCP: the operations crew classes as reads (a test call sends only a read). */
  reads: readonly string[];
  'data-testid'?: string;
}): React.ReactElement {
  const [target, setTarget] = useState(kind === 'graphql' ? '' : (reads[0] ?? ''));
  const [argsText, setArgsText] = useState('{}');
  const [named, setNamed] = useState<{ request: SourceTestCallRequest; hash: string; target: string; args: string } | null>(null);
  const [result, setResult] = useState<Extract<SourceTestCallResponse, { sent: true }> | null>(null);
  const [busy, setBusy] = useState<null | 'name' | 'send'>(null);
  const [error, setError] = useState<string | null>(null);
  /** Every edit is a new generation: an answer for an older one is dropped. */
  const gen = useRef(0);
  /** A name or send in flight (a second click in the same tick sends nothing). */
  const inFlight = useRef(false);

  const parsedArgs = ((): Record<string, unknown> | string => {
    try {
      const v = JSON.parse(argsText.trim() === '' ? '{}' : argsText) as unknown;
      return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : 'Arguments are a JSON object';
    } catch {
      return 'Arguments are a JSON object';
    }
  })();
  const blocker = target.trim() === '' ? (kind === 'graphql' ? 'Type one query' : 'Pick a read') : typeof parsedArgs === 'string' ? parsedArgs : null;
  const edited = (): void => { gen.current++; setNamed(null); setResult(null); setError(null); };

  const name = async (): Promise<void> => {
    if (typeof parsedArgs === 'string' || inFlight.current) return;
    inFlight.current = true;
    const mine = gen.current;
    setBusy('name');
    setError(null);
    setResult(null);
    try {
      const r = await sourcesApi.testCall(source, target, parsedArgs);
      // An edit since the ask: this request is not what the fields say now.
      if (mine === gen.current && !r.sent) setNamed({ request: r.request, hash: r.requestHash, target, args: argsText });
    } catch (e) {
      if (mine === gen.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const send = async (): Promise<void> => {
    if (named === null || typeof parsedArgs === 'string' || inFlight.current) return;
    inFlight.current = true;
    // Exactly what was named: the target and arguments it was named with, and its hash. The named
    // request is spent as the send starts, whatever comes back: another send is named again first.
    const sending = named;
    const mine = gen.current;
    const args = JSON.parse(sending.args.trim() === '' ? '{}' : sending.args) as Record<string, unknown>;
    setNamed(null);
    setBusy('send');
    setError(null);
    try {
      const r = await sourcesApi.testCall(source, sending.target, args, sending.hash);
      // What was sent is shown even if the fields changed meanwhile: it names its own request.
      if (r.sent && mine === gen.current) setResult(r);
    } catch (e) {
      if (mine !== gen.current) return;
      if (e instanceof ApiError && (e.body as { code?: unknown } | undefined)?.code === 'request_changed') {
        setError('The request changed since it was named (the source was saved again). Nothing was sent. Name it again to see what would be sent.');
      } else {
        setError(`${e instanceof Error ? e.message : String(e)}. crew may or may not have sent it; name the request again before sending another.`);
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  return (
    <div className="wk-src-box wk-src-test" data-testid={testId}>
      <div className="wk-src-box-head"><span className="wk-src-strong">Test call</span><span className="wk-src-cap">one live read, named before it is sent</span></div>
      {kind === 'graphql' ? (
        <label className="wk-src-field">
          <span className="wk-src-label">Query</span>
          <textarea data-testid={`${testId}-query`} className="wk-field wk-src-textarea" rows={3} spellCheck={false} disabled={busy === 'send'} value={target} placeholder="query { tickets { id status } }" onChange={(e) => { setTarget(e.target.value); edited(); }} />
        </label>
      ) : reads.length === 0 ? (
        <p className="wk-src-note" data-testid={`${testId}-no-reads`}>This source has no read operation, so there is nothing a test call may send.</p>
      ) : (
        <label className="wk-src-field">
          <span className="wk-src-label">{kind === 'rest' ? 'Operation (a read)' : 'Tool (a read)'}</span>
          <select data-testid={`${testId}-target`} className="wk-field wk-src-input" disabled={busy === 'send'} value={target} onChange={(e) => { setTarget(e.target.value); edited(); }}>
            {reads.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      )}
      <label className="wk-src-field">
        <span className="wk-src-label">{kind === 'graphql' ? 'Variables (JSON)' : 'Arguments (JSON)'}</span>
        <input data-testid={`${testId}-args`} className="wk-field wk-src-input wk-src-mono" spellCheck={false} disabled={busy === 'send'} value={argsText} onChange={(e) => { setArgsText(e.target.value); edited(); }} />
      </label>
      {named === null ? (
        <div className="wk-src-row-btns">
          <button type="button" className="wk-btn wk-btn--secondary" data-testid={`${testId}-name`} disabled={blocker !== null || busy !== null} title={blocker ?? undefined} onClick={() => void name()}>
            {busy === 'name' ? 'Naming…' : 'Name the request'}
          </button>
          <span className="wk-src-cap">Nothing is sent until you have seen the request.</span>
        </div>
      ) : (
        <div className="wk-src-named" data-testid={`${testId}-named`}>
          <p className="wk-src-note">crew will send exactly this request, once:</p>
          <RequestView request={named.request} testId={`${testId}-request`} />
          <div className="wk-src-row-btns">
            <button type="button" className="wk-btn wk-btn--primary" data-testid={`${testId}-send`} disabled={busy !== null} onClick={() => void send()}>
              {busy === 'send' ? 'Sending…' : 'Send this request'}
            </button>
            <button type="button" className="wk-btn wk-btn--quiet" disabled={busy !== null} onClick={edited}>Cancel</button>
            <code className="wk-src-cap wk-src-mono" title={named.hash}>{named.hash.slice(0, 12)}</code>
          </div>
        </div>
      )}
      {result !== null && (
        <div className="wk-src-result" data-testid={`${testId}-result`} data-ok={result.ok ? 'yes' : 'no'}>
          <p className="wk-src-note">Sent:</p>
          <RequestView request={result.request} testId={`${testId}-sent`} />
          <p className={`wk-src-okline${result.ok ? '' : ' wk-src-tone-fail'}`}>
            {result.ok ? 'Answered' : 'Failed'}{result.status !== null ? ` · HTTP ${result.status}` : ''}{result.truncated ? ' · cut at 64 KB' : ''}
          </p>
          <pre className="wk-src-pre">{typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}</pre>
        </div>
      )}
      {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail" data-testid={`${testId}-error`}>{error}</p>}
    </div>
  );
}
