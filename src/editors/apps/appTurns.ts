import { apiFetch } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import type { AppDetail, AppDetailResponse, AppSpec, SessionView } from '../../api/types.js';
import { seatLabel } from '../../board/seatNames.js';

/**
 * THE APP'S CHAT (DES-APPS-001 §6.1, §6.2, §9.2; slice K5): every message to an app is ONE `apps-turn` run on crew
 * (build by a seat → crew's check → review by a distinct seat), and the chat is crew's record of those turns
 * (`AppDetail.turns`, crew api-types 0.185.0): no thread store of studio's own, so a reload and a second tab read the
 * same thread, version, pointer and turn state.
 *
 * Pure apart from the two calls ({@link sendTurn}, {@link createByChat}): the turn records as crew answers them (read
 * defensively: crew's answer is data), the words the chat shows for each (busy text while a run works, the change line
 * when it lands, the reason when it does not), and the suggestions the composer offers.
 */

/** One turn as crew records it (crew api-types 0.185.0 `AppTurnRecord`; typed here until studio's pin carries it). */
export interface AppTurnRecord {
  runId: string;
  at: number;
  actor: string;
  message: string;
  about: string[];
  base: number;
  state: 'running' | 'landed' | 'refused' | 'failed' | 'cancelled';
  endedAt: number | null;
  version: number | null;
  change: string | null;
  summary: string | null;
  builder: string | null;
  reviewer: string | null;
  code: string | null;
  reason: string | null;
}

const STATES = new Set(['running', 'landed', 'refused', 'failed', 'cancelled']);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);

/** The words a turn whose build made no change shows (crew's own, as new turns carry them: `no_change`). */
export const NO_CHANGE_WORDS = 'The builder made no change it could hand on. Nothing landed.';

/**
 * Records crew wrote before it had words of its own for them, read in today's words (at render; the stored record
 * is never rewritten): a build the engine failed for leaving no change reads as `no_change`, and a landed turn's
 * lines drop the worker skill's bookkeeping ("Counts: …", "Memories proposed …").
 */
function plainOld(t: AppTurnRecord): AppTurnRecord {
  let r = t;
  if (r.code === 'step_failed' && /left no change in the worktree/u.test(r.reason ?? '')) r = { ...r, code: 'no_change', reason: NO_CHANGE_WORDS };
  if (r.summary !== null) {
    const lines = r.summary.split('\n').filter((l) => !/^(Counts|Memories proposed)\b/iu.test(l.trim()));
    const joined = lines.join('\n').replace(/\s*Counts: .*$/u, '').trim();
    r = { ...r, summary: joined === '' ? null : joined };
  }
  return r;
}

/** crew's turn records, oldest first; a malformed record is dropped, never shown half-read. */
export function turnsOf(detail: AppDetail | null): AppTurnRecord[] {
  const raw = (detail as unknown as { turns?: unknown } | null)?.turns;
  if (!Array.isArray(raw)) return [];
  const out: AppTurnRecord[] = [];
  for (const r of raw.slice(-50)) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const runId = str(o['runId'], 128);
    const message = str(o['message'], 8000);
    const state = o['state'];
    if (runId === null || message === null || typeof state !== 'string' || !STATES.has(state) || int(o['at']) === null) continue;
    out.push(plainOld({
      runId, message, state: state as AppTurnRecord['state'],
      at: int(o['at'])!, actor: str(o['actor'], 128) ?? '', about: Array.isArray(o['about']) ? o['about'].filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
      base: int(o['base']) ?? 0, endedAt: int(o['endedAt']), version: int(o['version']), change: str(o['change'], 300), summary: str(o['summary'], 600),
      builder: str(o['builder'], 64), reviewer: str(o['reviewer'], 64), code: str(o['code'], 64), reason: str(o['reason'], 2000),
    }));
  }
  return out;
}

/** Whether crew's daemon carries turn records at all (an older crew answers no `turns`). */
export function hasTurnLog(detail: AppDetail | null): boolean {
  return Array.isArray((detail as unknown as { turns?: unknown } | null)?.turns);
}

/** What a component id is, in words, from the spec ("chart “Breaches by region”"); `null` when it is gone. */
export function componentWords(spec: AppSpec | null, id: string): string | null {
  for (const p of spec?.pages ?? []) {
    const c = p.components.find((x) => x.id === id);
    if (c !== undefined) {
      const title = (c as { title?: unknown }).title;
      const kind = c.type === 'kpi' ? 'KPI' : c.type;
      return typeof title === 'string' && title !== '' ? `${kind} “${title.slice(0, 60)}”` : `${kind} ${id}`;
    }
  }
  return null;
}

