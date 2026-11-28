/**
 * Product publish (wicked-crew#372, api-types 0.229.0): a finished compose run's plan, published as GitHub issues in a
 * repository linked to the project as a tracker, or (wicked-crew#1901) as Jira issues in a Jira project linked to it. `GET /projects/:id/product/publish/:runId` says whether the run can be
 * published (and why not, before any click), which repositories it can go to, and every publication of the run read
 * back; `POST /projects/:id/product/publish` answers the card (nothing sent), creates on a confirm of the card's hash,
 * and settles one `unsure` item on a resolve.
 *
 * A NARROW mirror of the contract block in `wicked-crew-api-types` 0.229.0 (only the fields studio reads) while studio's
 * pin lags it: every answer is read defensively here, and one unreadable part makes the whole answer unreadable.
 *
 * The Jira fields (wicked-crew#1901: `system`, `site`, `issueType`, `ref`, a target's `label` and `publishable`) are
 * crew's `(api-types next)` additions, read here at runtime the same way.
 *
 * TODO(api-types >= 0.229.0): once studio pins `wicked-crew-api-types` 0.229.0 or later, these types become
 * re-exports from the package.
 */
import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

export type PublishKind = 'epic' | 'feature' | 'story';

/** (0.229.0) One issue a publication creates; `body` carries `{{parent}}` until it is sent. A Jira item names its
 *  `issueType` (wicked-crew#1901). */
export interface PublishItem { key: string; kind: PublishKind; title: string; body: string; parentKey: string | null; issueType?: string }

/** (wicked-crew#1901) Where a publication goes: a GitHub repository, or a Jira project. On the wire crew names only
 * `system: 'jira'`; no `system` is GitHub. */
export type PublishSystem = 'github' | 'jira';

/** (0.229.0) What a confirm would create, where, and as whom. A Jira card (wicked-crew#1901) names its `site`: the
 *  site's host, or its cloud id when crew has no host for it. */
export interface ProductPublishCard { runId: string; projectId: string; repo: string; source: string; identity: string; items: PublishItem[]; system?: 'jira'; site?: string }

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
  /** (wicked-crew#1901) A created Jira issue's key (`number` is then null). */
  ref?: string;
}

/** (0.229.0) One run published to one repository. */
export interface PublicationState { repo: string; source: string; publishHash: string; items: PublicationItemState[]; published: boolean; system?: 'jira' }

/** One place crew can publish the run to: `owner/repo`, or (wicked-crew#1901) a Jira project as `KEY@<cloudId>` with
 *  crew's `label` for it and whether the plan fits Jira's rules (`publishable`). */
export interface PublishTarget { repo: string; source: string; system?: 'jira'; label?: string; publishable?: ProductPublicationsResponse['publishable'] }

/** (0.229.0) `POST /projects/:id/product/publish` 200. */
export type ProductPublishResponse =
  | { done: false; card: ProductPublishCard; publishHash: string; publication: PublicationState | null }
  | { done: true; card: ProductPublishCard; publication: PublicationState };

/** (0.229.0) `GET /projects/:id/product/publish/:runId`. */
export interface ProductPublicationsResponse {
  runId: string;
  publishable: { ok: true; items: number } | { ok: false; code: string; error: string };
  targets: PublishTarget[];
  publications: PublicationState[];
}

/** (0.229.0) The POST body. */
export interface ProductPublishBody { runId: string; repo: string; confirm?: string; resolve?: { key: string; issue: number | string | null } }

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
/** (wicked-crew#1901) A Jira project as crew names it: `KEY@<cloudId>` (crew `trackers/set.ts` `parseJiraSelector`). */
const JIRA_TARGET = /^([A-Z][A-Z0-9_]{0,19})@([A-Za-z0-9-]{1,64})$/;
/** A Jira site as a card names it: a host, or a cloud id (crew `jiraSiteOf`). */
const SITE = /^[a-z0-9.-]{1,253}$/i;
/** The issue types crew puts on a card: Jira's standard names only (crew `jiraTypesOf`). */
const JIRA_TYPE = /^(?:epic|story|task|sub-task|subtask)$/i;
/** A label crew sends is shown as text, cut to this many characters. */
const LABEL_MAX = 200;
/** The longest Jira issue number studio takes (as a GitHub one). */
const JIRA_NUM = /^[1-9]\d{0,9}$/;
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

/** The system crew names on a card, a publication or a target: none is GitHub, `jira` is Jira, anything else is not crew's. */
function systemOf(v: Record<string, unknown>): PublishSystem | null {
  return v.system === undefined ? 'github' : v.system === 'jira' ? 'jira' : null;
}

