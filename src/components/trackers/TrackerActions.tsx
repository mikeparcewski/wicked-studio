import { useEffect, useRef, useState } from 'react';
import { ApiError, isRouteAbsent } from '../../api/errors.js';
import {
  runTrackerIssuesOf,
  trackerActionOf,
  trackerActionRefusal,
  trackersApi,
  useTrackerLinksSupported,
  type TrackerActionBody,
  type TrackerActionCard,
  type TrackerActionResponse,
} from '../../api/trackers.js';
import { useProjectsStore } from '../../store/projects.js';
import { TrackerBadge } from './TrackerParts.js';

/** The job's name in a tracker comment: its first line, cut to 80 characters. */
export function actionJobTitle(problem: unknown): string {
  const p = typeof problem === 'string' ? problem.trim().split('\n')[0]!.trim() : '';
  return p === '' ? 'this job' : p.length > 80 ? `${p.slice(0, 79)}…` : p;
}

/** One action crew can be asked for: a comment, or a move, on one issue the job addresses. */
export interface ActionProposal {
  key: string;
  /** The issue as the job named it, and its tool: crew's card must be for exactly this. */
  issue: string;
  source: string;
  part: 'comment' | 'transition';
  /** Exactly what is sent: the card asks for it, the confirm repeats it with the card's hash. */
  body: TrackerActionBody;
}

/**
 * What studio proposes for each issue the job addresses that crew still admits (DES-PM-001 §5, §6 step 4): a comment
 * saying where the work is, and, for a Jira issue, a move (to In Review at the deliver gate, to Done once delivered).
 * A GitHub issue gets no move: its PR's "Fixes" closes it on merge. Pure.
 */
export function proposalsFor(issues: ReadonlyArray<{ issue: string; ref: string; source: string; system: string; admittedBy: unknown }>, stage: 'gate' | 'delivery', ctx: { title: string; prUrl: string | null }): ActionProposal[] {
  const out: ActionProposal[] = [];
  for (const i of issues) {
    if (i.admittedBy === null) continue;
    const comment = stage === 'delivery' && ctx.prUrl !== null
      ? `Delivered in ${ctx.prUrl} (job “${ctx.title}”).`
      : `A change for this is waiting at the deliver gate of the job “${ctx.title}”.`;
    out.push({ key: `${i.ref}\u0000comment`, issue: i.issue, source: i.source, part: 'comment', body: { issue: i.ref, comment } });
    if (i.system === 'jira') out.push({ key: `${i.ref}\u0000transition`, issue: i.issue, source: i.source, part: 'transition', body: { issue: i.ref, transition: stage === 'delivery' ? 'Done' : 'In Review' } });
  }
  return out;
}

/**
 * Whether crew's card shows exactly the action asked for, and nothing else: the same tool, the same issue, and for a
 * comment its exact text (no move), for a move a move (no comment). Only such a card can be confirmed: a card that leaves
 * part of the action out, or adds one, never gets a Confirm button.
 */
