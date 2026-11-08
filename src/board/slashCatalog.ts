import type {
  CatalogAliasV2, CatalogCardV2, CatalogInputKindV2, CatalogOptionV2, CatalogResolved, ShapeGuess, WorkflowCatalogV2Response,
} from 'wicked-crew-api-types';
import { rankCards } from './commandSearch.js';
import { entryOffered, topEntries, type CatalogEntry, type CatalogView } from './workflowCatalog.js';

/**
 * The `/` menu's "Start work" rows off New job's catalog view (slash-catalog; the rules are in
 * ./workflowCommand.ts's header). Pure.
 */

/** One "Start work" row: a catalog entry, under the group New job lists it in. */
export interface CatalogRow {
  entry: CatalogEntry;
  /** `top` ("Your top"), a category id, or `all` (an older daemon's one list). */
  group: string;
  groupTitle: string;
  /** What the row's `data-cmd` says: `workflow-<id>` for a workflow (the command typed by hand), else the card id. */
  cmd: string;
  /** A pick starts it: ready, with a launch studio knows (else it is shown as coming soon or not available). */
  offered: boolean;
}

/** New job's "Your top" header. */
export const TOP_GROUP = { id: 'top', title: 'Your top' } as const;
/** A `/workflow-<key>` typed whole: the workflow it names, ahead of the groups. */
export const MATCH_GROUP = { id: 'match', title: 'Best match' } as const;
/** An older daemon's one uncategorised list (New job's "All workflows"). */
export const ALL_GROUP = { id: 'all', title: 'All workflows' } as const;
const WORKFLOW_PREFIX = 'workflow-';

/** Whether an entry answers what is typed after `/` (one word: the menu's token stops at a space). A
 *  `workflow-…` query names a workflow by its id, the command typed by hand; any other matches a word of
 *  the title, or the card's or workflow's id, by prefix. */
export function entryMatches(e: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const run = e.launchKind === 'run';
  if (q.startsWith(WORKFLOW_PREFIX)) return run && e.launchId.toLowerCase().startsWith(q.slice(WORKFLOW_PREFIX.length));
  if (run && WORKFLOW_PREFIX.startsWith(q)) return true;
  const words = e.title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return words.some((w) => w !== '' && w.startsWith(q)) || e.title.toLowerCase().startsWith(q)
    || e.id.toLowerCase().startsWith(q) || (run && e.launchId.toLowerCase().startsWith(q));
}

/**
 * The "Start work" rows for a query, in New job's order: "Your top" (what this operator starts most,
 * recency-weighted), then each category in the catalog's order with its entries in catalog order (an
 * older daemon: one list). An entry is listed once: one in "Your top" is not repeated under its
 * category. `only` keeps the entries a box can start (the launch form names a workflow).
 */
export function catalogRows(view: CatalogView | null, query: string, now: number, only?: (e: CatalogEntry) => boolean): CatalogRow[] {
  if (view === null) return [];
  // New job's order over the WHOLE catalog, then `only` (codex r1: a box that lists fewer kinds keeps
  // New job's "Your top", never promotes its own).
  const pool = view.entries;
  const row = (e: CatalogEntry, group: string, groupTitle: string): CatalogRow => ({
    entry: e, group, groupTitle, cmd: e.launchKind === 'run' ? `${WORKFLOW_PREFIX}${e.launchId}` : e.id,
    offered: entryOffered(e),
  });
  const rows: CatalogRow[] = [];
  const listed = new Set<string>();
  const add = (e: CatalogEntry, group: string, title: string): void => {
    if (listed.has(e.id)) return;
    listed.add(e.id);
    rows.push(row(e, group, title));
  };
  for (const e of topEntries(pool, now)) add(e, TOP_GROUP.id, TOP_GROUP.title);
  if (view.source === 'fallback') for (const e of pool) add(e, ALL_GROUP.id, ALL_GROUP.title);
  else for (const c of view.categories) for (const e of pool) if (e.category === c.id) add(e, c.id, c.title);
  const out = rows.filter((r) => (only === undefined || only(r.entry)) && entryMatches(r.entry, query));
  // `/workflow-<key>` typed whole names that workflow: it leads, so Enter starts it and not a longer id
  // that shares its start (codex r1).
  const q = query.trim().toLowerCase();
  const exact = q.startsWith(WORKFLOW_PREFIX) ? q.slice(WORKFLOW_PREFIX.length) : null;
  const at = exact === null ? -1 : out.findIndex((r) => r.entry.launchKind === 'run' && r.entry.launchId.toLowerCase() === exact);
  // Under its own header, so its category is not split in two (pi r2).
  if (at > 0) out.unshift({ ...out.splice(at, 1)[0]!, group: MATCH_GROUP.id, groupTitle: MATCH_GROUP.title });
  return out;
}