/** Where a publication goes, as studio keys it: `owner/repo` lower-cased, or a Jira project's `KEY@<cloudId>` as is. */
function targetOf(system: PublishSystem, v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (system === 'jira') return JIRA_TARGET.test(v) ? v : null;
  return REPO.test(v) ? v.toLowerCase() : null;
}

/** (wicked-crew#1901) The Jira project key of a target `KEY@<cloudId>`, or `null`. Pure. */
export const projectKeyOf = (target: string): string | null => JIRA_TARGET.exec(target)?.[1] ?? null;

/** The system a card, publication or target is: crew names only Jira. Pure. */
export const publishSystemOf = (x: { system?: 'jira' }): PublishSystem => x.system ?? 'github';

function itemOf(v: unknown, system: PublishSystem): PublishItem | null {
  if (!isObj(v) || typeof v.key !== 'string' || !KEY.test(v.key) || typeof v.kind !== 'string' || !KINDS.has(v.kind) || !isText(v.title) || typeof v.body !== 'string') return null;
  if (v.parentKey !== null && (typeof v.parentKey !== 'string' || !KEY.test(v.parentKey))) return null;
  const item: PublishItem = { key: v.key, kind: v.kind as PublishKind, title: v.title, body: v.body, parentKey: v.parentKey as string | null };
  if (system === 'github') return item;
  // A Jira item names its type, from Jira's standard set: nothing else is put on a card (crew `jiraTypesOf`).
  return typeof v.issueType === 'string' && JIRA_TYPE.test(v.issueType) ? { ...item, issueType: v.issueType } : null;
}

/** crew's card for exactly this run in this project, or `null`. */
export function publishCardOf(v: unknown, runId: string, projectId: string): ProductPublishCard | null {
  if (!isObj(v) || v.runId !== runId || v.projectId !== projectId || !isText(v.source) || !isText(v.identity)) return null;
  const system = systemOf(v);
  const repo = system === null ? null : targetOf(system, v.repo);
  if (system === null || repo === null) return null;
  const items = allOf(v.items, (x) => itemOf(x, system));
  if (items === null || items.length === 0 || !distinct(items.map((i) => i.key))) return null;
  const card: ProductPublishCard = { runId, projectId, repo, source: v.source, identity: v.identity, items };
  if (system === 'github') return card;
  return typeof v.site === 'string' && SITE.test(v.site) ? { ...card, system: 'jira', site: v.site } : null;
}

function itemStateOf(v: unknown, system: PublishSystem, repo: string): PublicationItemState | null {
  if (!isObj(v) || typeof v.key !== 'string' || !KEY.test(v.key) || typeof v.kind !== 'string' || !KINDS.has(v.kind) || typeof v.title !== 'string'
    || typeof v.state !== 'string' || !STATES.has(v.state)) return null;
  const number = v.number === null ? null : typeof v.number === 'number' && Number.isSafeInteger(v.number) && v.number > 0 && v.number <= ISSUE_MAX ? v.number : undefined;
  const url = v.url === null ? null : typeof v.url === 'string' ? v.url : undefined;
  const readBack = v.readBack === null ? null : typeof v.readBack === 'string' && READ_BACK.has(v.readBack) ? (v.readBack as 'ok' | 'differs' | 'unreadable') : undefined;
  if (number === undefined || url === undefined || readBack === undefined) return null;
  if (system === 'jira') return jiraItemStateOf(v, repo, number, url, readBack);
  if (v.ref !== undefined) return null;
  // A created issue has its number and its page, and a read-back unless crew has not checked it yet (null, wicked-crew#1919);
  // anything else has none of them (crew's `stateOf`).
  if (v.state === 'created' ? number === null || url === null : number !== null || url !== null || readBack !== null) return null;
  if (v.why !== undefined && typeof v.why !== 'string') return null;
  return {
    key: v.key, kind: v.kind as PublishKind, title: v.title, state: v.state as PublicationItemStateWord, number, url, readBack,
    ...(typeof v.why === 'string' && v.why !== '' ? { why: cut(v.why) } : {}),
  };
}

/**
 * (wicked-crew#1901) One Jira item: a created one names its key, of the publication's own project, and its page is
 * exactly that issue's on its site (or none, when crew has no host for the site); anything else names neither.
 */