export function cardShows(p: Pick<ActionProposal, 'issue' | 'source' | 'part' | 'body'>, c: TrackerActionCard): boolean {
  if (c.source !== p.source) return false;
  // GitHub: the job may name `#42`, crew the whole `owner/repo#42`.
  const sameIssue = c.issue === p.issue || c.issue === p.body.issue || (/^#\d+$/.test(p.issue) && /^[^#\s/]+\/[^#\s/]+#\d+$/.test(c.issue) && c.issue.endsWith(p.issue));
  if (!sameIssue) return false;
  return p.part === 'comment'
    ? c.comment !== undefined && c.comment === p.body.comment && c.transition === undefined
    : c.transition !== undefined && c.comment === undefined;
}

const NOT_THIS = 'crew’s card doesn’t show exactly this action (the issue, the text or the move), so it can’t be confirmed. Nothing was sent.';

type Row =
  | { phase: 'loading' }
  | { phase: 'card'; card: TrackerActionCard; hash: string; note?: string }
  | { phase: 'sending'; card: TrackerActionCard; hash: string }
  | { phase: 'done'; answer: Extract<TrackerActionResponse, { done: true }> }
  | { phase: 'refused'; words: string; card?: TrackerActionCard }
  | { phase: 'skipped' };

const STATE_WORDS = { todo: 'to do', doing: 'doing', done: 'done' } as const;
const stateLine = (name: string | null, mapped: 'todo' | 'doing' | 'done' | null): string => `${name ?? 'its current state'}${mapped !== null ? ` (${STATE_WORDS[mapped]})` : ''}`;

/**
 * TRACKER ACTIONS on the deliver gate and the delivery (DES-PM-001 §5): for each issue the job addresses, what crew
 * would post (a comment with its exact text, a move from one state to another), as which account, and the link that
 * admits the issue: each with Confirm and Skip. The card is crew's (`POST /runs/:id/tracker-actions` without `confirm`
 * sends nothing); Confirm sends exactly that body with the card's hash, and the result shows as crew answers it. Skip
 * sends nothing. Hidden on a crew without tracker links or without the route, and when the job addresses no issue crew
 * still admits.
 *
 * The ONLY caller of `trackersApi.action` (`tests/trackersHumanOnly.test.ts`); a confirm happens only on a click.
 */
export function TrackerActions({ runId, stage, title, prUrl = null, 'data-testid': testId = 'tracker-actions' }: {
  runId: string;
  stage: 'gate' | 'delivery';
  title: string;
  prUrl?: string | null;
  'data-testid'?: string;
}): React.ReactElement | null {
  const supported = useTrackerLinksSupported();
  const projects = useProjectsStore((s) => s.projects);
  const [list, setList] = useState<{ runId: string; proposals: ActionProposal[] } | { runId: string; words: string } | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  /** Each run's (stage's, context's) generation: an answer for an earlier one never lands on this one's rows. */
  const gen = useRef(0);
  const proposalKey = `${runId}\u0000${stage}\u0000${title}\u0000${prUrl ?? ''}`;

  // The issues, then each proposal's card (a read: crew sends nothing without a confirm). Only this job's answers land.
  useEffect(() => {
    if (!supported) return undefined;
    let live = true;
    const mine = ++gen.current;
    setList(null);
    setRows({});
    trackersApi.runIssues(runId).then(
      async (raw) => {
        if (!live) return;
        const r = runTrackerIssuesOf(raw, runId);
        if (r === null) { setList({ runId, words: 'crew’s list of this job’s issues could not be read, so no action is offered.' }); return; }
        const proposals = proposalsFor(r.issues, stage, { title, prUrl });
        setList({ runId, proposals });
        for (const p of proposals) {
          setRows((m) => ({ ...m, [p.key]: { phase: 'loading' } }));
          void trackersApi.action(runId, p.body).then(
            (a) => {
              if (!live || gen.current !== mine) return;
              const answer = trackerActionOf(a, runId);
              const row: Row = answer === null || answer.done ? { phase: 'refused', words: 'crew answered in a form this studio can’t read, so no card is shown. Nothing was sent.' }
                : !cardShows(p, answer.card) ? { phase: 'refused', words: NOT_THIS }
                  : { phase: 'card', card: answer.card, hash: answer.actionHash };
              setRows((m) => ({ ...m, [p.key]: row }));
            },
            (e: unknown) => {
              if (!live || gen.current !== mine) return;
              // A crew without the action route has no tracker actions at all: the card goes.
              if (isRouteAbsent(e)) { setList({ runId, proposals: [] }); return; }
              setRows((m) => ({ ...m, [p.key]: { phase: 'refused', words: trackerActionRefusal(e) } }));
            },
          ).catch(() => {
            if (live && gen.current === mine) setRows((m) => ({ ...m, [p.key]: { phase: 'refused', words: 'crew answered in a form this studio can’t read, so no card is shown. Nothing was sent.' } }));
          });
        }
      },
      (e: unknown) => {
        if (!live) return;
        // A crew without the route shows nothing; any other failure is said (never "no issues").
        setList(isRouteAbsent(e) ? { runId, proposals: [] } : { runId, words: trackerActionRefusal(e) });
      },
    );
    return () => { live = false; };
    // `proposalKey` stands for the run, the stage, the title and the PR url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, proposalKey]);

  if (!supported || list === null || list.runId !== runId) return null;
  if ('words' in list) return <p className="wk-src-note wk-src-tone-fail" data-testid={`${testId}-unreadable`}>Tracker actions: {list.words}</p>;
  if (list.proposals.length === 0) return null;

  const confirm = async (p: ActionProposal): Promise<void> => {
    const row = rows[p.key];
    if (row === undefined || row.phase !== 'card') return;
    const mine = gen.current;
    const here = (): boolean => mounted.current && gen.current === mine;
    setRows((m) => ({ ...m, [p.key]: { phase: 'sending', card: row.card, hash: row.hash } }));
    try {
      // Exactly the body the card was built from, with the card's hash: nothing else rides along.
      const answer = trackerActionOf(await trackersApi.action(runId, { ...p.body, confirm: row.hash }), runId);
      if (!here()) return;
      setRows((m) => ({ ...m, [p.key]: answer !== null && answer.done && cardShows(p, answer.card) ? { phase: 'done', answer } : { phase: 'refused', words: 'crew’s answer didn’t say whether it was posted. Look at the issue before trying again.', card: row.card } }));
    } catch (e) {
      if (!here()) return;
      const body = e instanceof ApiError && typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>) : {};
      // The card changed since it was shown: crew's new card for the SAME action waits for a new click (nothing was
      // sent); a new card for another action can't be confirmed from this row.
      const fresh = body['code'] === 'card_changed' ? trackerActionOf({ done: false, card: body['card'], actionHash: body['actionHash'] }, runId) : null;
      const already = body['code'] === 'already_done' && body['done'] !== undefined ? trackerActionOf(body['done'], runId) : null;
      setRows((m) => ({
        ...m,
        [p.key]: fresh !== null && !fresh.done ? (cardShows(p, fresh.card) ? { phase: 'card', card: fresh.card, hash: fresh.actionHash, note: trackerActionRefusal(e) } : { phase: 'refused', words: NOT_THIS })
          : already !== null && already.done && cardShows(p, already.card) ? { phase: 'done', answer: already }
            : { phase: 'refused', words: trackerActionRefusal(e), card: row.card },
      }));
    }
  };
  const skip = (p: ActionProposal): void => setRows((m) => ({ ...m, [p.key]: { phase: 'skipped' } }));
  const admitted = (c: TrackerActionCard): string => (c.admittedBy.kind === 'project' ? `linked to ${projects.find((x) => x.id === c.admittedBy.id)?.name ?? c.admittedBy.id}` : `through repo ${c.admittedBy.id}`);

  return (
    <section className="wk-trk-actions" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <h3 id={`${testId}-title`} className="wk-trk-set-title">Tracker actions</h3>
      <p className="wk-src-note">Nothing is posted until you confirm it, and each goes out as the account its tool was registered with.</p>
      {list.proposals.map((p) => {
        const row = rows[p.key] ?? { phase: 'loading' };
        const card = row.phase === 'card' || row.phase === 'sending' ? row.card : row.phase === 'done' ? row.answer.card : row.phase === 'refused' ? row.card : undefined;
        return (
          <div key={p.key} className="wk-trk-action" data-testid={`${testId}-row`} data-part={p.part} data-phase={row.phase}>
            <p className="wk-trk-action-what">
              {card !== undefined && <TrackerBadge system={card.system} small />}
              {/* The issue as crew's card names it (the one it would act on), else as the job named it. */}
              <b>{p.part === 'comment' ? `Comment on ${card?.issue ?? p.issue}` : card?.transition !== undefined ? `Move ${card.issue} from ${stateLine(card.transition.from, card.transition.mapped.from)} to ${stateLine(card.transition.to, card.transition.mapped.to)}` : `Move ${p.issue} to ${p.body.transition ?? ''}`}</b>
              {card?.title !== null && card?.title !== undefined && <span className="wk-src-cap"> · {card.title}</span>}
            </p>
            {p.part === 'comment' && card?.comment !== undefined && <blockquote className="wk-trk-action-text" data-testid={`${testId}-comment`}>{card.comment}</blockquote>}
            {card !== undefined && <p className="wk-src-cap wk-trk-action-who" data-testid={`${testId}-who`}>As {card.identity ?? 'the registered account'} on {card.source} · {card.tenantLabel ?? card.tenant} · {admitted(card)}</p>}
            {row.phase === 'loading' && <p className="wk-src-cap">Asking crew for the card…</p>}
            {row.phase === 'card' && row.note !== undefined && <p className="wk-src-note wk-src-tone-warn" data-testid={`${testId}-note`}>{row.note}</p>}
            {(row.phase === 'card' || row.phase === 'sending') && (
              <div className="wk-src-row-btns">
                <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid={`${testId}-confirm`} disabled={row.phase === 'sending'} onClick={() => void confirm(p)}>{row.phase === 'sending' ? 'Posting…' : 'Confirm'}</button>
                <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid={`${testId}-skip`} disabled={row.phase === 'sending'} onClick={() => skip(p)}>Skip</button>
              </div>
            )}
            {row.phase === 'done' && (
              <ul className="wk-src-plain" data-testid={`${testId}-result`}>
                {row.answer.results.map((r) => (
                  <li key={r.part} className={`wk-src-note ${r.ok ? 'wk-src-tone-ok' : 'wk-src-tone-fail'}`} data-ok={r.ok ? 'true' : 'false'}>
                    {r.part === 'comment' ? (r.ok ? 'Comment posted' : 'Comment not posted') : r.ok ? 'Moved' : 'Not moved'}{r.ok ? (Number.isNaN(Date.parse(row.answer.at)) ? '.' : ` at ${new Date(row.answer.at).toLocaleTimeString()}.`) : `: ${r.error ?? 'the tool refused it'}.`}
                  </li>
                ))}
                {row.answer.results.length === 0 && <li className="wk-src-note wk-src-tone-warn" data-testid={`${testId}-result-unknown`}>crew named no part, so whether anything was posted is not known. Look at the issue before trying again.</li>}
              </ul>
            )}
            {row.phase === 'refused' && <p className="wk-src-note wk-src-tone-fail" data-testid={`${testId}-refused`}>{row.words}</p>}
            {row.phase === 'skipped' && <p className="wk-src-cap" data-testid={`${testId}-skipped`}>Skipped: nothing was sent.</p>}
          </div>
        );
      })}
    </section>
  );
}