/** The catalog's workflow entries (the launch form names a workflow; it starts nothing else). */
export function workflowsOnly(e: CatalogEntry): boolean {
  return e.launchKind === 'run';
}

/** The workflow entry `/workflow-<key>` names (an offered one first), or null: back-compat for the
 *  command typed by hand. Only a workflow the catalog lists is named — studio never invents one. */
export function workflowEntry(view: CatalogView | null, key: string): CatalogEntry | null {
  if (view === null) return null;
  const all = view.entries.filter((e) => e.launchKind === 'run' && e.launchId === key);
  return all.find((e) => e.status === 'ready') ?? all[0] ?? null;
}

/** What the composer says when a row cannot start. */
export function notOfferedLine(e: Pick<CatalogEntry, 'title' | 'status' | 'statusNote'>): string {
  const why = e.statusNote !== null && !/^(coming soon|not available)\.?$/i.test(e.statusNote) ? ` ${e.statusNote}` : '';
  return `${e.title} is ${e.status === 'soon' ? 'coming soon' : 'not available now'}.${why}`;
}

// ── The v2 command list (DES-CATALOG-002 §4.6, §8.4; Lane E2) ─────────────────────────────────────────────────────────
//
// On a daemon that advertises `chatJobProposals` and `workflowCatalogV2`, the `/` list is the v2 catalog by verb: each
// card's command with its title and one line, its variants as indented sub-commands, and Yours (saved steps, which
// start by their workflow). Every command, alias and option word comes from the wire: studio hard-codes none. A card or
// option is shown only when it can start here (coming-soon ruling, studio#1030: an entry is available or hidden), so
// coming, unavailable, hidden and unknown-input cards are left out. A pick puts the card on the composer; nothing is
// sent until Enter, which posts the person-made proposal (never a launch).

/** The input kinds this studio collects for a job. A card that takes any other kind is hidden here (the wire's rule:
 *  a kind a client does not know is never started). THE one list a newer input (CS12: `documents`, `sources`) extends. */
export const KNOWN_INPUT_KINDS: ReadonlySet<CatalogInputKindV2> = new Set<CatalogInputKindV2>(['text', 'repo', 'project', 'url', 'requirements', 'seats', 'documents', 'sources']);

export type JobDepth = 'quick' | 'standard' | 'deep';
/** An Investigate card's depth words (the wire's own `LaunchShape.depth` values), typed after its command. */
export const DEPTH_WORDS: readonly JobDepth[] = ['quick', 'standard', 'deep'];

/** One row of the v2 `/` list. */
export interface CommandRow {
  /** Stable across refreshes: `c:<card>`, `o:<card>:<option>`, `a:<alias>`, `l:<card>:<option>` (Looks like). */
  key: string;
  /** `card` / `option` (an indented sub-command), `alias` (an old `/workflow-…` bound to its option), `looks` (crew's
   *  words layer read the line), `yours` (no command: starts by its workflow). */
  kind: 'card' | 'option' | 'alias' | 'looks' | 'yours';
  group: string;
  groupTitle: string;
  /** The command the row stands for (`/migrate upgrade`), as the wire spells it; null for Yours. */
  command: string | null;
  title: string;
  line: string;
  card: string;
  option: string | null;
  depth: JobDepth | null;
  /** The workflow a Yours row starts (ux-tonight's inline start), else the card's launch id (for the chip). */
  launchId: string;
}

/** A command typed whole: the card it names, its option (an alias's binding, or the option word), depth and words. */
export interface CommandHit {
  card: CatalogCardV2;
  option: string | null;
  depth: JobDepth | null;
  words: string;
  /** What `card` says on the wire: the alias itself for an alias (crew resolves it, and only an alias reaches a hidden
   *  card), else the card id. */
  wireCard: string;
  /** Why it cannot start here (not available, a newer studio needed), or null. Nothing is sent when set. */
  refused: string | null;
}

