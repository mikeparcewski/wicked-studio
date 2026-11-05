import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppDetail, SessionView } from '../../api/types.js';
import { sessionPath } from '../../board/sessionModel.js';
import { busyText, changeLine, componentWords, endedLine, hasTurnLog, seatWord, sendTurn, suggestionsFor, turnsOf, type AppTurnRecord } from '../../editors/apps/appTurns.js';
import { addAboutChip, chipsOf, removeAboutChip, useComposerChips } from '../../store/composerChips.js';
import type { ComposerSuggestion } from '../session/Composer.js';
import { knowledgeAddition } from '../../editors/apps/knowledgeSeeds.js';
import { readSuggestionGrounds, type SuggestionGrounds } from '../../editors/apps/suggestionGrounds.js';
import { AppComposer } from './AppComposer.js';
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

/** A message that could not be sent from a new app's first turn waits here for that app's chat (one tab). */
const DRAFT_KEY = (slug: string): string => `wicked.apps.draft.${slug}`;
export function stashDraft(slug: string, text: string): void {
  try { sessionStorage.setItem(DRAFT_KEY(slug), text.slice(0, 8000)); } catch { /* no storage: the note says what was not sent */ }
}
/** Read (never consume: StrictMode runs an initializer twice) the stashed draft; it is dropped once mounted. */
function peekDraft(slug: string): string {
  try { return sessionStorage.getItem(DRAFT_KEY(slug)) ?? ''; } catch { return ''; }
}
function dropDraft(slug: string): void {
  try { sessionStorage.removeItem(DRAFT_KEY(slug)); } catch { /* nothing kept */ }
}