const SEAT_WORDS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi', copilot: 'Copilot', agy: 'Antigravity', antigravity: 'Antigravity', opencode: 'OpenCode' };

/** A seat key in words ("codex" → "Codex"). */
export function seatWord(key: string): string {
  return SEAT_WORDS[key] ?? seatLabel({ key });
}

const STEP_WORDS: Record<string, string> = { build: 'Building the change', check: 'Checking it against your data sources', review: 'Reviewing it' };

/** The busy line while a turn's run works: which step, on which seat ("Building the change · Claude Code"). */
export function busyText(view: SessionView | null): { line: string; step: string | null; ord: number | null; seat: string | null } {
  if (view === null) return { line: 'Starting the turn…', step: null, ord: null, seat: null };
  const units = [...view.units].sort((a, b) => a.ord - b.ord);
  const id = view.session.id;
  const phase = (u: { id: string }): string => (u.id.startsWith(`${id}:`) ? u.id.slice(id.length + 1) : u.id);
  const live = units.find((u) => u.status === 'distributed') ?? units.find((u) => u.status === 'pending') ?? null;
  if (view.session.status === 'awaiting_human') return { line: 'Waiting on you: the run asks a question', step: live === null ? null : phase(live), ord: live?.ord ?? null, seat: null };
  if (live === null) return { line: 'Finishing up…', step: null, ord: null, seat: null };
  const step = phase(live);
  const seat = live.assigned_cli ?? null;
  const words = STEP_WORDS[step] ?? `Working on ${step}`;
  return { line: `${words}${seat !== null && seat !== '' && step !== 'check' ? ` · ${seatWord(seat)}` : ''}…`, step, ord: live.ord, seat };
}

/** The line a landed turn shows: "v4 · Added 1 chart and 1 query · reviewed by Codex". */
export function changeLine(t: AppTurnRecord): string {
  const who = t.reviewer !== null ? ` · reviewed by ${seatWord(t.reviewer)}` : '';
  return `v${t.version ?? '?'} · ${t.change ?? 'Changed the app'}${who}`;
}

/** What an ended turn that did not land says. */
export function endedLine(t: AppTurnRecord): string {
  if (t.state === 'cancelled') return 'Stopped before it landed. Nothing changed.';
  const why = (t.reason ?? '').trim();
  const lead = t.state === 'refused' ? 'Nothing landed' : 'This turn could not finish, so nothing landed';
  return why === '' ? `${lead}.` : `${lead}: ${why.replace(/^Nothing landed:\s*/u, '').replace(/\.?\s*Nothing landed\.?$/u, '')}`;
}

/**
 * Suggestions for the composer (operator 2026-11-04: "suggestions in the chat"): what this app could ask next, from its
 * own spec and the sources its project's knowledge summary lists. Plain asks a person would type; never a claim about
 * the data, and never a word the builder or a source wrote (a source is named only by its registry name).
 */
export function suggestionsFor(spec: AppSpec | null, sources: readonly string[], knowledge: string | null = null): string[] {
  const out: string[] = [];
  const comps = (spec?.pages ?? []).flatMap((p) => p.components);
  const used = new Set((spec?.queries ?? []).map((q) => q.source));
  // (DES-KNOWLEDGE-DATA-001 §9.1) An app that reads none of its project's knowledge yet is offered one knowledge
  // addition (`knowledgeAddition`, from the project's summary), early, so a person learns it can.
  if (knowledge !== null && !used.has('estate')) out.push(knowledge);
  const kpis = comps.filter((c) => c.type === 'kpi');
  const charts = comps.filter((c) => c.type === 'chart');
  const tables = comps.filter((c) => c.type === 'table');
  if (comps.length === 0) {
    const s = sources[0];
    out.push(s !== undefined && s !== 'estate' ? `Show the main numbers from ${s} as KPIs` : 'Show my main numbers as KPIs');
    out.push('Add a table of the latest rows, newest first');
  }
  // A title is the builder's text: a suggestion a person may send never quotes it (fixed words only).
  if (kpis.length > 0) out.push('Show the first KPI by day as a line chart');
  if (charts.length > 0) out.push('Add a filter by region that drives every chart');
  if (tables.length > 0 && !comps.some((c) => c.type === 'filter')) out.push('Add a search box above the table');
  const other = sources.find((s) => !used.has(s) && s !== 'estate' && s !== 'crew');
  if (other !== undefined && comps.length > 0) out.push(`Add a KPI from ${other} beside these`);
  if ((spec?.pages.length ?? 0) === 1 && comps.length >= 4) out.push('Make it two pages: an overview and a detail page');
  if (charts.length === 0 && comps.length > 0) out.push('Add a bar chart that breaks this down by category');
  return [...new Set(out)].slice(0, 3);
}

