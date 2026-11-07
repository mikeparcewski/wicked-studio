/**
 * THE `/` LIST'S ONE SCORER (DES-CATALOG-002 §8.6 "One scorer"). Studio's search scorer stays only to filter the `/`
 * command list. It is crew's words layer (`workflow-catalog/detect.ts`: `stem`, `tokens`, the lexicon, the field
 * weights and `scoreFields`), read over the v2 wire's own fields, and it is pinned to crew by a shared golden fixture
 * (`tests/fixtures/words-golden.json`, made from crew's `wordsLayer`): the same words give the same cards in the same
 * order with the same scores. Change it only together with crew's, and regenerate the fixture.
 *
 * It ranks; it never decides. Deciding what the words ask for is crew's (`POST /workflows/catalog/detect`). Pure.
 */

/** The fields a card is searched by: what the v2 wire's `CatalogCardV2` carries. */
export interface SearchCard {
  id: string;
  category: string;
  title: string;
  words: readonly string[];
  outcome: string;
  needs: readonly string[];
  variant: { options: ReadonlyArray<{ id: string; title: string; words: readonly string[] }> } | null;
}

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'about',
  'my', 'our', 'your', 'me', 'we', 'i', 'it', 'its', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were',
  'be', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'please', 'want', 'need', 'some', 'new', 'x',
]);

/** Words people type for what a job does, said as the words the catalog uses (crew's lexicon, as is). */
const LEXICON: Readonly<Record<string, readonly string[]>> = {
  doc: ['documentation', 'docs', 'document'],
  document: ['documentation', 'docs'],
  documentation: ['docs', 'document'],
  readme: ['documentation', 'docs'],
  guide: ['documentation', 'walkthrough'],
  write: ['author', 'documentation'],
  explain: ['documentation', 'walkthrough', 'learn'],
  learn: ['walkthrough', 'research'],
  slide: ['presentation', 'deck'],
  deck: ['presentation', 'slide'],
  pitch: ['presentation'],
  video: ['demo', 'recording'],
  record: ['demo', 'video'],
  screencast: ['demo', 'video'],
  bug: ['issue', 'fix'],
  issue: ['bug', 'fix'],
  fix: ['issue', 'bug', 'resolve'],
  broken: ['issue', 'bug', 'fail'],
  break: ['issue', 'bug', 'fail'],
  crash: ['issue', 'bug', 'fail'],
  error: ['issue', 'bug', 'fail'],
  fail: ['failure', 'review', 'issue'],
  failure: ['fail', 'review'],
  why: ['review', 'analyze'],
  went: ['review'],
  happen: ['review'],
  run: ['runs', 'review'],
  job: ['runs', 'review'],
  upgrade: ['migrate', 'migration'],
  migrate: ['migration', 'upgrade', 'port'],
  port: ['migrate', 'migration'],
  move: ['migrate', 'migration'],
  test: ['tests', 'testing', 'qe'],
  coverage: ['test', 'tests', 'analysis'],
  plan: ['planning'],
  automate: ['automation'],
  domain: ['extraction', 'model'],
  business: ['domain'],
  plugin: ['plugins', 'extension'],
  extension: ['plugin'],
  editor: ['plugin'],
  tool: ['mcp', 'tools'],
  mcp: ['tool', 'server'],
  build: ['feature', 'create'],
  add: ['feature'],
  feature: ['build'],
  app: ['vibe', 'builder', 'dashboard'],
  dashboard: ['vibe', 'app'],
  validate: ['validation', 'check', 'verify'],
  check: ['validate', 'review'],
  verify: ['validate'],
  review: ['analyze', 'check'],
};

/** The lexicon's words (the golden fixture has a case for each, so a drift in either copy is caught). */
export const LEXICON_KEYS: readonly string[] = Object.keys(LEXICON);

/** Plain English stemming (crew's `stem`). */
export function stem(w: string): string {
  let s = w.toLowerCase();
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 3 && s.endsWith('es') && /(ss|sh|ch|x)es$/u.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

/** The content words of a text: lower case, split on anything not a letter or digit, stop words out, stemmed. */
export function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t !== '' && !STOP.has(t)).map(stem).filter((t) => t !== '' && !STOP.has(t));
}

const FIELD_WEIGHT = { title: 6, words: 4, gets: 2, other: 1 } as const;
const EXPANSION_FACTOR = 0.5;

interface Field {
  t: ReadonlySet<string>;
  w: number;
}

const own = <T>(rec: Readonly<Record<string, T>>, k: string): T | undefined => (Object.hasOwn(rec, k) ? rec[k] : undefined);

function scoreFields(fields: readonly Field[], query: string): number {
  const qs = tokens(query);
  if (qs.length === 0) return 0;
  let score = 0;
  let matched = 0;
  for (const q of qs) {
    let direct = 0;
    for (const f of fields) if (f.t.has(q)) direct = Math.max(direct, f.w);
    let expanded = 0;
    for (const x of own(LEXICON, q) ?? []) {
      const sx = stem(x);
      for (const f of fields) if (f.t.has(sx)) expanded = Math.max(expanded, f.w * EXPANSION_FACTOR);
    }
    const best = Math.max(direct, expanded);
    if (best > 0) matched += 1;
    score += best;
  }
  return score * (0.5 + (0.5 * matched) / qs.length);
}

function cardFields(c: SearchCard, categoryTitle: string): Field[] {
  const optWords = (c.variant?.options ?? []).flatMap((o) => [...o.words, o.title]);
  return [
    { t: new Set([...tokens(c.title), ...tokens(c.id)]), w: FIELD_WEIGHT.title },
    { t: new Set([...c.words, ...optWords].flatMap(tokens)), w: FIELD_WEIGHT.words },
    { t: new Set(tokens(c.outcome)), w: FIELD_WEIGHT.gets },
    { t: new Set([...tokens(categoryTitle), ...c.needs.flatMap(tokens)]), w: FIELD_WEIGHT.other },
  ];
}

/** How well `query` matches one card (0 = not at all), as crew's words layer scores it. */
export function scoreCard(c: SearchCard, query: string, categoryTitle: string): number {
  return scoreFields(cardFields(c, categoryTitle), query);
}

/** The cards that match `query`, best first (ties keep the cards' order), with their scores. */
export function rankCards<C extends SearchCard>(cards: readonly C[], query: string, categoryTitle: (id: string) => string): Array<{ card: C; score: number }> {
  return cards
    .map((card, i) => ({ card, i, score: scoreCard(card, query, categoryTitle(card.category)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ card, score }) => ({ card, score }));
}

/** How many content words the text has (the words layer reads 4 or more before it may be sure). */
export function contentWords(text: string): number {
  return tokens(text).length;
}
