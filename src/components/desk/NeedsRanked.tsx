import { useSeatImageRebuild } from '../../store/seatImageRebuild.js';
import { useEffect, useRef, useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { snoozeChoices, snoozeEndWords } from '../../board/deskSnooze.js';
import { useDeskSnoozes } from '../../store/deskSnoozes.js';
import { api } from '../../api/client.js';
import type { SystemAttention, SystemSnapshot, SystemSnoozed, SystemUnresolved } from '../../api/system.js';
import type { SessionView } from '../../api/types.js';
import { needSection } from '../../board/needsQueue.js';
import type { NeedRow } from '../../board/needsYou.js';
import { retryPrefillOf } from '../../board/needsYou.js';
import { toResolveWords } from '../../board/nerveCenter.js';
import { actionPath, costWords, rankedSections, rankedSentence, resolveGroups, RESOLVE_SHOWN, rowVerb, waitWords, WHY_WORD, type ResolveGroup } from '../../board/rankedNeeds.js';
import { sessionPath } from '../../board/sessionModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { setRetryPrefill } from '../../store/retryPrefill.js';
import { HEALTH_RECHECKED, useSystemStore } from '../../store/systemSnapshot.js';
import { rowHeadline, rowLead } from '../../board/rowHeadline.js';
import { useRowHeadlines } from '../../hooks/useRowHeadlines.js';
import { useSignInHere } from '../agents/useSignInHere.js';
import { needTone } from '../../board/needTone.js';
import { QE_REFUSED_DELIVER } from '../../board/gateHeadline.js';

/**
 * NEEDS YOU, RANKED (`/needs` against a crew with `capabilities.attentionRanked`; the approved mockup
 * `ui-v2-needs`). Crew's `attention[]` is the list and its order: what is blocking several jobs (or
 * the system itself) first, as cards with the one move that helps; then what waits on one decision,
 * as rows. Under them, "To resolve": the work nobody resolved, with what it cost, and its three
 * resolutions (Retry, Archive with a reason, Close as superseded). Everything worth a look but not
 * blocking (proposals to review, the fold's other rows) is folded at the end. Nothing here counts on
 * its own: the number is crew's.
 */
/** One calm "Set up" row: studio's own setup (memory, a signed-out helper), never stuck work. */
export interface SetupRow { key: string; title: string; line: string; label: string; onAct: () => void }

export function NeedsRanked({ snapshot, runs, needRows, navigate, now, setup = [] }: {
  /** Studio's own setup items, as calm rows under the stuck work. A helper a stuck item already
   *  names ("sign in pi …") is left out here: the caller filters with {@link namedInStuck}. */
  setup?: readonly SetupRow[];
  snapshot: SystemSnapshot;
  runs: readonly SessionView[];
  /** The fold's rows: only its "worth a look" ones are shown (folded); they never count. */
  needRows: readonly NeedRow[];
  navigate: Navigate;
  now: number;
}): React.ReactElement {
  const starting = useSeatImageRebuild((s) => s.phase === 'starting');
  useSpendFocus(snapshot);
  const rebuilding = snapshot.infra.find((r) => r.key === 'seat_images')?.rebuild?.running === true;
  const items = snapshot.attention;
  const { several, single } = rankedSections(items);
  const byId = new Map(runs.map((v) => [v.session.id, v]));
  // Each gate row says what the dock says (its plain cause); the job's title moves to the line.
  const causes = useRowHeadlines(items, runs);
  const worth = needRows.filter((r) => needSection(r) === 'other');
  const toReview = snapshot.toReview ?? needRows.filter((r) => needSection(r) === 'review').length;
  const worthCount = worth.length + toReview;
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  // Sign in opens that helper's own sign-in here (operator 2026-10-27: never a settings page).
  const signIn = useSignInHere();
  const act = (a: SystemAttention): void => {
    if (a.action?.kind === 'rebuild-seat-images') { void useSeatImageRebuild.getState().start(); return; }
    const path = actionPath(a.action);
    if (path !== null) { navigate(path); return; }
    if (a.action?.kind === 'sign-in') { signIn.open(a.action.target); return; }
    window.dispatchEvent(new Event(HEALTH_RECHECKED));
  };
  const unresolved = snapshot.unresolved ?? [];
  // One folded line for everything worth a look but not blocking: proposals, unresolved work (with its spend),
  // studio's own setup and the fold's other rows.
  const foldCount = worthCount + unresolved.length + setup.length;

  return (
    <div className="wk-home" data-testid="needs-ranked">
      <div className="wk-home-col wk-needs-col">
        <header className="wk-home-hello">
          <h1 className="wk-home-title" id="desk-inbox-title" tabIndex={-1}>Needs you</h1>
          <p className="wk-home-state" data-testid="needs-sentence" data-count={items.length} aria-live="polite">{rankedSentence(items)}</p>
        </header>

        {several.length > 0 && (
          <section className="wk-home-sec wk-needs-sec" aria-labelledby="needs-several" data-testid="needs-several">
            <h2 id="needs-several" className="wk-home-label">Blocking several jobs</h2>
            {several.map((a) => (
              <article key={a.id} className="wk-needs-card" data-testid="needs-item" data-id={a.id} data-kind={a.kind ?? undefined} data-blocks={a.blockedRunIds?.length ?? 0}>
                <span aria-hidden className="wk-needs-dot" data-level={a.level} data-tone={needTone(a)} />
                <span className="wk-needs-card-body">
                  <span className="wk-needs-card-title">{rowHeadline(a, causes.get(a.id) ?? null)}</span>
                  {rowLead(a, causes.get(a.id) ?? null) !== null && <span className="wk-needs-card-line">{rowLead(a, causes.get(a.id) ?? null)}</span>}
                  {a.remedy !== null && a.remedy !== 'Re-check.' && <span className="wk-needs-card-remedy">{a.remedy}</span>}
                </span>
                {a.snooze != null && <RankedSnooze key={a.snooze.key} snooze={a.snooze} now={now} />}
                {a.action !== null && <button type="button" className="wk-home-btn wk-home-btn--primary" data-testid="needs-item-act" disabled={a.action?.kind === 'rebuild-seat-images' && (starting || rebuilding)} onClick={() => act(a)}>{a.action.label ?? rowVerb(a, null)}</button>}
              </article>
            ))}
          </section>
        )}

        {single.length > 0 && (
          <section className="wk-home-sec wk-needs-sec wk-needs-sec--rows" aria-labelledby="needs-single" data-testid="needs-single">
            <h2 id="needs-single" className="wk-home-label">Waiting on your decision</h2>
            <ul className="wk-needs-rows">
              {single.map((a) => {
                const v = a.runId != null ? byId.get(a.runId) : undefined;
                const path = actionPath(a.action) ?? (a.runId != null ? sessionPath(`run:${a.runId}`) : null);
                // The muted line: why (crew's plain words), where, and how long it has waited.
                const cause = causes.get(a.id) ?? null;
                // A hand-over QE refused is not offered as "Deliver": the row says the refusal and its move is Decide.
                const gateKind = cause !== QE_REFUSED_DELIVER && a.reason !== null && /deliver/i.test(a.reason) ? 'deliver' : null;
                const meta = [rowLead(a, cause), v?.session.repo_ref ?? null, a.waitedSince != null ? `waiting ${waitWords(a.waitedSince, now)}` : null].filter((x): x is string => x !== null && x !== '').join(' · ');
                return (
                  // The whole row opens its run (the action link goes to the decision itself, `#gate`).
                  <li key={a.id} className="wk-needs-row wk-needs-row--go" data-testid="needs-item" data-id={a.id} data-kind={a.kind ?? undefined} data-blocks={a.blockedRunIds?.length ?? 0}
                    onClick={(e) => { if ((e.target as HTMLElement).closest('a, button') !== null) return; const to = a.runId != null ? sessionPath(`run:${a.runId}`) : path; if (to !== null) navigate(to); }}>
                    <span aria-hidden className="wk-needs-dot wk-needs-dot--sm" data-level={a.level} data-tone={needTone(a)} />
                    <span className="wk-needs-row-body">
                      {a.runId != null
                        ? <a href={sessionPath(`run:${a.runId}`)} onClick={go(sessionPath(`run:${a.runId}`))} data-testid="needs-item-run" className="wk-needs-row-title wk-needs-row-link">{rowHeadline(a, cause)}</a>
                        : <span className="wk-needs-row-title">{rowHeadline(a, cause)}</span>}
                      <span className="wk-needs-row-line">{meta}</span>
                    </span>
                    {a.snooze != null && <RankedSnooze key={a.snooze.key} snooze={a.snooze} now={now} />}
                    {path !== null
                      ? <a href={path} onClick={go(path)} className="wk-home-link wk-needs-row-act" data-testid="needs-item-act">{rowVerb(a, gateKind)} <span aria-hidden>→</span></a>
                      : a.action !== null && <button type="button" className="wk-home-btn wk-home-btn--secondary" data-testid="needs-item-act" disabled={a.action?.kind === 'rebuild-seat-images' && (starting || rebuilding)} onClick={() => act(a)}>{rowVerb(a, null)}</button>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {items.length === 0 && <p className="wk-home-calm" data-testid="needs-calm">Nothing is waiting on you.</p>}

        {(snapshot.snoozed ?? []).length > 0 && <SnoozedItems items={snapshot.snoozed ?? []} now={now} />}

        {foldCount > 0 && (
          <details className="wk-needs-worth wk-ue-fold" data-testid="needs-worth">
            <summary className="wk-ue-fold-sum" data-testid="needs-worth-summary">
              <span className="wk-ue-fold-words">
                <span className="wk-ue-row-title">{foldCount} {foldCount === 1 ? 'thing' : 'things'} worth a look (not blocking)</span>
                <span className="wk-ue-row-sub">{worthWords(toReview, unresolved.length, setup.length, worth.length)}</span>
              </span>
              <span aria-hidden className="wk-ue-fold-chev">›</span>
            </summary>
            <div className="wk-needs-worth-body">
              <ToResolve snapshot={snapshot} runs={runs} navigate={navigate} now={now} />
              {/* Studio's own setup (memory, a helper to sign in) — never stuck work. */}
              {setup.length > 0 && (
                <section className="wk-home-sec wk-needs-sec wk-needs-sec--rows" aria-labelledby="needs-setup" data-testid="needs-setup">
                  <h2 id="needs-setup" className="wk-home-label">Set up</h2>
                  <ul className="wk-needs-rows">
                    {setup.map((c) => (
                      <li key={c.key} className="wk-needs-row" data-testid="needs-setup-row" data-key={c.key}>
                        <span className="wk-needs-row-body">
                          <span className="wk-needs-row-title">{c.title}</span>
                          <span className="wk-needs-row-line">{c.line}</span>
                        </span>
                        <button type="button" className="wk-home-btn wk-home-btn--secondary wk-needs-row-btn" data-testid="needs-setup-act" onClick={c.onAct}>{c.label}</button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {worthCount > 0 && (
                <section className="wk-home-sec wk-needs-sec wk-needs-sec--rows" aria-labelledby="needs-look">
                  <h2 id="needs-look" className="wk-home-label">Worth a look</h2>
                  <ul className="wk-needs-worth-list">
                    {toReview > 0 && (
                      <li><a href="/steering" onClick={go('/steering')} className="wk-home-link" data-testid="needs-to-review">{toReview} to review</a><span className="wk-needs-meta"> · proposed memories and rules</span></li>
                    )}
                    {worth.map((r) => (
                      <li key={r.key}><a href={r.subjectPath} onClick={go(r.subjectPath)} className="wk-home-link">{r.question ?? r.text}</a></li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </details>
        )}
        {signIn.modal}
      </div>
    </div>
  );
}

/** The fold's one muted line: what is in it, in words ("3 proposals to review · 16 jobs to tidy up · 1 to set up"). */
export function worthWords(toReview: number, unresolved: number, setup: number, other: number): string {
  return [
    toReview > 0 ? `${toReview} ${toReview === 1 ? 'proposal' : 'proposals'} to review` : null,
    unresolved > 0 ? `${unresolved} ${unresolved === 1 ? 'job' : 'jobs'} to tidy up` : null,
    setup > 0 ? `${setup} to set up` : null,
    other > 0 ? `${other} more` : null,
  ].filter((x): x is string => x !== null).join(' · ');
}

/** "To resolve": the work nobody resolved, with what it cost (/needs and Nerve Center). Look-alike runs
 *  fold into one line with one bulk move; at most {@link RESOLVE_SHOWN} lines show before "Show N more". */
export function ToResolve({ snapshot, runs, navigate, now = Date.now() }: { snapshot: SystemSnapshot; runs: readonly SessionView[]; navigate: Navigate; now?: number }): React.ReactElement | null {
  const [all, setAll] = useState(false);
  const list = snapshot.unresolved ?? [];
  if (list.length === 0) return null;
  const byId = new Map(runs.map((v) => [v.session.id, v]));
  const groups = resolveGroups(list, now);
  const shown = all ? groups : groups.slice(0, RESOLVE_SHOWN);
  return (
    <section className="wk-home-sec wk-needs-sec wk-needs-sec--rows" aria-labelledby="needs-resolve" data-testid="needs-resolve">
      <div className="wk-home-sec-head">
        <h2 id="needs-resolve" className="wk-home-label">To tidy up</h2>
        <span className="wk-needs-meta" data-testid="needs-resolve-words">{toResolveWords(list.length, snapshot.unresolvedSpendUsd ?? null)}</span>
      </div>
      <p className="wk-needs-note">Jobs that stopped and nobody closed. Retry them, or archive them with a reason so the record stays honest.</p>
      <ul className="wk-needs-rows">
        {shown.map((g) => (g.items.length === 1
          ? <ResolveRow key={g.key} u={g.items[0]!} view={byId.get(g.items[0]!.runId) ?? null} navigate={navigate} />
          : <ResolveGroupRow key={g.key} group={g} runs={byId} navigate={navigate} />))}
      </ul>
      {groups.length > RESOLVE_SHOWN && (
        <button type="button" className="wk-home-link wk-needs-more" data-testid="needs-resolve-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show ${groups.length - RESOLVE_SHOWN} more`}
        </button>
      )}
    </section>
  );
}

/** Resolve runs one after another (the route stops and archives each); the snapshot is read again after. */
async function resolveAll(items: readonly SystemUnresolved[], body: (u: SystemUnresolved) => Parameters<typeof api.resolveRun>[1]): Promise<number> {
  let failed = 0;
  for (const u of items) {
    try { await api.resolveRun(u.runId, body(u)); } catch { failed += 1; }
  }
  void useSystemStore.getState().refresh({ force: true });
  return failed;
}

function ResolveGroupRow({ group, runs, navigate }: { group: ResolveGroup; runs: ReadonlyMap<string, SessionView>; navigate: Navigate }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const superseded = group.why === 'superseded' && group.items.every((u) => u.supersededBy !== null);
  const run = (body: (u: SystemUnresolved) => Parameters<typeof api.resolveRun>[1]): void => {
    setPhase({ kind: 'sending' });
    void resolveAll(group.items, body).then((failed) => setPhase(failed === 0 ? { kind: 'idle' } : { kind: 'failed', message: `${failed} of ${group.items.length} could not be resolved` }));
  };
  return (
    <li className="wk-needs-group" data-testid="needs-resolve-group" data-count={group.items.length} data-why={group.why}>
      <div className="wk-needs-row wk-needs-row--resolve">
        <span className="wk-needs-tag" data-why={group.why}>{WHY_WORD[group.why]}</span>
        <span className="wk-needs-row-body">
          <span className="wk-needs-row-title">{group.title}</span>
          <span className="wk-needs-row-line">{group.line}</span>
          {phase.kind === 'archive' && (
            <form className="wk-needs-reason" onSubmit={(e) => { e.preventDefault(); const r = phase.reason.trim(); if (r !== '') run(() => ({ action: 'archive', reason: r })); }}>
              <label htmlFor={`reason-${group.key}`} className="wk-visually-hidden">Why archive them</label>
              <input id={`reason-${group.key}`} autoFocus value={phase.reason} onChange={(e) => setPhase({ kind: 'archive', reason: e.target.value })}
                placeholder="Why archive them? (required)" className="wk-needs-reason-input" data-testid="needs-resolve-reason" />
              <button type="submit" className="wk-home-btn wk-home-btn--secondary" disabled={phase.reason.trim() === ''} data-testid="needs-resolve-archive-confirm">Archive all</button>
              <button type="button" className="wk-home-btn wk-home-btn--secondary" onClick={() => setPhase({ kind: 'idle' })}>Cancel</button>
            </form>
          )}
          {phase.kind === 'sending' && <span className="wk-needs-row-line">Resolving…</span>}
          {phase.kind === 'failed' && <span className="wk-needs-fail" role="alert">{phase.message}</span>}
        </span>
        {phase.kind !== 'archive' && (
          <span className="wk-needs-acts">
            {superseded && <button type="button" className="wk-home-btn wk-home-btn--secondary" disabled={phase.kind === 'sending'} data-testid="needs-resolve-group-superseded" onClick={() => run((u) => ({ action: 'superseded', by: u.supersededBy! }))}>Close all as superseded</button>}
            {!superseded && <button type="button" className="wk-home-btn wk-home-btn--secondary" disabled={phase.kind === 'sending'} data-testid="needs-resolve-group-archive" onClick={() => setPhase({ kind: 'archive', reason: '' })}>Archive all with a reason</button>}
            <button type="button" className="wk-home-link wk-needs-toggle" aria-expanded={open} data-testid="needs-resolve-group-toggle" onClick={() => setOpen((v) => !v)}>{open ? 'Fold' : 'Show each'}</button>
          </span>
        )}
      </div>
      {open && (
        <ul className="wk-needs-rows wk-needs-members">
          {group.items.map((u) => <ResolveRow key={u.runId} u={u} view={runs.get(u.runId) ?? null} navigate={navigate} />)}
        </ul>
      )}
    </li>
  );
}

type Phase = { kind: 'idle' } | { kind: 'archive'; reason: string } | { kind: 'sending' } | { kind: 'failed'; message: string };

function ResolveRow({ u, view, navigate }: { u: SystemUnresolved; view: SessionView | null; navigate: Navigate }): React.ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const send = (body: Parameters<typeof api.resolveRun>[1]): void => {
    setPhase({ kind: 'sending' });
    api.resolveRun(u.runId, body).then(
      () => { setPhase({ kind: 'idle' }); void useSystemStore.getState().refresh({ force: true }); },
      (e: unknown) => setPhase({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }),
    );
  };
  const retry = (): void => {
    if (view === null) { navigate(sessionPath(`run:${u.runId}`)); return; }
    setRetryPrefill(retryPrefillOf(view));
    navigate('/runs/new');
  };
  const path = sessionPath(`run:${u.runId}`);
  return (
    <li className="wk-needs-row wk-needs-row--resolve" data-testid="needs-resolve-row" data-run={u.runId} data-why={u.why}>
      <span className="wk-needs-tag" data-why={u.why}>{WHY_WORD[u.why]}</span>
      <span className="wk-needs-row-body">
        <a href={path} onClick={(e) => { e.preventDefault(); navigate(path); }} className="wk-needs-row-title wk-needs-row-link">{u.title}</a>
        <span className="wk-needs-row-line">{[u.reason, costWords(u)].filter((x) => x !== '').join(' · ')}</span>
        {phase.kind === 'archive' && (
          <form className="wk-needs-reason" onSubmit={(e) => { e.preventDefault(); if (phase.reason.trim() !== '') send({ action: 'archive', reason: phase.reason.trim() }); }}>
            <label htmlFor={`reason-${u.runId}`} className="wk-visually-hidden">Why archive it</label>
            <input id={`reason-${u.runId}`} autoFocus value={phase.reason} onChange={(e) => setPhase({ kind: 'archive', reason: e.target.value })}
              placeholder="Why archive it? (required)" className="wk-needs-reason-input" data-testid="needs-resolve-reason" />
            <button type="submit" className="wk-home-btn wk-home-btn--secondary" disabled={phase.reason.trim() === ''} data-testid="needs-resolve-archive-confirm">Archive</button>
            <button type="button" className="wk-home-btn wk-home-btn--secondary" onClick={() => setPhase({ kind: 'idle' })}>Cancel</button>
          </form>
        )}
        {phase.kind === 'failed' && <span className="wk-needs-fail" role="alert">Couldn’t resolve it: {phase.message}</span>}
      </span>
      {phase.kind !== 'archive' && (
        <span className="wk-needs-acts">
          {u.actions.includes('close_superseded') && u.supersededBy !== null && (
            <button type="button" className="wk-home-btn wk-home-btn--secondary" disabled={phase.kind === 'sending'} data-testid="needs-resolve-superseded"
              onClick={() => send({ action: 'superseded', by: u.supersededBy! })}>Close as superseded</button>
          )}
          {u.actions.includes('retry') && <button type="button" className="wk-home-btn wk-home-btn--secondary" disabled={phase.kind === 'sending'} data-testid="needs-resolve-retry" onClick={retry}>Retry</button>}
          {u.actions.includes('archive') && <button type="button" className="wk-home-btn wk-home-btn--secondary" disabled={phase.kind === 'sending'} data-testid="needs-resolve-archive" onClick={() => setPhase({ kind: 'archive', reason: '' })}>Archive…</button>}
        </span>
      )}
    </li>
  );
}

/** A helper a stuck item already names (its reason or remedy says "pi", "opencode"): shown there, not twice. */
export function namedInStuck(cli: string, items: readonly SystemAttention[]): boolean {
  const word = new RegExp(`\\b${cli.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return items.some((a) => word.test(`${a.reason ?? ''} ${a.remedy ?? ''}`));
}

/** After a snooze or a wake, crew's list is read again: the list, its number and every count follow crew. */
/**
 * Where a keyboard user stands once a snooze or a wake lands (studio#1416). The control they used goes with its row
 * when crew's next answer is on the page, so the page keeps one intent: taken at the press only when that control held
 * focus, dropped at any press or key elsewhere before the answer, at a refusal, or on leaving the page, and spent by
 * the first snapshot committed after the change landed ({@link useSpendFocus}), whether or not it moves focus. It moves
 * focus only while focus sits on the page body, to the first of `places` still there, else the heading.
 * Known limit: a screen reader's own focus move (no key or press on the document) that the same answer then removes
 * is not told apart from focus lost with the control.
 */
let focusIntent: { places: readonly string[]; ready: boolean; drop: () => void } | null = null;
const focusLost = (): boolean => document.activeElement === null || document.activeElement === document.body;

/** At the press: hold a place for the control's user, or nothing when the control never held focus (a pointer). */
function holdFocus(control: Element, places: readonly string[]): { landed: () => void; drop: () => void; held: () => boolean } {
  focusIntent?.drop();
  const none = { landed: (): void => undefined, drop: (): void => undefined, held: (): boolean => true };
  if (document.activeElement !== control) return none;
  const drop = (): void => {
    document.removeEventListener('pointerdown', drop, true);
    document.removeEventListener('keydown', drop, true);
    if (focusIntent?.drop === drop) focusIntent = null;
  };
  // From onClick: this press's own pointerdown and keydown have already passed, so only a later one drops it.
  document.addEventListener('pointerdown', drop, true);
  document.addEventListener('keydown', drop, true);
  const intent = { places, ready: false, drop };
  focusIntent = intent;
  // `held`: nothing the person did since the press gave the place up (a refusal hands focus back only then).
  return { landed: () => { intent.ready = true; }, drop, held: () => focusIntent === intent };
}

/** Spend the intent on the first snapshot committed after the change landed (an answer a later read superseded never
 *  commits); it moves focus only if focus went with the control. Leaving the page drops it. */
function useSpendFocus(snapshot: SystemSnapshot): void {
  useEffect(() => () => { focusIntent?.drop(); }, []);
  useEffect(() => {
    const intent = focusIntent;
    if (intent === null || !intent.ready) return;
    intent.drop();
    if (!focusLost()) return;
    for (const sel of [...intent.places, '#desk-inbox-title']) {
      const to = document.querySelector<HTMLElement>(sel);
      if (to !== null) { to.focus(); return; }
    }
  }, [snapshot]);
}

/** Re-read /system after a snooze or a wake: crew moved the item, so the list, its number and every count follow. */
const reread = (): void => { void useSystemStore.getState().refresh({ force: true }); };

/** Snooze on a ranked item (studio#1416): crew's key and rank, the inbox's ends and refusal words. Mounted per key. */
function RankedSnooze({ snooze: sn, now }: { snooze: { key: string; rank: number }; now: number }): React.ReactElement {
  const snooze = useDeskSnoozes((st) => st.snooze);
  const [state, setState] = useState<{ kind: 'idle' | 'choose' | 'sending' } | { kind: 'failed'; words: string; refocus: boolean }>({ kind: 'idle' });
  const opener = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const back = useRef(false);
  useEffect(() => {
    if (state.kind === 'choose') firstChoice.current?.focus();
    // Back to Snooze after Cancel or a refusal, only when focus went with the choices (never from where the person moved).
    else if ((state.kind === 'failed' && state.refocus) || (state.kind === 'idle' && back.current)) { back.current = false; if (focusLost()) opener.current?.focus(); }
  }, [state]);
  if (state.kind === 'idle' || state.kind === 'failed') {
    return (
      <span className="wk-needs-snooze">
        <button ref={opener} type="button" data-testid="needs-item-snooze" className="wk-home-btn wk-home-btn--secondary wk-needs-row-btn" onClick={() => setState({ kind: 'choose' })}>
          <AlarmClock size={13} aria-hidden />Snooze
        </button>
        {state.kind === 'failed' && <span role="status" className="wk-needs-snooze-failed" data-testid="needs-item-snooze-failed">{state.words}</span>}
      </span>
    );
  }
  return (
    <span className="wk-needs-snooze" role="group" aria-label="Snooze until">
      {snoozeChoices(now).map((c, i) => (
        <button key={c.id} ref={i === 0 ? firstChoice : undefined} type="button" data-testid={`needs-item-snooze-${c.id}`} className="wk-home-btn wk-home-btn--secondary wk-needs-row-btn" disabled={state.kind === 'sending'}
          onClick={(e) => {
            const place = holdFocus(e.currentTarget, ['[data-testid="needs-snoozed-summary"]']);
            setState({ kind: 'sending' });
            void snooze(sn.key, c.until, sn.rank).then((why) => {
              if (why === null) { place.landed(); setState({ kind: 'idle' }); reread(); } else { const refocus = place.held(); place.drop(); setState({ kind: 'failed', words: why, refocus }); }
            });
          }}>
          {c.label}
        </button>
      ))}
      <button type="button" data-testid="needs-item-snooze-cancel" className="wk-home-link wk-needs-snooze-cancel" disabled={state.kind === 'sending'} onClick={() => { back.current = true; setState({ kind: 'idle' }); }}>Cancel</button>
    </span>
  );
}

/** "N snoozed": what crew holds back for a person's snooze, each with when it comes back and Wake now. */
function SnoozedItems({ items, now }: { items: readonly SystemSnoozed[]; now: number }): React.ReactElement {
  return (
    <details className="wk-needs-worth wk-ue-fold" data-testid="needs-snoozed">
      <summary className="wk-ue-fold-sum" data-testid="needs-snoozed-summary">
        <span className="wk-ue-fold-words">
          <span className="wk-ue-row-title">{items.length} snoozed</span>
          <span className="wk-ue-row-sub">Not counted until they come back, or sooner if they get worse.</span>
        </span>
        <span aria-hidden className="wk-ue-fold-chev">›</span>
      </summary>
      <ul className="wk-needs-snoozed-list">
        {/* Keyed by the occurrence: a new snooze of the same run starts with its own Wake. */}
        {items.map((a) => <SnoozedItem key={a.wakeKey ?? a.id} item={a} now={now} />)}
      </ul>
    </details>
  );
}

function SnoozedItem({ item, now }: { item: SystemSnoozed; now: number }): React.ReactElement {
  const wake = useDeskSnoozes((st) => st.wake);
  const [state, setState] = useState<{ kind: 'idle' | 'sending' } | { kind: 'failed'; words: string }>({ kind: 'idle' });
  const key = item.wakeKey;
  const row = `[data-testid="needs-item"][data-id="${CSS.escape(item.id)}"]`;
  return (
    <li className="wk-needs-snoozed-item" data-testid="needs-snoozed-item" data-id={item.id}>
      <span className="wk-needs-snoozed-what">{item.text}</span>
      {item.until !== null && <span className="wk-needs-snoozed-until" data-testid="needs-snoozed-until">Back {snoozeEndWords(new Date(item.until).toISOString(), now)}</span>}
      {key !== null && (
        <button type="button" data-testid="needs-snoozed-wake" className="wk-home-btn wk-home-btn--secondary wk-needs-row-btn" disabled={state.kind === 'sending'}
          onClick={(e) => {
            const place = holdFocus(e.currentTarget, [`${row} :is(a, button)`, '[data-testid="needs-snoozed-summary"]']);
            setState({ kind: 'sending' });
            void wake(key).then((why) => {
              if (why === null) { place.landed(); setState({ kind: 'idle' }); reread(); } else { place.drop(); setState({ kind: 'failed', words: why }); }
            });
          }}>
          Wake now
        </button>
      )}
      {state.kind === 'failed' && <span role="status" className="wk-needs-snooze-failed">{state.words}</span>}
    </li>
  );
}