function jiraItemStateOf(v: Record<string, unknown>, repo: string, number: number | null, url: string | null, readBack: PublicationItemState['readBack']): PublicationItemState | null {
  const key = projectKeyOf(repo);
  if (key === null || number !== null) return null;
  if (v.state === 'created') {
    const n = typeof v.ref === 'string' && v.ref.startsWith(`${key}-`) ? v.ref.slice(key.length + 1) : '';
    if (!JIRA_NUM.test(n)) return null;
    if (url !== null && hostOf(url, v.ref as string) === null) return null;
  } else if (v.ref !== undefined || url !== null || readBack !== null) return null;
  if (v.why !== undefined && typeof v.why !== 'string') return null;
  return {
    key: v.key as string, kind: v.kind as PublishKind, title: v.title as string, state: v.state as PublicationItemStateWord, number, url, readBack,
    ...(typeof v.why === 'string' && v.why !== '' ? { why: cut(v.why) } : {}),
    ...(typeof v.ref === 'string' ? { ref: v.ref } : {}),
  };
}

/** The site host of a Jira issue's page `https://<host>/browse/<key>`, lower-cased, or `null` when it is not that. */
function hostOf(url: string, ref: string): string | null {
  const m = /^https:\/\/([a-z0-9.-]{1,253})\/browse\/([A-Z][A-Z0-9_]{0,19}-[1-9]\d{0,9})$/i.exec(url);
  return m !== null && m[2] === ref && m[1]!.includes('.') ? m[1]!.toLowerCase() : null;
}

/**
 * One publication as crew sends it, or `null`. Its parts must agree: a link is this repository's page for exactly that
 * issue on github.com (nothing else is followed), and `published` says every item was created and read back `ok`.
 */
