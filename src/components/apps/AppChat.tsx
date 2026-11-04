import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppDetail, SessionView } from '../../api/types.js';
import { sourcesApi } from '../../api/sources.js';
import { sessionPath } from '../../board/sessionModel.js';
import { busyText, changeLine, componentWords, endedLine, hasTurnLog, seatWord, sendTurn, suggestionsFor, turnsOf, type AppTurnRecord } from '../../editors/apps/appTurns.js';
import { addAboutChip, chipsOf, useComposerChips } from '../../store/composerChips.js';
import { Composer, type ComposerSuggestion } from '../session/Composer.js';
import { LiveActivity } from '../session/LiveActivity.js';
import { RunQuestions } from '../session/ThreadQuestions.js';

/**
 * THE APP'S CHAT (DES-APPS-001 §6.1-§6.2, §9.2; operator 2026-11-04: "I should be driving the changes mostly via chat"):
 * the column beside the app, open on every app page. Each message is one `apps-turn` run on crew — a seat builds the
 * change, crew checks it against the app's data sources, a different seat reviews it — and it lands as a new version
 * or says why it did not. The thread IS crew's record of the app's turns (`AppDetail.turns`), so a reload and a second
 * tab read the same thing; while a turn runs the reply shows which step it is on, the run's live activity and any
 * question it asks (studio's own run machinery: {@link LiveActivity}, {@link RunQuestions}).
 *
 * Selecting a component in Edit puts an "about:" chip on this composer (its words from the spec); the message names
 * the component by id and crew describes it to the builder from the spec, never from these words.
 */

/** The composer key of an app's chat (its about-chips live under it). */
export function appComposerKey(slug: string): string {
  return `app:${slug}`;
}

/** Put a component on the app's composer as an about-chip (the key carries its id). */
export function aboutComponent(slug: string, id: string, label: string): void {
  addAboutChip(appComposerKey(slug), { kind: 'about', key: `cmp:${id}`, label });
}

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : new Date(at).toLocaleDateString();
}

