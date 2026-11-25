/**
 * Product publish (wicked-crew#372, api-types 0.229.0): a finished compose run's plan, published as GitHub issues in a
 * repository linked to the project as a tracker. `GET /projects/:id/product/publish/:runId` says whether the run can be
 * published (and why not, before any click), which repositories it can go to, and every publication of the run read
 * back; `POST /projects/:id/product/publish` answers the card (nothing sent), creates on a confirm of the card's hash,
 * and settles one `unsure` item on a resolve.
 *
 * A NARROW mirror of the contract block in `wicked-crew-api-types` 0.229.0 (only the fields studio reads) while studio's
 * pin lags it: every answer is read defensively here, and one unreadable part makes the whole answer unreadable.
 *
 * TODO(api-types >= 0.229.0): once studio pins `wicked-crew-api-types` 0.229.0 or later, these types become
 * re-exports from the package.
 */
import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

export type PublishKind = 'epic' | 'feature' | 'story';

/** (0.229.0) One issue a publication creates; `body` carries `{{parent}}` until it is sent. */
export interface PublishItem { key: string; kind: PublishKind; title: string; body: string; parentKey: string | null }

/** (0.229.0) What a confirm would create, where, and as whom. */
export interface ProductPublishCard { runId: string; projectId: string; repo: string; source: string; identity: string; items: PublishItem[] }

export type PublicationItemStateWord = 'created' | 'sending' | 'not_sent' | 'unsure' | 'absent' | 'missing';

/** (0.229.0) One item of a publication now. */
export interface PublicationItemState {
  key: string;
  kind: PublishKind;
  title: string;
  state: PublicationItemStateWord;
  number: number | null;
  url: string | null;
  readBack: 'ok' | 'differs' | 'unreadable' | null;
  why?: string;
}

/** (0.229.0) One run published to one repository. */
export interface PublicationState { repo: string; source: string; publishHash: string; items: PublicationItemState[]; published: boolean }

/** (0.229.0) `POST /projects/:id/product/publish` 200. */
export type ProductPublishResponse =
  | { done: false; card: ProductPublishCard; publishHash: string; publication: PublicationState | null }
  | { done: true; card: ProductPublishCard; publication: PublicationState };

/** (0.229.0) `GET /projects/:id/product/publish/:runId`. */
export interface ProductPublicationsResponse {
  runId: string;
  publishable: { ok: true; items: number } | { ok: false; code: string; error: string };
  targets: Array<{ repo: string; source: string }>;
  publications: PublicationState[];
}

/** (0.229.0) The POST body. */
export interface ProductPublishBody { runId: string; repo: string; confirm?: string; resolve?: { key: string; issue: number | null } }

const enc = encodeURIComponent;

export const productPublishApi = {
  /** A read: whether the run can be published, where, and every publication of it read back now. */
  read: (projectId: string, runId: string) => apiFetch<unknown>(`/projects/${enc(projectId)}/product/publish/${enc(runId)}`),
  /** No `confirm`/`resolve`: the card, nothing sent. With either: a person's click only (`ProductPublish` is the one caller). */
  post: (projectId: string, body: ProductPublishBody) => apiFetch<unknown>(`/projects/${enc(projectId)}/product/publish`, { method: 'POST', body: JSON.stringify(body) }),
};

// ── reading crew's answers ────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const KINDS: ReadonlySet<string> = new Set(['epic', 'feature', 'story']);
const STATES: ReadonlySet<string> = new Set(['created', 'sending', 'not_sent', 'unsure', 'absent', 'missing']);
const READ_BACK: ReadonlySet<string> = new Set(['ok', 'differs', 'unreadable']);
const KEY = /^e\d+(?:\.f\d+(?:\.s\d+)?)?$/;
/** `owner/repo` (crew names it lower-cased, `trackers/set.ts`; compared lower-cased here too). */
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
/** The largest issue number crew accepts (its resolve schema). */
export const ISSUE_MAX = 9_999_999_999;
const distinct = (keys: readonly string[]): boolean => new Set(keys).size === keys.length;
const HASH = /^[0-9a-f]{64}$/;
/** A reason crew sends is shown as text, cut to 400 characters. */
export const WHY_MAX = 400;
const cut = (s: string): string => (s.length > WHY_MAX ? `${s.slice(0, WHY_MAX - 1)}…` : s);