export function publicationOf(v: unknown): PublicationState | null {
  if (!isObj(v) || !isText(v.source) || typeof v.publishHash !== 'string' || !HASH.test(v.publishHash) || typeof v.published !== 'boolean') return null;
  const system = systemOf(v);
  const repo = system === null ? null : targetOf(system, v.repo);
  if (system === null || repo === null) return null;
  const items = allOf(v.items, (x) => itemStateOf(x, system, repo));
  if (items === null || items.length === 0 || !distinct(items.map((i) => i.key))) return null;
  if (system === 'github' && items.some((i) => i.url !== null && i.url.toLowerCase() !== `https://github.com/${repo}/issues/${i.number}`)) return null;
  // (wicked-crew#1901) Every Jira page of one publication is on one site.
  if (system === 'jira' && new Set(items.flatMap((i) => (i.url !== null && i.ref !== undefined ? [hostOf(i.url, i.ref)] : []))).size > 1) return null;
  if (v.published !== items.every((i) => i.state === 'created' && i.readBack === 'ok')) return null;
  const p: PublicationState = { repo, source: v.source, publishHash: v.publishHash, items, published: v.published };
  return system === 'jira' ? { ...p, system: 'jira' } : p;
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

/**
 * A publication answered beside a card is that card's: the same system and repository, and the same items, in order. A
 * Jira issue's page is on the card's site when the card names a host.
 */
function sameAs(p: PublicationState, card: ProductPublishCard): boolean {
  if (p.system !== card.system || p.repo !== card.repo || p.items.length !== card.items.length || !p.items.every((i, k) => i.key === card.items[k]!.key)) return false;
  const host = card.site !== undefined && card.site.includes('.') ? card.site.toLowerCase() : null;
  return host === null || p.items.every((i) => i.url === null || i.ref === undefined || hostOf(i.url, i.ref) === host);
}

function publishableOf(p: unknown): ProductPublicationsResponse['publishable'] | null {
  if (!isObj(p)) return null;
  if (p.ok === true && typeof p.items === 'number' && Number.isInteger(p.items) && p.items > 0) return { ok: true, items: p.items };
  if (p.ok === false && isText(p.code) && isText(p.error)) return { ok: false, code: p.code, error: cut(p.error) };
  return null;
}

/**
 * One target as crew sends it, or `null`. A `label` or `publishable` crew sent must be readable: only a target with no
 * label is named by its selector (`targetName`).
 */
function targetEntryOf(t: unknown): PublishTarget | null {
  if (!isObj(t) || !isText(t.source)) return null;
  const system = systemOf(t);
  const repo = system === null ? null : targetOf(system, t.repo);
  if (system === null || repo === null) return null;
  const out: PublishTarget = { repo, source: t.source };
  if (system === 'jira') out.system = 'jira';
  if (t.label !== undefined) {
    if (!isText(t.label) || t.label.trim() === '') return null;
    out.label = t.label.length > LABEL_MAX ? `${t.label.slice(0, LABEL_MAX - 1)}…` : t.label;
  }
  if (t.publishable !== undefined) {
    const p = publishableOf(t.publishable);
    if (p === null) return null;
    out.publishable = p;
  }
  return out;
}

/** crew's GET answer for exactly this run, or `null`. */
export function publicationsOf(raw: unknown, runId: string): ProductPublicationsResponse | null {
  if (!isObj(raw) || raw.runId !== runId) return null;
  const publishable = publishableOf(raw.publishable);
  if (publishable === null) return null;
  const targets = allOf(raw.targets, targetEntryOf);
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

/**
 * crew's own marker at the end of each issue's footer (`<!-- wicked-publish run=… key=… -->`, crew product-publish.ts):
 * GitHub hides an HTML comment, so the card does too (studio#1419). Only that one comment, only at the end.
 */
const PUBLISH_MARKER = /\r?\n?<!-- wicked-publish run=[^\s>]+ key=[^\s>]+ -->\s*$/;

/** A body as the card shows it: the parent's issue number is not known until it is sent, so `{{parent}}` reads as its key. */
export function bodyShown(item: Pick<PublishItem, 'body' | 'parentKey'>): string {
  return item.body
    .replace(PUBLISH_MARKER, '')
    .split('{{parent}}')
    .join(item.parentKey === null ? 'its parent' : `the issue for ${item.parentKey}`);
}

/** (wicked-crew#1901) What a target is called: crew's label for it, or (only when crew sent none) its selector. Pure. */
export const targetName = (t: { repo: string; label?: string }): string => t.label ?? t.repo;

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
export function publishRefusal(e: unknown, system: PublishSystem = 'github'): string {
  if (isRouteAbsent(e)) return 'This crew can’t publish a plan yet: update crew. Nothing was sent.';
  const code = publishRefusalCode(e);
  const said = e instanceof ApiError && e.wire.trim() !== '' ? cut(e.wire.trim()) : '';
  const because = said === '' ? '' : ` (${said})`;
  if (system === 'jira') {
    const jira = jiraRefusal(code, because);
    if (jira !== null) return jira;
  }
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
    case 'in_progress': return 'A publish is being sent or settled right now. Look again in a moment.'; // this one or, for a card, any (wicked-crew#1911)
    case 'not_unsure': return `That issue isn’t waiting for an answer any more${because}.`;
    case 'resolve_differs': return 'That issue isn’t this item: its title or body isn’t what was approved for it. Nothing was recorded.';
    case 'registry_unavailable': return 'crew couldn’t read its tracker list just now. Nothing was sent: try again.';
    case 'source_unavailable': return `The GitHub source couldn’t be read just now${because}. Nothing was sent: try again.`;
    case 'journal_unavailable': return 'crew couldn’t record this, so nothing was sent. Try again.';
    case 'bad_request': return `crew refused the request${because}. Nothing was sent.`;
    default: return e instanceof Error ? e.message : 'crew’s answer didn’t say what happened. Look at the repository before trying again.';
  }
}

/** (wicked-crew#1901) The refusals whose words differ for a Jira project (its tools, its names); `null` for the rest. */
function jiraRefusal(code: string | null, because: string): string | null {
  switch (code) {
    case 'repo_not_linked': return 'That Jira project is no longer linked to this project as a tracker. Nothing was sent.';
    case 'ambiguous': return `Two linked sources reach that Jira project${because}. Nothing was sent.`;
    case 'publication_differs': return 'This plan was already published to that Jira project with other content, so nothing more is sent to it.';
    case 'write_tool_off': return 'The Jira source can’t create issues yet: a person grants its createJiraIssue tool on the source’s sheet. Nothing was sent.';
    case 'write_tool_shape': return `The Jira source’s createJiraIssue doesn’t take an argument publishing needs${because}. Save the source again from Atlassian’s server. Nothing was sent.`;
    case 'read_tool_off': return 'The Jira source has no getJiraIssue tool saved and switched on, so crew couldn’t read the issues back: save the source again. Nothing was sent.';
    case 'issue_type_missing': return `The Jira project has no issue type for one level of the plan${because}. Nothing was sent.`;
    case 'credential_unpinned': return 'The Jira source has no sign-in of its own, so crew can’t be sure which account would post. Give the source its own API token. Nothing was sent.';
    case 'journal_unreadable': return 'crew can’t read its record of this publication, so it sends nothing more. Some issues may already be in Jira: look at the Jira project before anything else.';
    case 'resolve_differs': return 'That issue isn’t this item: its summary or text isn’t what was approved for it. Nothing was recorded.';
    case 'source_unavailable': return `The Jira source couldn’t be read just now${because}. Nothing was sent: try again.`;
    default: return null;
  }
}
