import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, isRouteAbsent } from '../../api/errors.js';
import {
  bodyShown,
  depthOf,
  productPublishApi,
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
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  /** Each run's generation: an answer for an earlier run never lands on this one. */
  const gen = useRef(0);
  const key = `${projectId}\u0000${runId}`;

  const load = useCallback((mine: number): void => {
    productPublishApi.read(projectId, runId).then(
      (raw) => {
        if (!mounted.current || gen.current !== mine) return;
        const body = publicationsOf(raw, runId);
        setRead(body === null ? { phase: 'failed', words: 'crew’s answer about publishing this plan couldn’t be read.' } : { phase: 'ok', body });
      },
      (e: unknown) => {
        if (!mounted.current || gen.current !== mine) return;
        setRead(isRouteAbsent(e) ? { phase: 'absent' } : { phase: 'failed', words: publishRefusal(e) });
      },
    );
  }, [projectId, runId]);

  useEffect(() => {
    const mine = ++gen.current;
    setRead({ phase: 'loading' });
    setAsk({ phase: 'idle' });
    setPick(0);
    setAnswers({});
    setResolveNote({});
    load(mine);
    // `key` stands for the project and the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (read.phase === 'absent') return null;
  const head = <h3 id={`product-publish-title-${runId}`} className="wk-pub-title">Publish the plan to GitHub</h3>;
  if (read.phase === 'loading') {
    return <section className="wk-pub" aria-labelledby={`product-publish-title-${runId}`} data-testid="product-publish">{head}<p className="wk-src-cap">Asking crew whether this plan can be published…</p></section>;
  }
  if (read.phase === 'failed') {
    return <section className="wk-pub" aria-labelledby={`product-publish-title-${runId}`} data-testid="product-publish">{head}<p className="wk-src-note wk-src-tone-fail" data-testid="product-publish-unreadable">{read.words}</p></section>;
  }
  const { publishable, targets, publications } = read.body;
  const open = targets.filter((t) => !publications.some((p) => p.published && p.repo === t.repo && p.source === t.source));
  const target = open[Math.min(pick, Math.max(0, open.length - 1))];
  // An earlier attempt at this repository that a person must settle first (crew refuses a confirm with `unresolved`),
  // or one being sent now: no card is offered until it is settled.
  const held = target === undefined ? undefined : publications.find((p) => p.repo === target.repo && p.source === target.source && p.items.some((i) => i.state === 'unsure' || i.state === 'sending'));

  const showCard = async (): Promise<void> => {
    if (target === undefined || ask.phase === 'asking' || ask.phase === 'sending') return;
    const mine = gen.current;
    setAsk({ phase: 'asking' });
    try {
      const answer = publishResponseOf(await productPublishApi.post(projectId, { runId, repo: repoSelector(target, targets) }), runId, projectId);
      if (!mounted.current || gen.current !== mine) return;
      setAsk(answer === null || answer.done ? { phase: 'refused', words: UNREADABLE } : { phase: 'card', card: answer.card, hash: answer.publishHash, publication: answer.publication });
    } catch (e) {
      if (!mounted.current || gen.current !== mine) return;
      setAsk({ phase: 'refused', words: publishRefusal(e) });
    }
  };

  const confirm = async (): Promise<void> => {
    if (ask.phase !== 'card') return;
    const mine = gen.current;
    const { card, hash, publication } = ask;
    setAsk({ phase: 'sending', card, hash, publication });
    try {
      // The card's own repository and the card's hash: nothing else rides along.
      const answer = publishResponseOf(await productPublishApi.post(projectId, { runId, repo: repoSelector({ repo: card.repo, source: card.source }, targets), confirm: hash }), runId, projectId);
      if (!mounted.current || gen.current !== mine) return;
      setAsk(answer !== null && answer.done ? { phase: 'done', publication: answer.publication } : { phase: 'refused', words: UNREADABLE });
    } catch (e) {
      if (!mounted.current || gen.current !== mine) return;
      const body = e instanceof ApiError && typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>) : {};
      // The card changed since it was shown: crew's fresh card waits for a new click (nothing was sent).
      const fresh = publishRefusalCode(e) === 'card_changed' ? publishResponseOf({ done: false, card: body['card'], publishHash: body['publishHash'], publication: null }, runId, projectId) : null;
      setAsk(fresh !== null && !fresh.done ? { phase: 'card', card: fresh.card, hash: fresh.publishHash, publication: null, note: publishRefusal(e) } : { phase: 'refused', words: publishRefusal(e) });
    }
    if (mounted.current && gen.current === mine) load(mine);
  };

  const resolve = async (p: PublicationState, item: PublicationItemState, issue: number | null): Promise<void> => {
    if (resolving !== null) return;
    const mine = gen.current;
    const slot = `${p.repo}\u0000${item.key}`;
    setResolving(slot);
    setResolveNote((m) => { const rest = { ...m }; delete rest[slot]; return rest; });
    try {
      const answer = publishResponseOf(await productPublishApi.post(projectId, { runId, repo: repoSelector({ repo: p.repo, source: p.source }, targets.length > 0 ? targets : [{ repo: p.repo, source: p.source }]), resolve: { key: item.key, issue } }), runId, projectId);
      if (!mounted.current || gen.current !== mine) return;
      if (answer === null) setResolveNote((m) => ({ ...m, [slot]: UNREADABLE }));
    } catch (e) {
      if (!mounted.current || gen.current !== mine) return;
      setResolveNote((m) => ({ ...m, [slot]: publishRefusal(e) }));
    } finally {
      if (mounted.current && gen.current === mine) setResolving(null);
    }
    if (mounted.current && gen.current === mine) load(mine);
  };

  const composeAgain = (): void => openLaunchWizard({ workflowId: DRAFT_EPICS_ID, projectId, composerKey: 'desk' });
  const busy = ask.phase === 'asking' || ask.phase === 'sending';
  const card = ask.phase === 'card' || ask.phase === 'sending' ? ask.card : null;

  return (
    <section className="wk-pub" aria-labelledby={`product-publish-title-${runId}`} data-testid="product-publish">
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
        <div key={`${p.source}\u0000${p.repo}`} className="wk-pub-publication" data-testid="product-publish-publication" data-published={p.published ? 'true' : 'false'}>
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
              const n = /^#?\d{1,9}$/.test(typed.trim()) ? Number(typed.trim().replace('#', '')) : null;
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
                      <button type="button" className="wk-btn wk-btn--sm" data-testid="product-publish-resolve-exists" disabled={n === null || resolving !== null} onClick={() => { if (n !== null) void resolve(p, i, n); }}>It exists</button>
                      <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="product-publish-resolve-absent" disabled={resolving !== null} onClick={() => void resolve(p, i, null)}>It wasn’t created</button>
                      {resolveNote[slot] !== undefined && <p className="wk-src-note wk-src-tone-fail" data-testid="product-publish-resolve-note">{resolveNote[slot]}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {publishable.ok && open.length === 0 && targets.length === 0 && (
        <p className="wk-src-note" data-testid="product-publish-no-target">To publish its {publishable.items} issues, link a GitHub repository to this project as a tracker.</p>
      )}

      {publishable.ok && held !== undefined && card === null && (
        <p className="wk-src-note wk-src-tone-warn" data-testid="product-publish-held">
          {held.items.some((i) => i.state === 'unsure')
            ? `Before anything more is sent to ${held.repo}, say for each issue marked “not known” whether it exists.`
            : `Issues are being sent to ${held.repo} now. Look again in a moment.`}
        </p>
      )}

      {publishable.ok && target !== undefined && held === undefined && card === null && (
        <div className="wk-src-row-btns">
          {open.length > 1 && (
            <select className="wk-pub-pick" aria-label="The repository to publish to" data-testid="product-publish-pick" value={Math.min(pick, open.length - 1)} disabled={busy} onChange={(e) => { setPick(Number(e.target.value)); setAsk({ phase: 'idle' }); }}>
              {open.map((t, k) => <option key={`${t.source}\u0000${t.repo}`} value={k}>{t.repo} ({t.source})</option>)}
            </select>
          )}
          <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="product-publish-show" disabled={busy} onClick={() => void showCard()}>
            {ask.phase === 'asking' ? 'Asking crew…' : open.length > 1 ? `Show the ${publishable.items} issues` : `Show the ${publishable.items} issues for ${target.repo}`}
          </button>
        </div>
      )}

      {card !== null && (ask.phase === 'card' || ask.phase === 'sending') && (
        <div className="wk-pub-card" data-testid="product-publish-card">
          <p className="wk-src-note">
            Nothing is created until you confirm. crew creates these {card.items.length} issues in <b>{card.repo}</b> as <b>{card.identity}</b> on {card.source}, one at a time, then reads each back.
          </p>
          {ask.phase === 'card' && ask.note !== undefined && <p className="wk-src-note wk-src-tone-warn" data-testid="product-publish-note">{ask.note}</p>}
          <ul className="wk-pub-list">
            {card.items.map((i) => (
              <li key={i.key} className="wk-pub-item" data-depth={depthOf(i.kind)} data-testid="product-publish-card-item">
                <span className="wk-pub-item-head"><span className="wk-pub-kind">{KIND_WORD[i.kind]}</span><span>{i.title}</span></span>
                <details>
                  <summary>Text</summary>
                  <pre className="wk-pub-body">{bodyShown(i)}</pre>
                </details>
              </li>
            ))}
          </ul>
          <div className="wk-src-row-btns">
            <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="product-publish-confirm" disabled={ask.phase === 'sending'} onClick={() => void confirm()}>
              {ask.phase === 'sending' ? 'Creating…' : `Create ${card.items.length} issues`}
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