const lower = (s: string): string => s.toLowerCase();

/** Whether this studio can collect everything a card or option takes. */
export function inputsKnown(r: Pick<CatalogResolved, 'inputs'>): boolean {
  return r.inputs.every((i) => KNOWN_INPUT_KINDS.has(i.kind));
}

/** A card the list shows: not hidden, available, with a command, every input known. */
export function cardListed(c: CatalogCardV2): boolean {
  return !c.hidden && c.category !== 'yours' && c.command !== null && c.status === 'available' && inputsKnown(c);
}

/** An option the list shows. */
export function optionListed(o: CatalogOptionV2): boolean {
  return o.command !== null && o.status === 'available' && inputsKnown(o);
}

/** Whether a card's sub-commands may show: a card a person can reach by command (not hidden, not coming, not Yours).
 *  A card's own status is its DEFAULT option's (crew `build-v2.ts`), so an unavailable default never hides an
 *  available sibling (codex r2): the card row is left out, its listed options stay. */
function optionsReachable(c: CatalogCardV2): boolean {
  return !c.hidden && c.category !== 'yours' && c.command !== null && c.status !== 'coming_soon';
}

const launchIdOf = (r: Pick<CatalogResolved, 'launch'>): string => (r.launch.kind === 'run' ? r.launch.workflow : r.launch.kind);

/** Why a card (or its option) cannot start here, or null. Plain words, never "coming". */
export function refusalOf(card: CatalogCardV2, option: CatalogOptionV2 | null): string | null {
  // What starts is the option's resolution (or the card's, its default option's): judged on that alone.
  const r: CatalogResolved = option ?? card;
  const name = option !== null ? `${card.title} · ${option.title}` : card.title;
  if (r.status !== 'available' || card.status === 'coming_soon') {
    return `${name} isn’t available on this daemon.${r.status === 'unavailable' && r.statusNote !== null ? ` ${r.statusNote}` : ''} Nothing was sent.`;
  }
  if (!inputsKnown(r)) return `${name} needs a newer studio. Nothing was sent.`;
  return null;
}

function cardRow(c: CatalogCardV2, group: string, groupTitle: string): CommandRow {
  return { key: `c:${c.id}`, kind: 'card', group, groupTitle, command: c.command, title: c.title, line: c.summary, card: c.id, option: null, depth: null, launchId: launchIdOf(c) };
}

function optionRow(c: CatalogCardV2, o: CatalogOptionV2, group: string, groupTitle: string): CommandRow {
  return { key: `o:${c.id}:${o.id}`, kind: 'option', group, groupTitle, command: o.command, title: `${c.title} · ${o.title}`, line: o.summary, card: c.id, option: o.id, depth: null, launchId: launchIdOf(o) };
}

function yoursRow(c: CatalogCardV2, groupTitle: string): CommandRow {
  return { key: `c:${c.id}`, kind: 'yours', group: 'yours', groupTitle, command: null, title: c.title, line: c.summary, card: c.id, option: null, depth: null, launchId: launchIdOf(c) };
}

/** A card's rows: the card (when it can start), then its listed options indented under it. */
function rowsOfCard(c: CatalogCardV2, group: string, groupTitle: string): CommandRow[] {
  const opts = optionsReachable(c) ? (c.variant?.options ?? []).filter(optionListed).map((o) => optionRow(c, o, group, groupTitle)) : [];
  return [...(cardListed(c) ? [cardRow(c, group, groupTitle)] : []), ...opts];
}

/** A card with anything to list: itself, or an available sub-command. */
function cardShown(c: CatalogCardV2): boolean {
  return cardListed(c) || (optionsReachable(c) && (c.variant?.options ?? []).some(optionListed));
}

/** Yours: saved steps and workflows no card offers, which start by their workflow (the wire's rule). */
function yoursRows(view: WorkflowCatalogV2Response): CommandRow[] {
  const title = view.categories.find((k) => k.id === 'yours')?.title ?? 'Yours';
  return view.cards.filter((c) => c.category === 'yours' && c.status === 'available' && c.launch.kind === 'run').map((c) => yoursRow(c, title));
}

/** Every listed row in the catalog's order: each verb's cards with their sub-commands, then Yours. */
export function allCommandRows(view: WorkflowCatalogV2Response): CommandRow[] {
  const out: CommandRow[] = [];
  for (const k of view.categories) {
    if (k.id === 'yours') continue;
    for (const c of view.cards) if (c.category === k.id && cardShown(c)) out.push(...rowsOfCard(c, k.id, k.title));
  }
  return [...out, ...yoursRows(view)];
}