export type SendResult = { ok: true; runId: string } | { ok: false; code: string; message: string };

function refusal(e: unknown): { ok: false; code: string; message: string } {
  if (e instanceof ApiError) {
    const b = (typeof e.body === 'object' && e.body !== null ? e.body : {}) as { code?: unknown; error?: unknown };
    return { ok: false, code: typeof b.code === 'string' ? b.code : String(e.status), message: typeof b.error === 'string' && b.error !== '' ? b.error : e.message };
  }
  return { ok: false, code: 'unavailable', message: e instanceof Error ? e.message : String(e) };
}

/** `POST /apps/:app/turns`: one message becomes one turn on `base` (crew refuses a stale base, or a turn in flight). */
export async function sendTurn(slug: string, base: number, message: string, about: readonly string[]): Promise<SendResult> {
  try {
    const r = await apiFetch<{ runId: string }>(`/apps/${encodeURIComponent(slug)}/turns`, { method: 'POST', body: JSON.stringify({ base, message, about: about.slice(0, 20) }) });
    return { ok: true, runId: r.runId };
  } catch (e) {
    return refusal(e);
  }
}

const FILLER = new Set(['a', 'an', 'the', 'of', 'for', 'from', 'with', 'by', 'and', 'to', 'in', 'on', 'my', 'me', 'our', 'show', 'make', 'build', 'create', 'give', 'i', 'want', 'need', 'please', 'that', 'this', 'app', 'dashboard', 'page', 'view', 'new', 'some', 'all', 'is', 'are', 'it']);

/** A readable slug from the message ("a dashboard of escalations by region from support-pg" → "escalations-region-support"). */
export function slugFrom(message: string): string {
  const words = message.toLowerCase().replace(/[^a-z0-9\s-]/gu, ' ').split(/[\s-]+/u).filter((w) => w !== '' && !FILLER.has(w) && /^[a-z]/u.test(w));
  const picked: string[] = [];
  for (const w of words) {
    if (picked.length >= 3) break;
    picked.push(w.slice(0, 14));
  }
  const s = picked.join('-');
  return s === '' ? 'new-app' : s;
}

/** A first name for the app until its builder names it ("Escalations region support"): crew takes the spec's name when a turn lands. */
export function nameFrom(slug: string): string {
  const t = slug.replace(/-/gu, ' ');
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
}

/**
 * "Make a new app" by chat: crew adds the app (an empty first version, `you`), then the message is its first turn. A
 * taken slug takes crew's suggestion once.
 */
export async function createByChat(message: string, projectId: string): Promise<{ ok: true; slug: string; runId: string } | { ok: false; code: string; message: string; slug?: string }> {
  let slug = slugFrom(message);
  let created: AppDetail | null = null;
  for (let attempt = 0; attempt < 2 && created === null; attempt += 1) {
    try {
      created = (await apiFetch<AppDetailResponse>('/apps', { method: 'POST', body: JSON.stringify({ slug, name: nameFrom(slug), projectId }) })).app;
    } catch (e) {
      const b = e instanceof ApiError && typeof e.body === 'object' && e.body !== null ? e.body as { code?: unknown; suggestion?: unknown } : {};
      if (attempt === 0 && (b.code === 'slug_taken' || b.code === 'reserved_slug') && typeof b.suggestion === 'string') { slug = b.suggestion; continue; }
      return refusal(e);
    }
  }
  if (created === null) return { ok: false, code: 'slug_taken', message: 'no free address was found for the new app' };
  const sent = await sendTurn(created.slug, created.head.version, message, []);
  return sent.ok ? { ok: true, slug: created.slug, runId: sent.runId } : { ...sent, slug: created.slug };
}