/** Every entry, or `null`: one unreadable entry makes the whole list unreadable, never shorter. */
function allOf<T>(v: unknown, read: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v as unknown[]) {
    const r = read(x);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

function itemOf(v: unknown): PublishItem | null {
  if (!isObj(v) || typeof v.key !== 'string' || !KEY.test(v.key) || typeof v.kind !== 'string' || !KINDS.has(v.kind) || !isText(v.title) || typeof v.body !== 'string') return null;
  if (v.parentKey !== null && (typeof v.parentKey !== 'string' || !KEY.test(v.parentKey))) return null;
  return { key: v.key, kind: v.kind as PublishKind, title: v.title, body: v.body, parentKey: v.parentKey as string | null };
}

/** crew's card for exactly this run in this project, or `null`. */
export function publishCardOf(v: unknown, runId: string, projectId: string): ProductPublishCard | null {
  if (!isObj(v) || v.runId !== runId || v.projectId !== projectId || typeof v.repo !== 'string' || !REPO.test(v.repo) || !isText(v.source) || !isText(v.identity)) return null;
  const items = allOf(v.items, itemOf);
  if (items === null || items.length === 0 || !distinct(items.map((i) => i.key))) return null;
  return { runId, projectId, repo: v.repo.toLowerCase(), source: v.source, identity: v.identity, items };
}

function itemStateOf(v: unknown): PublicationItemState | null {
  if (!isObj(v) || typeof v.key !== 'string' || !KEY.test(v.key) || typeof v.kind !== 'string' || !KINDS.has(v.kind) || typeof v.title !== 'string'
    || typeof v.state !== 'string' || !STATES.has(v.state)) return null;
  const number = v.number === null ? null : typeof v.number === 'number' && Number.isSafeInteger(v.number) && v.number > 0 && v.number <= ISSUE_MAX ? v.number : undefined;
  const url = v.url === null ? null : typeof v.url === 'string' ? v.url : undefined;
  const readBack = v.readBack === null ? null : typeof v.readBack === 'string' && READ_BACK.has(v.readBack) ? (v.readBack as 'ok' | 'differs' | 'unreadable') : undefined;
  if (number === undefined || url === undefined || readBack === undefined) return null;
  // A created issue has its number, its page and a read-back; anything else has none of them (crew's `stateOf`).
  if (v.state === 'created' ? number === null || url === null || readBack === null : number !== null || url !== null || readBack !== null) return null;
  if (v.why !== undefined && typeof v.why !== 'string') return null;
  return {
    key: v.key, kind: v.kind as PublishKind, title: v.title, state: v.state as PublicationItemStateWord, number, url, readBack,
    ...(typeof v.why === 'string' && v.why !== '' ? { why: cut(v.why) } : {}),
  };
}


/**
 * One publication as crew sends it, or `null`. Its parts must agree: a link is this repository's page for exactly that
 * issue on github.com (nothing else is followed), and `published` says every item was created and read back `ok`.
 */
export function publicationOf(v: unknown): PublicationState | null {
  if (!isObj(v) || typeof v.repo !== 'string' || !REPO.test(v.repo) || !isText(v.source) || typeof v.publishHash !== 'string' || !HASH.test(v.publishHash) || typeof v.published !== 'boolean') return null;
  const items = allOf(v.items, itemStateOf);
  if (items === null || items.length === 0 || !distinct(items.map((i) => i.key))) return null;
  const repo = v.repo.toLowerCase();
  if (items.some((i) => i.url !== null && i.url.toLowerCase() !== `https://github.com/${repo}/issues/${i.number}`)) return null;
  if (v.published !== items.every((i) => i.state === 'created' && i.readBack === 'ok')) return null;
  return { repo, source: v.source, publishHash: v.publishHash, items, published: v.published };
}

/** crew's answer to a POST for exactly this run in this project, or `null`. */
export function publishResponseOf(raw: unknown, runId: string, projectId: string): ProductPublishResponse | null {
  if (!isObj(raw)) return null;
  const card = publishCardOf(raw.card, runId, projectId);
  if (card === null) return null;
  if (raw.done === false) {
    if (typeof raw.publishHash !== 'string' || !HASH.test(raw.publishHash)) return null;
    const publication = raw.publication === null ? null : publicationOf(raw.publication);
    if (raw.publication !== null && (publication === null || !sameAs(publication, card))) return null;
    return { done: false, card, publishHash: raw.publishHash, publication };
  }
  if (raw.done !== true) return null;
  const publication = publicationOf(raw.publication);
  return publication === null || !sameAs(publication, card) ? null : { done: true, card, publication };
}

/** A publication answered beside a card is that card's: the same repository and the same items, in order. */
function sameAs(p: PublicationState, card: ProductPublishCard): boolean {
  return p.repo === card.repo && p.items.length === card.items.length && p.items.every((i, k) => i.key === card.items[k]!.key);
}

/** crew's GET answer for exactly this run, or `null`. */
export function publicationsOf(raw: unknown, runId: string): ProductPublicationsResponse | null {
  if (!isObj(raw) || raw.runId !== runId || !isObj(raw.publishable)) return null;
  const p = raw.publishable;
  let publishable: ProductPublicationsResponse['publishable'];
  if (p.ok === true && typeof p.items === 'number' && Number.isInteger(p.items) && p.items > 0) publishable = { ok: true, items: p.items };
  else if (p.ok === false && isText(p.code) && isText(p.error)) publishable = { ok: false, code: p.code, error: cut(p.error) };
  else return null;
  const targets = allOf(raw.targets, (t) => (isObj(t) && typeof t.repo === 'string' && REPO.test(t.repo) && isText(t.source) ? { repo: t.repo.toLowerCase(), source: t.source } : null));
  const publications = allOf(raw.publications, publicationOf);
  // crew keeps one publication per run and repository: two for one repository is not crew's answer.
  if (targets === null || publications === null || !distinct(publications.map((p) => p.repo))) return null;
  return { runId, publishable, targets, publications };
}

// ── what studio shows ─────────────────────────────────────────────────────────────────────────────────

/** The compose launch's run name (crew `api/product.ts` `composeLaunch`): the runs studio asks about publishing. */
const COMPOSE_PROBLEM = /^Compose the product plan for project /;

/** Whether a run is a Compose run (by the name crew gives it): only these show the Publish block. Pure. */
export function looksComposed(problem: unknown): boolean {
  return typeof problem === 'string' && COMPOSE_PROBLEM.test(problem);
}

/**
 * The `repo` a POST names for one of crew's targets: `owner/repo`, or `<source>:owner/repo` when another source links
 * the same repository (crew answers `ambiguous` to a bare one then).
 */
export function repoSelector(target: { repo: string; source: string }, targets: ReadonlyArray<{ repo: string; source: string }>): string {
  return targets.filter((t) => t.repo === target.repo).length > 1 ? `${target.source}:${target.repo}` : target.repo;
}

/** A body as the card shows it: the parent's issue number is not known until it is sent, so `{{parent}}` reads as its key. */
export function bodyShown(item: Pick<PublishItem, 'body' | 'parentKey'>): string {
  return item.body.split('{{parent}}').join(item.parentKey === null ? 'its parent' : `the issue for ${item.parentKey}`);
}

/** How deep an item sits (epic 0, feature 1, story 2), for the card's indent. */
export const depthOf = (kind: PublishKind): number => (kind === 'epic' ? 0 : kind === 'feature' ? 1 : 2);

/** The named code a refusal carries, or `null`. */
export function publishRefusalCode(e: unknown): string | null {
  if (!(e instanceof ApiError) || !isObj(e.body)) return null;
  return typeof e.body['code'] === 'string' ? e.body['code'] : null;
}

/**
 * What a refused publish call says, in plain words (crew's named refusals in `api/product-publish.ts`). Where crew's own
 * sentence carries the reason (a plan it can't read, a compose it can't confirm), that sentence is shown whole after
 * the plain words.
 */
export function publishRefusal(e: unknown): string {
  if (isRouteAbsent(e)) return 'This crew can’t publish a plan yet: update crew. Nothing was sent.';
  const code = publishRefusalCode(e);
  const said = e instanceof ApiError && e.wire.trim() !== '' ? cut(e.wire.trim()) : '';
  const because = said === '' ? '' : ` (${said})`;
  switch (code) {
    case 'publish_human_only': return 'Only a person signed in to studio as an operator can publish a plan. Nothing was sent.';
    case 'project_not_found': return 'crew no longer has this project. Nothing was sent.';
    case 'run_not_found': return 'crew no longer has this job. Nothing was sent.';
    case 'repo_not_linked': return 'That repository is no longer linked to this project as a tracker. Nothing was sent.';
    case 'ambiguous': return `Two linked sources reach that repository${because}. Nothing was sent.`;
    case 'not_a_compose':
    case 'compose_unverified':
    case 'run_not_finished':
    case 'plan_unreadable': return `${said === '' ? 'This plan can’t be published.' : `${said.charAt(0).toUpperCase()}${said.slice(1)}.`} Nothing was sent.`;
    case 'card_changed': return 'The card changed since it was shown (the plan, the account, the source or the link). Nothing was sent: look at it again.';
    case 'publication_differs': return 'This plan was already published to that repository with other content, so nothing more is sent to it.';
    case 'write_tool_off': return `The GitHub source can’t create issues yet: a person turns on its issue_write tool on the source’s sheet. Nothing was sent.`;
    case 'credential_unpinned': return 'The GitHub source has no sign-in of its own, so crew can’t be sure which account would post. Give the source its own sign-in. Nothing was sent.';
    case 'unresolved': return 'An earlier publish couldn’t tell whether some issues were created. Say for each one below whether it exists, then publish again. Nothing was sent.';
    case 'journal_unreadable': return 'crew can’t read its record of this publication, so it sends nothing more. Some issues may already be on GitHub: look at the repository before anything else.';
    case 'in_progress': return 'This publication is being sent right now. Look again in a moment.';
    case 'not_unsure': return `That issue isn’t waiting for an answer any more${because}.`;
    case 'resolve_differs': return 'That issue isn’t this item: its title or body isn’t what was approved for it. Nothing was recorded.';
    case 'registry_unavailable': return 'crew couldn’t read its tracker list just now. Nothing was sent: try again.';
    case 'source_unavailable': return `The GitHub source couldn’t be read just now${because}. Nothing was sent: try again.`;
    case 'journal_unavailable': return 'crew couldn’t record this, so nothing was sent. Try again.';
    case 'bad_request': return `crew refused the request${because}. Nothing was sent.`;
    default: return e instanceof Error ? e.message : 'crew’s answer didn’t say what happened. Look at the repository before trying again.';
  }
}