/** The card a command head names (`/migrate`), listed or not (hidden cards have no command). */
function cardByCommand(view: WorkflowCatalogV2Response, head: string): CatalogCardV2 | undefined {
  return view.cards.find((c) => c.command !== null && lower(c.command) === head);
}

/** The card and option an alias (`/workflow-migration`) is bound to. */
function aliasOf(view: WorkflowCatalogV2Response, head: string): { card: CatalogCardV2; alias: CatalogAliasV2 } | undefined {
  for (const card of view.cards) for (const alias of card.aliases) if (lower(alias.command) === head) return { card, alias };
  return undefined;
}

/** The option word of an option command (`/migrate upgrade` → `upgrade`): the wire's `optionWord`, else the command's
 *  second word. */
function optionWordOf(o: CatalogOptionV2): string | null {
  if (o.optionWord !== null) return lower(o.optionWord);
  const w = o.command?.trim().split(/\s+/u)[1];
  return w === undefined ? null : lower(w);
}

/**
 * Parse a line typed into the composer as a command (`/<card> [<option word>|<depth>] [words…]`, or an alias with
 * words), against the wire. null when the line names no card or alias: it is then ordinary words.
 */
export function parseCommandLine(view: WorkflowCatalogV2Response | null, text: string): CommandHit | null {
  if (view === null) return null;
  const t = text.trim();
  if (!t.startsWith('/')) return null;
  const [rawHead, ...rest] = t.split(/\s+/u);
  const head = lower(rawHead!);
  const viaAlias = aliasOf(view, head);
  if (viaAlias !== undefined) {
    const { card, alias } = viaAlias;
    const option = alias.option === null ? null : card.variant?.options.find((o) => o.id === alias.option) ?? null;
    return { card, option: alias.option, depth: null, words: rest.join(' '), wireCard: alias.command, refused: refusalOf(card, option) };
  }
  const card = cardByCommand(view, head);
  if (card === undefined || card.hidden) return null;
  const next = rest[0] === undefined ? undefined : lower(rest[0]);
  const opt = next === undefined ? undefined : card.variant?.options.find((o) => optionWordOf(o) === next);
  if (opt !== undefined) return { card, option: opt.id, depth: null, words: rest.slice(1).join(' '), wireCard: card.id, refused: refusalOf(card, opt) };
  const depth = card.depth && next !== undefined ? DEPTH_WORDS.find((d) => d === next) ?? null : null;
  return { card, option: null, depth, words: (depth !== null ? rest.slice(1) : rest).join(' '), wireCard: card.id, refused: refusalOf(card, null) };
}

/** What the `/` list shows for a line at the box's start. `closed`: a command was typed whole and words follow (Enter
 *  posts it); `rows`: the list, filtered. `freeWords`: the line is words, not a command (a pick keeps them as the job's
 *  words, and crew's words layer may lead with Looks like). */
export type CommandListState =
  | { open: false }
  | { open: true; rows: CommandRow[]; freeWords: string | null; query: string };

/**
 * The `/` list for a line that starts the box (`/…`). Pure; `looks` is crew's reading of free words (the Looks like
 * row), shown first when it names a listed card or option.
 *
 *  - `/` alone: every listed row.
 *  - `/mig`: the rows whose command starts so (an alias typed as `/workflow-…` lists its bound card or option).
 *  - `/migrate up`: that card's sub-commands whose option word starts so; `/migrate upgrade ` (a space after a whole
 *    command and option word) closes the list: what follows is the job's words, and Enter posts it.
 *  - free words (`/upgrade node to 22`): the cards the one scorer ranks, best first, each with its sub-commands.
 */
export function commandList(view: WorkflowCatalogV2Response, text: string, looks: ShapeGuess | null = null): CommandListState {
  const st = commandListRows(view, text, looks);
  if (!st.open) return st;
  // A full command typed exactly (`/plugin phase`, however it is spaced) wins the highlight: the row the parser reads it
  // as leads, so Enter picks what was typed and never the card it belongs to (e2e-1105 CJ9).
  const exact = exactRow(view, text);
  if (exact === null) return st;
  const at = st.rows.findIndex((r) => r.key === exact.key);
  if (at === 0) return st;
  const rows = [...st.rows];
  const lead = at > 0 ? rows.splice(at, 1)[0]! : { ...exact, group: rows[0]?.group ?? exact.group, groupTitle: rows[0]?.groupTitle ?? exact.groupTitle };
  rows.unshift(lead);
  return { ...st, rows };
}