function TurnReply({ t, view, detail, onUndo, navigate, now, latestLanded }: {
  t: AppTurnRecord; view: SessionView | null; detail: AppDetail; onUndo: () => void; navigate: (p: string) => void; now: number; latestLanded: boolean;
}): React.ReactElement {
  const job = (
    <a href={sessionPath(`run:${t.runId}`)} className="wk-link wk-appchat-job" data-testid="app-chat-job"
      onClick={(e) => { e.preventDefault(); navigate(sessionPath(`run:${t.runId}`)); }}>See the job</a>
  );
  if (t.state === 'running') {
    const busy = busyText(view);
    return (
      <div className="wk-appchat-reply wk-appchat-reply--busy" data-testid="app-chat-busy" data-step={busy.step ?? ''} aria-live="polite">
        <p className="wk-appchat-busyline"><span className="wk-appchat-pulse" aria-hidden="true" />{busy.line}</p>
        <ol className="wk-appchat-steps" aria-label="Steps">
          {(['build', 'check', 'review'] as const).map((s) => {
            const u = view?.units.find((x) => x.id === `${t.runId}:${s}`) ?? null;
            const state = u === null ? 'pending' : u.status === 'done' ? 'done' : u.status === 'rejected' ? 'failed' : u.status === 'distributed' ? 'now' : 'pending';
            const label = s === 'build' ? 'Build' : s === 'check' ? 'Check' : 'Review';
            const who = u?.assigned_cli != null && u.assigned_cli !== '' && s !== 'check' ? ` · ${seatWord(u.assigned_cli)}` : '';
            return <li key={s} data-testid="app-chat-step" data-state={state}>{label}{who}</li>;
          })}
        </ol>
        {view !== null && busy.ord !== null && <LiveActivity runId={t.runId} ord={busy.ord} seat={busy.seat} />}
        {view !== null && <RunQuestions view={view} />}
        <p className="wk-appchat-meta">The app is read-only until this lands. Preview still works. · {job}</p>
      </div>
    );
  }
  if (t.state === 'landed') {
    const undoable = latestLanded && detail.head.version === t.version && detail.history.canUndo && detail.turn == null;
    return (
      <div className="wk-appchat-reply wk-appchat-reply--landed" data-testid="app-chat-landed">
        <p className="wk-appchat-change" data-testid="app-chat-change">{changeLine(t)}</p>
        {t.summary !== null && t.summary !== '' && t.summary !== t.change && (
          <ul className="wk-appchat-lines" data-testid="app-chat-lines">
            {t.summary.split('\n').slice(0, 6).map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        )}
        <p className="wk-appchat-meta">
          {t.builder !== null && <>Built by {seatWord(t.builder)} · </>}{t.endedAt !== null && <>{ago(t.endedAt, now)} · </>}{job}
          {undoable && <> · <button type="button" className="wk-btn wk-btn--link" data-testid="app-chat-undo" onClick={onUndo}>Undo</button></>}
        </p>
      </div>
    );
  }
  return (
    <div className="wk-appchat-reply wk-appchat-reply--ended" data-testid="app-chat-refused" data-code={t.code ?? ''}>
      <p className="wk-appchat-why" data-testid="app-chat-reason">{endedLine(t)}</p>
      <p className="wk-appchat-meta">{t.code !== null && <span className="wk-appchat-code" data-testid="app-chat-code">{t.code}</span>} {t.endedAt !== null && <>{ago(t.endedAt, now)} · </>}{job}</p>
    </div>
  );
}

export function AppChat({ slug, detail, runs, framed, navigate, onSent, onUndo }: {
  slug: string;
  detail: AppDetail | null;
  runs: readonly SessionView[];
  framed: boolean;
  navigate: (p: string) => void;
  /** A turn was launched (the host re-reads the app so the busy state shows at once). */
  onSent: () => void;
  onUndo: () => void;
}): React.ReactElement {
  const key = appComposerKey(slug);
  const [text, setTextState] = useState('');
  const keep = useRef(false);
  // The composer empties its box after a send; a message crew refused stays in it.
  const setText = (t: string): void => { if (t === '' && keep.current) { keep.current = false; return; } setTextState(t); };
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const thread = useRef<HTMLDivElement | null>(null);
  const turns = useMemo(() => turnsOf(detail), [detail]);
  const busy = detail?.turn != null;
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let live = true;
    sourcesApi.list().then((r) => {
      if (!live) return;
      setSources((r.servers ?? []).filter((s) => s.kind === 'sql' || s.kind === 'graphql').map((s) => s.name).slice(0, 20));
    }, () => undefined);
    return () => { live = false; };
  }, []);
  // The newest message in view as the thread grows.
  const last = turns[turns.length - 1];
  useEffect(() => {
    const el = thread.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [turns.length, last?.state]);
  const latestLandedRun = [...turns].reverse().find((t) => t.state === 'landed')?.runId ?? null;
  const supported = detail === null || hasTurnLog(detail);
  const suggestions: ComposerSuggestion[] = useMemo(() => (busy || framed ? [] : suggestionsFor(detail?.spec ?? null, sources).map((s, i) => ({
    id: `app-suggest-${i}`, label: s, title: 'Put this in the box', onPick: () => setTextState(s),
  }))), [busy, framed, detail, sources]);

  const send = (message: string): void => {
    const words = text.trim() !== '' ? text.trim() : message.trim();
    if (words === '' || detail === null) return;
    const chips = chipsOf(useComposerChips.getState(), key);
    const about = chips.filter((c) => c.kind === 'about' && c.key.startsWith('cmp:')).map((c) => c.key.slice(4));
    if (framed) { keep.current = true; setNote('Open studio on its own to change the app.'); return; }
    if (busy) { keep.current = true; setNote('A turn is still running: your message waits in the box until it lands.'); return; }
    if (sending) { keep.current = true; return; }
    setSending(true);
    setNote(null);
    void sendTurn(slug, detail.head.version, words, about).then((r) => {
      setSending(false);
      if (r.ok) { onSent(); return; }
      // Nothing was sent: the words and the chips go back in the box.
      setTextState(words);
      for (const c of chips) addAboutChip(key, c);
      setNote(r.code === 'stale_base' ? 'The app changed meanwhile: it was read again, so send it once more.'
        : r.code === 'turn_in_flight' ? 'A turn is already running on this app: send this when it lands.'
          : `Not sent (${r.code}): ${r.message}`);
      if (r.code === 'stale_base') onSent();
    });
  };

  return (
    <section className="wk-appchat" data-testid="app-chat" aria-label={`Chat about ${detail?.name ?? 'this app'}`}>
      <header className="wk-appchat-head">
        <h2 className="wk-appchat-title">Chat</h2>
        <span className="wk-appchat-sub">{busy ? 'A change is being made' : 'Ask for a change'}</span>
      </header>
      <div className="wk-appchat-thread" ref={thread} data-testid="app-chat-thread">
        {!supported && <p className="wk-appchat-empty" data-testid="app-chat-unsupported">This daemon does not run chat turns yet: change the app in Edit.</p>}
        {supported && turns.length === 0 && (
          <div className="wk-appchat-empty" data-testid="app-chat-empty">
            <p>Say what you want in your own words. Each message is built by one agent, checked against your data sources (it never sees a row), and reviewed by another before it lands as a new version.</p>
            <p>An app can read several sources: say which. Select a component in Edit to ask about just that one.</p>
          </div>
        )}
        {detail !== null && turns.map((t) => (
          <article key={t.runId} className="wk-appchat-turn" data-testid="app-chat-turn" data-state={t.state} data-run={t.runId}>
            <div className="wk-appchat-you" data-testid="app-chat-you">
              <p className="wk-appchat-msg">{t.message}</p>
              {t.about.length > 0 && (
                <p className="wk-appchat-about">{t.about.map((id) => <span key={id} className="wk-source-chip">about: {componentWords(detail.spec, id) ?? id}</span>)}</p>
              )}
            </div>
            <TurnReply t={t} view={runs.find((v) => v.session.id === t.runId) ?? null} detail={detail} onUndo={onUndo} navigate={navigate} now={now} latestLanded={t.runId === latestLandedRun} />
          </article>
        ))}
      </div>
      {note !== null && <p className="wk-appchat-note" data-testid="app-chat-note" role="status">{note}</p>}
      <Composer composerKey={key} text={text} setText={setText} onSend={(m) => send(m)} placeholder={busy ? 'A change is being made… type the next one' : 'Ask for a change…'}
        ariaLabel="Ask for a change to this app" variant="session" className="wk-appchat-composer" suggestions={suggestions} started={turns.length > 0} />
    </section>
  );
}
