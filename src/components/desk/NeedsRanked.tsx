import { useState } from 'react';
import { api } from '../../api/client.js';
import type { SystemAttention, SystemSnapshot, SystemUnresolved } from '../../api/system.js';
import type { SessionView } from '../../api/types.js';
import { needSection } from '../../board/needsQueue.js';
import type { NeedRow } from '../../board/needsYou.js';
import { retryPrefillOf } from '../../board/needsYou.js';
import { toResolveWords } from '../../board/nerveCenter.js';
import { actionPath, costWords, rankedSections, rankedSentence, rowVerb, waitWords, WHY_WORD } from '../../board/rankedNeeds.js';
import { sessionPath } from '../../board/sessionModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { setRetryPrefill } from '../../store/retryPrefill.js';
import { HEALTH_RECHECKED, useSystemStore } from '../../store/systemSnapshot.js';

/**
 * NEEDS YOU, RANKED (`/needs` against a crew with `capabilities.attentionRanked`; the approved mockup
 * `ui-v2-needs`). Crew's `attention[]` is the list and its order: what is blocking several jobs (or
 * the system itself) first, as cards with the one move that helps; then what waits on one decision,
 * as rows. Under them, "To resolve": the work nobody resolved, with what it cost, and its three
 * resolutions (Retry, Archive with a reason, Close as superseded). Everything worth a look but not
 * blocking (proposals to review, the fold's other rows) is folded at the end. Nothing here counts on
 * its own: the number is crew's.
 */
