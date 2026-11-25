import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, isRouteAbsent } from '../../api/errors.js';
import {
  bodyShown,
  depthOf,
  ISSUE_MAX,
  productPublishApi,
  publicationOf,
  publicationsOf,
  publishRefusal,
  publishRefusalCode,
  publishResponseOf,
  repoSelector,
  type ProductPublicationsResponse,
  type ProductPublishCard,
  type PublicationItemState,
  type PublicationState,
} from '../../api/productPublish.js';
import { DRAFT_EPICS_ID, openLaunchWizard } from '../../store/launchWizard.js';

type Read = { phase: 'loading' } | { phase: 'absent' } | { phase: 'failed'; words: string } | { phase: 'ok'; body: ProductPublicationsResponse };

type Ask =
  | { phase: 'idle'; note?: string }
  | { phase: 'asking' }
  | { phase: 'card'; card: ProductPublishCard; hash: string; publication: PublicationState | null; note?: string }
  | { phase: 'sending'; card: ProductPublishCard; hash: string; publication: PublicationState | null }
  | { phase: 'done'; publication: PublicationState }
  | { phase: 'refused'; words: string };

/** The publication a refusal carries (`unresolved`, `publication_differs`), when it is crew's shape. */
function errorPublication(e: unknown): PublicationState | null {
  const body = e instanceof ApiError && typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>) : {};
  const code = publishRefusalCode(e);
  return (code === 'unresolved' || code === 'publication_differs') && body['publication'] !== undefined ? publicationOf(body['publication']) : null;
}

const UNREADABLE = 'crew answered in a form this studio can’t read. Look at the repository before trying again.';
/** The refusals whose way on is a new Compose run (an old run, or a plan crew can't confirm is the launched one). */
const COMPOSE_AGAIN: ReadonlySet<string> = new Set(['not_a_compose', 'compose_unverified']);

/** One item's state, in words, with its tone. Pure. */
export function itemStateWords(i: PublicationItemState): { words: string; tone: 'ok' | 'warn' | 'fail' | 'muted' } {
  switch (i.state) {
    case 'created':
      return i.readBack === 'ok' ? { words: 'Created, and checked on GitHub', tone: 'ok' }
        : i.readBack === 'differs' ? { words: 'Created, but GitHub now shows a different title or text', tone: 'warn' }
          : { words: 'Created, but it couldn’t be read back from GitHub (it may have been deleted)', tone: 'warn' };
    case 'sending': return { words: 'Being sent now', tone: 'muted' };
    case 'not_sent': return { words: `Not sent${i.why !== undefined ? `: ${i.why}` : ''}`, tone: 'fail' };
    case 'unsure': return { words: `Not known whether GitHub created it${i.why !== undefined ? `: ${i.why.replace(/[.\s]+$/, '')}` : ''}. Look in the repository, then say below.`, tone: 'warn' };
    case 'absent': return { words: 'Not created (you said so); publishing again creates it', tone: 'muted' };
    case 'missing': return { words: 'Not sent yet', tone: 'muted' };
  }
}

const KIND_WORD = { epic: 'Epic', feature: 'Feature', story: 'Story' } as const;

/** How often a panel showing an issue being sent looks again. */
const SENDING_POLL_MS = 3000;

/** The issue number a person typed (`12` or `#12`), or `null` when it is not one crew accepts. Pure. */
export function issueNumberOf(typed: string): number | null {
  const m = /^#?([1-9]\d{0,9})$/.exec(typed.trim());
  const n = m === null ? NaN : Number(m[1]);
  return Number.isSafeInteger(n) && n <= ISSUE_MAX ? n : null;
}

/**
 * PUBLISH TO GITHUB on a finished Compose run (wicked-crew#372): the plan's epics, features and stories as GitHub
 * issues in a repository linked to the job's project as a tracker.
 *
 * crew's read says up front whether the run can be published and, when not, why in plain words (a plan edited at its
 * gate, a run composed before publishing shipped), so a person never finds out after the click. Show what would be
 * created asks crew for its card (nothing is sent); Create sends exactly that card's hash; each issue's state is crew's
 * journal plus its read-back from GitHub. An issue crew can't tell was created is never sent again: a person says
 * whether it exists. Hidden on a crew without the route.
 *
 * The ONLY caller of `productPublishApi.post`; a confirm or a resolve happens only on a click.
 */