/**
 * The listed card or option row a line names exactly: the line, with the slash and spacing normalized (`/ plugin  phase`
 * reads as `/plugin phase`), parsed as the parser reads a command (the wire's option word), naming a card or option
 * that can start here, with no depth and no words after it. null otherwise (an alias, words, a refused command).
 */
export function exactRow(view: WorkflowCatalogV2Response, text: string): CommandRow | null {
  const words = lower(text).replace(/^\s*\/\s*/u, '').trim();
  if (!text.trimStart().startsWith('/') || words === '') return null;
  const hit = parseCommandLine(view, `/${words.split(/\s+/u).join(' ')}`);
  if (hit === null || hit.refused !== null || hit.words !== '' || hit.depth !== null || hit.wireCard !== hit.card.id) return null;
  return allCommandRows(view).find((r) => (r.kind === 'card' || r.kind === 'option') && r.card === hit.card.id && r.option === hit.option) ?? null;
}

function commandListRows(view: WorkflowCatalogV2Response, text: string, looks: ShapeGuess | null): CommandListState {
  const query = text.startsWith('/') ? text.slice(1) : text;
  const all = allCommandRows(view);
  if (query.trim() === '') return { open: true, rows: all, freeWords: null, query };
  const parts = query.split(/\s+/u);
  const head = `/${lower(parts[0]!)}`;
  const whole = cardByCommand(view, head);
  const aliased = aliasOf(view, head);
  const typedOn = parts.length > 1;
  if ((whole !== undefined && !whole.hidden) || aliased !== undefined) {
    if (!typedOn) {
      const rows = all.filter((r) => r.command !== null && lower(r.command).startsWith(head));
      return { open: true, rows: rows.length > 0 ? rows : aliasRows(view, head, all), freeWords: null, query };
    }
    // A whole command, then more: an option word being typed lists that card's sub-commands; anything else is words.
    if (whole !== undefined && parts.length === 2 && parts[1] !== '' && aliased === undefined) {
      const w = lower(parts[1]!);
      // By the option word the parser reads (the wire's `optionWord`), so the list and the parser agree (pi r1).
      const wordOf = (r: CommandRow): string | null => {
        const o = whole.variant?.options.find((x) => x.id === r.option);
        return o === undefined ? null : optionWordOf(o);
      };
      const subs = all.filter((r) => r.kind === 'option' && r.card === whole.id && wordOf(r)?.startsWith(w) === true);
      if (subs.length > 0) return { open: true, rows: subs, freeWords: null, query };
    }
    return { open: false };
  }
  if (!typedOn) {
    const byCommand = all.filter((r) => r.command !== null && lower(r.command).startsWith(head));
    const byAlias = aliasRows(view, head, all);
    if (byCommand.length > 0 || byAlias.length > 0) return { open: true, rows: [...byCommand, ...byAlias.filter((a) => !byCommand.some((r) => r.key === a.key))], freeWords: null, query };
  }
  // Free words: the one scorer ranks the listed cards (and Yours), each followed by its sub-commands.
  const titleOf = new Map(view.categories.map((k) => [k.id as string, k.title]));
  const listed = view.cards.filter((c) => cardShown(c) || (c.category === 'yours' && c.status === 'available' && c.launch.kind === 'run'));
  const ranked = rankCards(listed, query, (id) => titleOf.get(id) ?? '');
  const rows: CommandRow[] = [];
  for (const { card } of ranked) {
    if (card.category === 'yours') rows.push({ ...yoursRow(card, MATCHES_GROUP.title), group: MATCHES_GROUP.id });
    else rows.push(...rowsOfCard(card, MATCHES_GROUP.id, MATCHES_GROUP.title));
  }
  const lead = looksRow(view, looks);
  return { open: true, rows: lead === null ? rows : [lead, ...rows], freeWords: query.trim(), query };
}

/** The group the scorer's matches are listed under (their verbs would split a ranked list). */
export const MATCHES_GROUP = { id: 'matches', title: 'Matches' } as const;
/** crew's words layer's reading of the line. */
export const LOOKS_GROUP = { id: 'looks', title: 'Looks like' } as const;