export function NeedsRanked({ snapshot, runs, needRows, navigate, now, extra = null }: {
  /** Studio's own chores for whoever runs it (setup, standing states), above the list. */
  extra?: React.ReactNode;
  snapshot: SystemSnapshot;
  runs: readonly SessionView[];
  /** The fold's rows: only its "worth a look" ones are shown (folded); they never count. */
  needRows: readonly NeedRow[];
  navigate: Navigate;
  now: number;
}): React.ReactElement {
  const items = snapshot.attention;
  const { several, single } = rankedSections(items);
  const byId = new Map(runs.map((v) => [v.session.id, v]));
  const worth = needRows.filter((r) => needSection(r) === 'other');
  const toReview = snapshot.toReview ?? needRows.filter((r) => needSection(r) === 'review').length;
  const worthCount = worth.length + toReview;
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const act = (a: SystemAttention): void => {
    const path = actionPath(a.action);
    if (path !== null) { navigate(path); return; }
    if (a.action?.kind === 'sign-in') { navigate(`/agents?fix=${encodeURIComponent(a.action.target)}`); return; }
    window.dispatchEvent(new Event(HEALTH_RECHECKED));
  };

  return (
    <div className="wk-home" data-testid="needs-ranked">
      <div className="wk-home-col wk-needs-col">
        <header className="wk-home-hello">
          <h1 className="wk-home-title" id="desk-inbox-title">Needs you</h1>
          <p className="wk-home-state" data-testid="needs-sentence" data-count={items.length} aria-live="polite">{rankedSentence(items)}</p>
        </header>

        {several.length > 0 && (
          <section className="wk-home-sec wk-needs-sec" aria-labelledby="needs-several" data-testid="needs-several">
            <h2 id="needs-several" className="wk-home-label">Blocking several jobs</h2>
            {several.map((a) => (
              <article key={a.id} className="wk-needs-card" data-testid="needs-item" data-id={a.id} data-kind={a.kind ?? undefined} data-blocks={a.blockedRunIds?.length ?? 0}>
                <span aria-hidden className="wk-needs-dot" data-level={a.level} />
                <span className="wk-needs-card-body">
                  <span className="wk-needs-card-title">{a.text}</span>
                  {a.reason !== null && <span className="wk-needs-card-line">{a.reason}</span>}
                  {a.remedy !== null && a.remedy !== 'Re-check.' && <span className="wk-needs-card-remedy">{a.remedy}</span>}
                </span>
                {a.action !== null && <button type="button" className="wk-home-btn wk-home-btn--primary" data-testid="needs-item-act" onClick={() => act(a)}>{a.action.label ?? rowVerb(a, null)}</button>}
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
                const gateKind = a.reason !== null && /deliver/i.test(a.reason) ? 'deliver' : null;
                const meta = [v?.session.repo_ref ?? null, a.waitedSince != null ? `waiting ${waitWords(a.waitedSince, now)}` : null].filter((x): x is string => x !== null).join(' · ');
                return (
                  <li key={a.id} className="wk-needs-row" data-testid="needs-item" data-id={a.id} data-kind={a.kind ?? undefined} data-blocks={a.blockedRunIds?.length ?? 0}>
                    <span aria-hidden className="wk-needs-dot wk-needs-dot--sm" data-level={a.level} />
                    <span className="wk-needs-row-body">
                      <span className="wk-needs-row-title">{a.text}</span>
                      <span className="wk-needs-row-line">{meta !== '' ? meta : (a.reason ?? '')}</span>
                    </span>
                    {path !== null
                      ? <a href={path} onClick={go(path)} className="wk-home-link wk-needs-row-act" data-testid="needs-item-act">{rowVerb(a, gateKind)} <span aria-hidden>→</span></a>
                      : a.action !== null && <button type="button" className="wk-home-btn wk-home-btn--secondary" data-testid="needs-item-act" onClick={() => act(a)}>{rowVerb(a, null)}</button>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {items.length === 0 && <p className="wk-home-calm" data-testid="needs-calm">Nothing is waiting on you.</p>}

        {/* Studio's own chores sit under what holds work up (the mockup leads with the stuck items). */}
        {extra}

        <ToResolve snapshot={snapshot} runs={runs} navigate={navigate} />

        {worthCount > 0 && (
          <details className="wk-needs-worth" data-testid="needs-worth">
            <summary className="wk-home-link">{worthCount} {worthCount === 1 ? 'thing' : 'things'} worth a look (not blocking)</summary>
            <ul className="wk-needs-worth-list">
              {toReview > 0 && (
                <li><a href="/steering" onClick={go('/steering')} className="wk-home-link" data-testid="needs-to-review">{toReview} to review</a><span className="wk-needs-meta"> · proposed memories and rules</span></li>
              )}
              {worth.map((r) => (
                <li key={r.key}><a href={r.subjectPath} onClick={go(r.subjectPath)} className="wk-home-link">{r.question ?? r.text}</a></li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

/** "To resolve": the work nobody resolved, with what it cost (/needs and Nerve Center). Nothing when there is none. */
export function ToResolve({ snapshot, runs, navigate }: { snapshot: SystemSnapshot; runs: readonly SessionView[]; navigate: Navigate }): React.ReactElement | null {
  const list = snapshot.unresolved ?? [];
  if (list.length === 0) return null;
  const byId = new Map(runs.map((v) => [v.session.id, v]));
  return (
    <section className="wk-home-sec wk-needs-sec wk-needs-sec--rows" aria-labelledby="needs-resolve" data-testid="needs-resolve">
      <div className="wk-home-sec-head">
        <h2 id="needs-resolve" className="wk-home-label">To resolve</h2>
        <span className="wk-needs-meta" data-testid="needs-resolve-words">{toResolveWords(list.length, snapshot.unresolvedSpendUsd ?? null)}</span>
      </div>
      <p className="wk-needs-note">Jobs that stopped and nobody closed. Retry them, or archive them with a reason so the record stays honest.</p>
      <ul className="wk-needs-rows">
        {list.map((u) => <ResolveRow key={u.runId} u={u} view={byId.get(u.runId) ?? null} navigate={navigate} />)}
      </ul>
    </section>
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
        <span className="wk-needs-row-line">{u.reason} · {costWords(u)}</span>
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