export function ProductPublish({ projectId, runId }: { projectId: string; runId: string }): React.ReactElement | null {
  const [read, setRead] = useState<Read>({ phase: 'loading' });
  const [pick, setPick] = useState(0);
  const [ask, setAsk] = useState<Ask>({ phase: 'idle' });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState<Record<string, string>>({});
  /** A refresh that failed AFTER crew's state was shown: the state shown stays (it is crew's last word), this says so. */
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  /** Each finished read attempt (landed, failed or overtaken): what re-arms the look-again while an issue is sending. */
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  /** Each run's generation: an answer for an earlier run never lands on this one. */
  const gen = useRef(0);
  /** Each read's (and each write's) turn: only the newest read lands, and a write's answer outranks a read sent before it. */
  const seq = useRef(0);
  /** The one call in flight (a card, a confirm or a resolve): a second click in the same frame sends nothing. */
  const inFlight = useRef<object | null>(null);
  const key = `${projectId}\u0000${runId}`;
  const here = (mine: number): boolean => mounted.current && gen.current === mine;

  const load = useCallback((mine: number, keep: boolean): void => {
    const turn = ++seq.current;
    const settle = (land: () => void): void => {
      if (!mounted.current || gen.current !== mine) return;
      setTick((t) => t + 1);
      // Overtaken by a newer read, or by a write's own answer: this one says nothing.
      if (seq.current === turn) land();
    };
    productPublishApi.read(projectId, runId).then(
      (raw) => settle(() => {
        const body = publicationsOf(raw, runId);
        if (body === null && keep) { setRefreshNote('crew’s latest answer couldn’t be read; this is what it said before.'); return; }
        setRefreshNote(null);
        setRead(body === null ? { phase: 'failed', words: 'crew’s answer about publishing this plan couldn’t be read.' } : { phase: 'ok', body });
      }),
      (e: unknown) => settle(() => {
        // A failed refresh never erases what crew already said happened (not even a route that went away).
        if (keep) {
          setRead((prev) => (prev.phase === 'ok' ? prev : isRouteAbsent(e) ? { phase: 'absent' } : { phase: 'failed', words: publishRefusal(e) }));
          setRefreshNote(`${publishRefusal(e)} What is shown is crew’s last answer.`);
          return;
        }
        setRead(isRouteAbsent(e) ? { phase: 'absent' } : { phase: 'failed', words: publishRefusal(e) });
      }),
    );
  }, [projectId, runId]);

  /** A publication crew answered on a write: shown at once (replacing that repository's), ahead of any read in flight. */
  const merge = (p: PublicationState | null | undefined, repo: string): void => {
    // Only a publication for the repository asked about is taken (the answer's own card is checked by its reader).
    if (p === null || p === undefined || p.repo !== repo) return;
    seq.current++;
    setRead((prev) => (prev.phase !== 'ok' ? prev : { phase: 'ok', body: { ...prev.body, publications: [...prev.body.publications.filter((x) => x.repo !== p.repo), p] } }));
  };

  useEffect(() => {
    const mine = ++gen.current;
    inFlight.current = null;
    setRead({ phase: 'loading' });
    setAsk({ phase: 'idle' });
    setPick(0);
    setAnswers({});
    setResolving(null);
    setResolveNote({});
    setRefreshNote(null);
    load(mine, false);
    // `key` stands for the project and the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // While crew says an issue is being sent (this daemon, maybe another person's click), look again every few seconds.
  const sendingNow = read.phase === 'ok' && read.body.publications.some((p) => p.items.some((i) => i.state === 'sending'));
  useEffect(() => {
    if (!sendingNow) return undefined;
    const mine = gen.current;
    const t = setTimeout(() => { if (here(mine)) load(mine, true); }, SENDING_POLL_MS);
    return () => clearTimeout(t);
    // Re-armed by each read attempt (landed, failed or overtaken) and each write's answer while it still says `sending`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, tick, sendingNow]);

  if (read.phase === 'absent') return null;
  const titleId = `product-publish-title-${runId}`;
  const head = <h3 id={titleId} className="wk-pub-title">Publish the plan to GitHub</h3>;
  const lookAgain = (
    <div className="wk-src-row-btns">
      <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="product-publish-refresh" onClick={() => load(gen.current, read.phase === 'ok')}>Look again</button>
    </div>
  );
  if (read.phase === 'loading') {
    return <section className="wk-pub" aria-labelledby={titleId} data-testid="product-publish">{head}<p className="wk-src-cap">Asking crew whether this plan can be published…</p></section>;
  }
  if (read.phase === 'failed') {
    return <section className="wk-pub" aria-labelledby={titleId} data-testid="product-publish">{head}<p className="wk-src-note wk-src-tone-fail" data-testid="product-publish-unreadable">{read.words}</p>{lookAgain}</section>;
  }
  const { publishable, targets, publications } = read.body;
  // crew keeps ONE publication per run and repository, whichever source sent it: a repository is matched by its name only.
  const pubOf = (repo: string): PublicationState | undefined => publications.find((p) => p.repo === repo);
  const open = targets.filter((t) => pubOf(t.repo)?.published !== true);
  const target = open[Math.min(pick, Math.max(0, open.length - 1))];
  // An earlier attempt at this repository that a person must settle first (crew refuses a confirm with `unresolved`),
  // or one being sent now: no card is offered for it until it is settled.
  const heldOf = (repo: string): PublicationState | undefined => { const p = pubOf(repo); return p !== undefined && p.items.some((i) => i.state === 'unsure' || i.state === 'sending') ? p : undefined; };
  const held = target === undefined ? undefined : heldOf(target.repo);

  /** Runs one write at a time: a second click while one is in flight (even in the same frame) sends nothing. */
  const once = async (run: (mine: number) => Promise<void>): Promise<void> => {
    if (inFlight.current !== null) return;
    const token = {};
    inFlight.current = token;
    try {
      await run(gen.current);
    } finally {
      if (inFlight.current === token) inFlight.current = null;
    }
  };

  const showCard = (): Promise<void> => once(async (mine) => {
    if (target === undefined) return;
    setAsk({ phase: 'asking' });
    seq.current++;
    try {
      const answer = publishResponseOf(await productPublishApi.post(projectId, { runId, repo: repoSelector(target, targets) }), runId, projectId);
      if (!here(mine)) return;
      if (answer === null || answer.done || answer.card.repo !== target.repo) { setAsk({ phase: 'refused', words: UNREADABLE }); return; }
      merge(answer.publication, target.repo);
      // A card over an attempt that must be settled first is not offered: the publication above says what to do.
      const unsettled = answer.publication?.items.some((i) => i.state === 'unsure' || i.state === 'sending') === true;
      setAsk(unsettled ? { phase: 'idle' } : { phase: 'card', card: answer.card, hash: answer.publishHash, publication: answer.publication });
    } catch (e) {
      if (!here(mine)) return;
      // `publication_differs` carries the publication crew already holds for this repository: it is shown.
      merge(errorPublication(e), target.repo);
      setAsk({ phase: 'refused', words: publishRefusal(e) });
    }
  });

  const confirm = (): Promise<void> => once(async (mine) => {
    if (ask.phase !== 'card' || heldOf(ask.card.repo) !== undefined) return;
    const { card, hash, publication } = ask;
    setAsk({ phase: 'sending', card, hash, publication });
    seq.current++;
    try {
      // The card's own repository and the card's hash: nothing else rides along.
      const answer = publishResponseOf(await productPublishApi.post(projectId, { runId, repo: repoSelector({ repo: card.repo, source: card.source }, targets), confirm: hash }), runId, projectId);
      if (!here(mine)) return;
      // The answer is this card's: its repository, and the publication the confirmed hash approved.
      if (answer !== null && answer.done && answer.card.repo === card.repo && answer.publication.publishHash === hash) {
        merge(answer.publication, card.repo);
        setAsk({ phase: 'done', publication: answer.publication });
      } else {
        setAsk({ phase: 'refused', words: UNREADABLE });
      }
    } catch (e) {
      if (!here(mine)) return;
      const body = e instanceof ApiError && typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>) : {};
      // `unresolved` and `publication_differs` carry the publication as crew holds it now: it is shown.
      merge(errorPublication(e), card.repo);
      // The card changed since it was shown: crew's fresh card waits for a new click (nothing was sent).
      const fresh = publishRefusalCode(e) === 'card_changed' ? publishResponseOf({ done: false, card: body['card'], publishHash: body['publishHash'], publication: null }, runId, projectId) : null;
      setAsk(fresh !== null && !fresh.done ? { phase: 'card', card: fresh.card, hash: fresh.publishHash, publication, note: publishRefusal(e) } : { phase: 'refused', words: publishRefusal(e) });
    }
    if (here(mine)) load(mine, true);
  });

  const resolve = (p: PublicationState, item: PublicationItemState, issue: number | null): Promise<void> => once(async (mine) => {
    const slot = `${p.repo}\u0000${item.key}`;
    setResolving(slot);
    setResolveNote((m) => { const rest = { ...m }; delete rest[slot]; return rest; });
    seq.current++;
    try {
      const answer = publishResponseOf(await productPublishApi.post(projectId, { runId, repo: repoSelector({ repo: p.repo, source: p.source }, targets.some((t) => t.repo === p.repo) ? targets : [{ repo: p.repo, source: p.source }]), resolve: { key: item.key, issue } }), runId, projectId);
      if (!here(mine)) return;
      if (answer === null) setResolveNote((m) => ({ ...m, [slot]: UNREADABLE }));
      else merge(answer.publication, p.repo);
    } catch (e) {
      if (!here(mine)) return;
      setResolveNote((m) => ({ ...m, [slot]: publishRefusal(e) }));
    } finally {
      if (here(mine)) setResolving(null);
    }
    if (here(mine)) load(mine, true);
  });

  const composeAgain = (): void => openLaunchWizard({ workflowId: DRAFT_EPICS_ID, projectId, composerKey: 'desk' });
  const busy = ask.phase === 'asking' || ask.phase === 'sending' || resolving !== null;
  // A card waiting for a click is withdrawn once crew says its repository holds an issue being sent or not known.
  const card = ask.phase === 'sending' || (ask.phase === 'card' && heldOf(ask.card.repo) === undefined) ? ask.card : null;
  // What a confirm would create now: the card's items not already created (a retry sends only the rest).
  const already = card === null ? new Map<string, PublicationItemState>() : new Map((pubOf(card.repo)?.items ?? []).filter((i) => i.state === 'created').map((i) => [i.key, i]));
  const toCreate = card === null ? 0 : card.items.filter((i) => !already.has(i.key)).length;

  return (
    <section className="wk-pub" aria-labelledby={titleId} data-testid="product-publish">
      {head}
      {!publishable.ok && (
        <>
          <p className="wk-src-note wk-src-tone-warn" data-testid="product-publish-blocked" data-code={publishable.code}>
            {`${publishable.error.charAt(0).toUpperCase()}${publishable.error.slice(1)}.`}
          </p>
          {COMPOSE_AGAIN.has(publishable.code) && (
            <div className="wk-src-row-btns">
              <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="product-publish-compose-again" onClick={composeAgain}>Compose again</button>
            </div>
          )}
        </>
      )}

      {publications.map((p) => (
        <div key={p.repo} className="wk-pub-publication" data-testid="product-publish-publication" data-repo={p.repo} data-published={p.published ? 'true' : 'false'}>
          <p className="wk-run-tab-line">
            <b>{p.repo}</b>{' '}
            <span className={`wk-src-note ${p.published ? 'wk-src-tone-ok' : 'wk-src-tone-warn'}`} data-testid="product-publish-verdict">
              {p.published ? `Published: all ${p.items.length} issues created and checked on GitHub.` : `Not fully published: ${p.items.filter((i) => i.state === 'created').length} of ${p.items.length} created.`}
            </span>
          </p>
          <ul className="wk-pub-list">
            {p.items.map((i) => {
              const s = itemStateWords(i);
              const slot = `${p.repo}\u0000${i.key}`;
              const typed = answers[slot] ?? '';
              const n = issueNumberOf(typed);
              return (
                <li key={i.key} className="wk-pub-item" data-depth={depthOf(i.kind)} data-testid="product-publish-item" data-state={i.state}>
                  <span className="wk-pub-item-head">
                    <span className="wk-pub-kind">{KIND_WORD[i.kind]}</span>
                    <span>{i.title}</span>
                    {i.url !== null && i.number !== null && <a href={i.url} target="_blank" rel="noreferrer" data-testid="product-publish-link">{`#${i.number} ↗`}</a>}
                  </span>
                  <span className="wk-pub-state" data-tone={s.tone}>{s.words}</span>
                  {i.state === 'unsure' && (
                    <div className="wk-pub-resolve" data-testid="product-publish-resolve">
                      <label>
                        <span className="wk-src-cap">It exists as issue </span>
                        <input type="text" inputMode="numeric" aria-label={`The issue number ${i.title} was created as`} placeholder="Issue number" value={typed}
                          onChange={(e) => { const v = e.target.value; setAnswers((m) => ({ ...m, [slot]: v })); }} />
                      </label>
                      <button type="button" className="wk-btn wk-btn--sm" data-testid="product-publish-resolve-exists" disabled={n === null || busy} onClick={() => { if (n !== null) void resolve(p, i, n); }}>It exists</button>
                      <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="product-publish-resolve-absent" disabled={busy} onClick={() => void resolve(p, i, null)}>It wasn’t created</button>
                      {resolveNote[slot] !== undefined && <p className="wk-src-note wk-src-tone-fail" data-testid="product-publish-resolve-note">{resolveNote[slot]}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {refreshNote !== null && <p className="wk-src-note wk-src-tone-warn" data-testid="product-publish-refresh-note">{refreshNote}</p>}

      {publishable.ok && targets.length === 0 && (
        <p className="wk-src-note" data-testid="product-publish-no-target">To publish its {publishable.items} issues, link a GitHub repository to this project as a tracker.</p>
      )}

      {publishable.ok && target !== undefined && card === null && (
        <div className="wk-src-row-btns">
          {open.length > 1 && (
            <select className="wk-pub-pick" aria-label="The repository to publish to" data-testid="product-publish-pick" value={Math.min(pick, open.length - 1)} disabled={busy} onChange={(e) => { setPick(Number(e.target.value)); setAsk({ phase: 'idle' }); }}>
              {open.map((t, k) => <option key={`${t.source}\u0000${t.repo}`} value={k}>{t.repo} ({t.source})</option>)}
            </select>
          )}
          {held === undefined && (
            <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="product-publish-show" disabled={busy} onClick={() => void showCard()}>
              {ask.phase === 'asking' ? 'Asking crew…' : open.length > 1 ? `Show the ${publishable.items} issues` : `Show the ${publishable.items} issues for ${target.repo}`}
            </button>
          )}
        </div>
      )}

      {publishable.ok && held !== undefined && card === null && (
        <p className="wk-src-note wk-src-tone-warn" data-testid="product-publish-held">
          {held.items.some((i) => i.state === 'unsure')
            ? `Before anything more is sent to ${held.repo}, say for each issue marked “not known” whether it exists.`
            : `Issues are being sent to ${held.repo} now; this looks again every few seconds.`}
        </p>
      )}
      {(sendingNow || refreshNote !== null) && lookAgain}

      {card !== null && (ask.phase === 'card' || ask.phase === 'sending') && (
        <div className="wk-pub-card" data-testid="product-publish-card">
          <p className="wk-src-note" data-testid="product-publish-card-what">
            {toCreate === 0
              ? <>All {card.items.length} issues already exist in <b>{card.repo}</b>: nothing is created; crew reads each back again.</>
              : <>Nothing is created until you confirm. crew creates {toCreate === card.items.length ? `these ${toCreate} issues` : `the ${toCreate} issues not created yet (${card.items.length - toCreate} already exist and are not sent again)`} in <b>{card.repo}</b> as <b>{card.identity}</b> on {card.source}, one at a time, then reads each back.</>}
          </p>
          {ask.phase === 'card' && ask.note !== undefined && <p className="wk-src-note wk-src-tone-warn" data-testid="product-publish-note">{ask.note}</p>}
          <ul className="wk-pub-list">
            {card.items.map((i) => {
              const made = already.get(i.key);
              return (
                <li key={i.key} className="wk-pub-item" data-depth={depthOf(i.kind)} data-testid="product-publish-card-item" data-exists={made !== undefined ? 'true' : 'false'}>
                  <span className="wk-pub-item-head"><span className="wk-pub-kind">{KIND_WORD[i.kind]}</span><span>{i.title}</span>{made !== undefined && made.number !== null && <span className="wk-pub-state">{`already #${made.number}`}</span>}</span>
                  <details>
                    <summary>Text</summary>
                    <pre className="wk-pub-body">{bodyShown(i)}</pre>
                  </details>
                </li>
              );
            })}
          </ul>
          <div className="wk-src-row-btns">
            <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="product-publish-confirm" disabled={ask.phase === 'sending'} onClick={() => void confirm()}>
              {ask.phase === 'sending' ? (toCreate === 0 ? 'Checking…' : 'Creating…') : toCreate === 0 ? 'Check them again' : `Create ${toCreate} issue${toCreate === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="product-publish-cancel" disabled={ask.phase === 'sending'} onClick={() => setAsk({ phase: 'idle', note: 'Nothing was sent.' })}>Cancel</button>
          </div>
        </div>
      )}

      {ask.phase === 'idle' && ask.note !== undefined && <p className="wk-src-cap" data-testid="product-publish-cancelled">{ask.note}</p>}
      {ask.phase === 'refused' && <p className="wk-src-note wk-src-tone-fail" data-testid="product-publish-refused">{ask.words}</p>}
    </section>
  );
}