/** Alias rows for a typed `/workflow-…` prefix: each bound to its listed card or option (a hidden card's alias is not
 *  listed: it is reached only by typing it whole). */
function aliasRows(view: WorkflowCatalogV2Response, head: string, all: readonly CommandRow[]): CommandRow[] {
  const out: CommandRow[] = [];
  for (const c of view.cards) {
    if (!cardShown(c)) continue;
    for (const a of c.aliases) {
      if (!lower(a.command).startsWith(head)) continue;
      const target = all.find((r) => r.card === c.id && r.option === a.option && (r.kind === 'card' || r.kind === 'option'));
      if (target === undefined) continue;
      out.push({ ...target, key: `a:${a.command}`, kind: 'alias', command: a.command, line: `${target.command ?? ''} · ${target.line}` });
    }
  }
  return out;
}

/** crew's reading of free words as a row, when it names a card (and option) the list shows. */
export function looksRow(view: WorkflowCatalogV2Response, g: ShapeGuess | null): CommandRow | null {
  if (g === null || !g.available || g.band === 'ask' || g.card === '') return null;
  const c = view.cards.find((x) => x.id === g.card);
  if (c === undefined) return null;
  const o = g.option === null ? null : c.variant?.options.find((x) => x.id === g.option) ?? null;
  if (g.option === null ? !cardListed(c) : (o === null || !optionsReachable(c) || !optionListed(o))) return null;
  const base = o === null ? cardRow(c, LOOKS_GROUP.id, LOOKS_GROUP.title) : optionRow(c, o, LOOKS_GROUP.id, LOOKS_GROUP.title);
  return { ...base, key: `l:${c.id}:${o?.id ?? ''}`, kind: 'looks', depth: c.depth ? g.depth : null, line: g.reason !== '' ? g.reason : base.line };
}

/**
 * The card a named opener means (`startInChat`: Settings' "Create an editor plugin", Learn, New demo video, Draft
 * epics…), read off the wire: the old command `/workflow-<id>` first (its alias binding), then the one card or option
 * whose launch runs that workflow; studio's own job kinds by their launch (`demo-video`: the card that launches a demo;
 * `draft-epics`: the option that composes epics). null = no card: the caller keeps today's flow.
 */
export function cardForWorkflow(view: WorkflowCatalogV2Response, workflowId: string): { wireCard: string; card: CatalogCardV2; option: string | null } | null {
  const alias = aliasOf(view, lower(`/workflow-${workflowId}`));
  if (alias !== undefined) return { wireCard: alias.alias.command, card: alias.card, option: alias.alias.option };
  const hits: Array<{ card: CatalogCardV2; option: string | null }> = [];
  for (const c of view.cards) {
    if (c.hidden || c.category === 'yours') continue;
    const opts = c.variant?.options ?? [];
    const match = (r: CatalogResolved): boolean => (workflowId === 'demo-video' ? r.launch.kind === 'demo'
      : workflowId === 'draft-epics' ? r.launch.kind === 'compose' && r.compose?.level === 'epics'
        : r.launch.kind === 'run' && r.launch.workflow === workflowId);
    const o = opts.filter(match);
    if (o.length === 1) hits.push({ card: c, option: o[0]!.id });
    else if (o.length === 0 && opts.length === 0 && match(c)) hits.push({ card: c, option: null });
  }
  if (hits.length !== 1) return null;
  return { wireCard: hits[0]!.card.id, card: hits[0]!.card, option: hits[0]!.option };
}

/** Whether the job a card (or its alias) and option start takes a repository (its option's inputs, else the default
 *  option's, else the card's). False when the wire names no such card. */
export function takesRepo(view: WorkflowCatalogV2Response | null, wireCard: string, option: string | null): boolean {
  if (view === null) return false;
  const viaAlias = aliasOf(view, lower(wireCard));
  const card = view.cards.find((c) => c.id === wireCard) ?? viaAlias?.card;
  if (card === undefined) return false;
  const optId = option ?? viaAlias?.alias.option ?? card.variant?.default ?? null;
  const opt = optId === null ? null : card.variant?.options.find((o) => o.id === optId) ?? null;
  return (opt ?? card).inputs.some((i) => i.kind === 'repo');
}