function TurnReply({ t, view, detail, onUndo, navigate, now, latestLanded, framed, pending }: {
  t: AppTurnRecord; view: SessionView | null; detail: AppDetail; onUndo: () => void; navigate: (p: string) => void; now: number; latestLanded: boolean;
  /** The person's own edits still saving: a turn's Undo waits (it would undo those instead). */
  pending: number;
  /** A framed studio changes nothing: no Undo, and the run's questions are not answered here (xreview r1 on K5). */
  framed: boolean;
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
        {/* The live activity offers Steer and Stop: never inside another page (xreview r2 on K5). */}
        {view !== null && busy.ord !== null && !framed && <LiveActivity runId={t.runId} ord={busy.ord} seat={busy.seat} />}
        {view !== null && !framed && <RunQuestions view={view} />}
        <p className="wk-appchat-meta">The app is read-only until this lands. Preview still works. · {job}</p>
      </div>
    );
  }
  if (t.state === 'landed') {
    const undoable = !framed && pending === 0 && latestLanded && detail.head.version === t.version && detail.history.canUndo && detail.turn == null;
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

export function AppChat({ slug, detail, runs, framed, navigate, onSent, onUndo, prepareSend, pending = 0 }: {
  slug: string;
  detail: AppDetail | null;
  runs: readonly SessionView[];
  framed: boolean;
  navigate: (p: string) => void;
  /** A turn was launched (the host re-reads the app so the busy state shows at once). */
  onSent: () => void;
  onUndo: () => void;
  /** Settle the host's pending edit burst first and answer the head to send on (null: it could not be saved). */
  prepareSend?: () => Promise<number | null>;
  /** The host's edits still saving. */
  pending?: number;
}): React.ReactElement {
  const key = appComposerKey(slug);
  const [text, setTextState] = useState(() => peekDraft(slug));
  useEffect(() => { dropDraft(slug); }, [slug]);
  /** Messages crew did not take while a newer one was typed: each kept whole, to put back (xreview r4: a list). */
  const [kept, setKept] = useState<Array<{ id: number; words: string; about: string[] }>>([]);
  const keptId = useRef(0);
  const textRef = useRef(text);
  textRef.current = text;
  const setText = (t: string): void => setTextState(t);
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const thread = useRef<HTMLDivElement | null>(null);
  const turns = useMemo(() => turnsOf(detail), [detail]);
  const busy = detail?.turn != null;
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  // The newest message in view as the thread grows.
  const last = turns[turns.length - 1];
  useEffect(() => {
    const el = thread.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [turns.length, last?.state]);
  const latestLandedRun = [...turns].reverse().find((t) => t.state === 'landed')?.runId ?? null;
  const supported = detail === null || hasTurnLog(detail);
  // (DES-KNOWLEDGE-DATA-001 §9.1) What the app's project knows: one chip offers to add it when the app reads none yet.
  const projectId = detail?.projectId ?? null;
  const [grounds, setGrounds] = useState<SuggestionGrounds | null>(null);
  useEffect(() => {
    setGrounds(null);
    if (projectId === null || framed) return;
    let live = true;
    void readSuggestionGrounds(projectId).then((g) => { if (live) setGrounds(g); });
    return () => { live = false; };
  }, [projectId, framed]);
  const current = grounds !== null && grounds.projectId === projectId ? grounds : null;
  const addKnowledge = useMemo(() => knowledgeAddition(current?.summary ?? null), [current]);
  // A suggestion names only a source the current project's summary lists as built on AND an app query can read
  // (`dataSourcesFor`: a Toolbox-runtime source is not one); none without a summary.
  const buildable = useMemo(() => current?.data ?? [], [current]);
  const suggestions: ComposerSuggestion[] = useMemo(() => (busy || framed ? [] : suggestionsFor(detail?.spec ?? null, buildable, addKnowledge, current?.readable ?? null).map((s, i) => ({
    id: `app-suggest-${i}`, label: s, title: 'Put this in the box', onPick: () => setTextState(s),
  }))), [busy, framed, detail, buildable, addKnowledge, current]);

  /** The composer's submit: true when the message was taken (the box and the chips then clear). */
  const send = async (words: string, about: string[]): Promise<boolean> => {
    if (words === '' || detail === null || framed || sending) return false;
    if (busy) { setNote('A turn is still running: your message waits in the box until it lands.'); return false; }
    setSending(true);
    setNote(null);
    // An edit burst the person just made lands first, and the turn is sent on the head it made (xreview r1 on K5).
    const base = prepareSend !== undefined ? await prepareSend() : detail.head.version;
    if (base === null) {
      setSending(false);
      setNote('Your last edit is still saving or was not saved: send this again in a moment.');
      return false;
    }
    const r = await sendTurn(slug, base, words, about);
    setSending(false);
    if (r.ok) { onSent(); return true; }
    const why = r.code === 'stale_base' ? 'the app changed meanwhile and was read again: send it once more'
      : r.code === 'turn_in_flight' ? 'a turn is already running on this app: send it when that lands'
        : `${r.code}: ${r.message}`;
    if (r.code === 'stale_base') onSent();
    // The box still holds this message (it was not taken), unless the person has typed another meanwhile: then the
    // refused one is named in the note and the newer draft is left alone.
    if (textRef.current.trim() !== words) {
      keptId.current += 1;
      const id = keptId.current;
      setKept((k) => [...k, { id, words, about }].slice(-10));
      setNote(`Not sent (${why}). It is kept below: put it back when you are ready.`);
    } else {
      setNote(`Not sent: ${why}.`);
    }
    return false;
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
            <TurnReply t={t} view={runs.find((v) => v.session.id === t.runId) ?? null} detail={detail} onUndo={onUndo} navigate={navigate} now={now} latestLanded={t.runId === latestLandedRun} framed={framed} pending={pending} />
          </article>
        ))}
      </div>
      {note !== null && <p className="wk-appchat-note" data-testid="app-chat-note" role="status">{note}</p>}
      {kept.map((k) => (
        // Kept until it is put back, whatever is sent meanwhile (xreview r3, r4).
        <p key={k.id} className="wk-appchat-note wk-appchat-kept" data-testid="app-chat-kept">
          Kept, not sent: “{k.words.length > 80 ? `${k.words.slice(0, 79)}…` : k.words}”{' '}
          <button type="button" className="wk-btn wk-btn--link" data-testid="app-chat-putback" disabled={sending}
            title={sending ? 'Wait for the message being sent' : undefined} onClick={() => {
            // Swap, with each message's own components: the kept one goes in the box with ITS chips; the draft there
            // (with its chips) is kept in its place. Not while a send is in flight (it owns the box and its chips).
            if (sending) return;
            const nowWords = textRef.current;
            const nowChips = chipsOf(useComposerChips.getState(), key).filter((c) => c.kind === 'about' && c.key.startsWith('cmp:'));
            for (const c of nowChips) removeAboutChip(key, c.key);
            setTextState(k.words);
            for (const id of k.about) addAboutChip(key, { kind: 'about', key: `cmp:${id}`, label: componentWords(detail?.spec ?? null, id) ?? id });
            keptId.current += 1;
            const swapped = nowWords.trim() !== '' || nowChips.length > 0 ? [{ id: keptId.current, words: nowWords, about: nowChips.map((c) => c.key.slice(4)) }] : [];
            setKept((all) => [...all.filter((x) => x.id !== k.id), ...swapped]);
            setNote(null);
          }}>Put it back in the box</button>
        </p>
      ))}
      <div className="wk-appchat-composer">
        <AppComposer composerKey={key} text={text} setText={setText} onSubmit={send} busy={sending}
          placeholder={busy ? 'A change is being made… type the next one' : 'Ask for a change…'} ariaLabel="Ask for a change to this app"
          suggestions={suggestions} readOnly={framed ? 'This page is inside another page, so the app cannot be changed here: open studio on its own.' : null} />
      </div>
    </section>
  );
}
