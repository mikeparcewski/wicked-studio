import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { api } from '../../api/client.js';
import { RULES_PATH, rulePath } from '../../api/decisions.js';
import { readErrorKind } from '../../api/errors.js';
import { isMcpRule, MCP_POLICY_TEMPLATE, nextMcpPolicyId } from '../../api/mcp.js';
import { isProposalsUnsupported, listProposals, proposalKind } from '../../api/proposals.js';
import {
  authorSteeringRules,
  DEFAULT_STEERING_TYPE,
  isSteeringUnsupported,
  nextRuleId,
  policiesPath,
  readMcpFilter,
  readSteeringTypeFilter,
  STEERING_RULE_TEMPLATE,
  STEERING_TYPES,
  STEERING_TYPE_LABELS,
  STEERING_UNSUPPORTED_COPY,
  steeringTypeOf,
  steerProposalsPath,
  type SteeringRule,
  type SteeringType,
} from '../../api/steering.js';
import { testingPath } from '../../api/testing.js';
import { getWikiMeta, getWikiScoreboard, isWikiUnsupported, SEED_COMMAND, SEED_RUNBOOK_PATH, SEED_RUNBOOK_URL, type WikiMeta } from '../../api/wiki.js';
import type { SessionView } from '../../api/types.js';
import { RULE_EVAL_WORDS, ruleEvalStatus, storeMatch, type RuleEvalStatus } from '../../board/evalModel.js';
import { relTime } from '../../board/relTime.js';
import { fromYourWords, groupOf, rulesSentence } from '../../board/rulesPage.js';
import { ruleSentence } from '../../board/ruleOrigin.js';
import { importRuleFile } from '../../board/steerImport.js';
import { effectWord, firesWord, ruleFires, ruleReach, ruleTitle, ruleTypeWord, steerSentence } from '../../board/calmSteer.js';
import { governedRuns, ruleUsage, usageWindows, USAGE_WINDOW_DAYS } from '../../board/steeringUsage.js';
import { useGovernanceClaims } from '../../hooks/useGovernanceClaims.js';
import { useDaemonRuleStore } from '../../hooks/useDaemonRuleStore.js';
import { useLatestEval } from '../../hooks/useLatestEval.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { usePhone } from '../../hooks/usePhone.js';
import { useNeedsSources } from '../../store/needsSources.js';
import { useProjectsStore } from '../../store/projects.js';
import { useSteerDraft } from '../../store/steerDraft.js';
import { AssistDock, type AssistNote, type AssistVerbs } from '../AssistDock.js';
import { useModalEscape } from '../Modal.js';
import { ProposalsSection } from '../ProposalsSection.js';
import { SteeringStoreHealth, type ScoreboardState } from '../SteeringHealth.js';
import { SteeringRetireModal } from '../SteeringRetireModal.js';
import { SteeringRuleDrawer } from '../SteeringRuleDrawer.js';
import { SteeringRuleFormModal } from '../SteeringRuleForm.js';
import { readFileText } from '../fileText.js';
import { FilePick, StateBanner, TechDetails } from '../ui/index.js';
import type { MenuItem } from '../ui/OverflowMenu.js';
import { CalmAction, CalmButton, CalmEmpty, CalmHead, CalmLoading, CalmNote, CalmRow, CalmRows, CalmSearch, CalmSection, CalmSeg } from '../calm/Calm.js';
import { FacetAutocomplete } from '../FacetAutocomplete.js';
import { useDialogFocus } from './useDialogFocus.js';

/**
 * A Policies address that keeps the list's filters (type, MCP, never used) together, so turning
 * one off never drops the others (agy r1; codex r3 #4 for the table link).
 */
function steerHref(type: SteeringType | null, mcp: boolean, unused: boolean, table = false): string {
  const u = new URL(policiesPath(type, mcp), 'http://studio.local');
  if (unused) u.searchParams.set('usage', 'unused');
  if (table) u.searchParams.set('view', 'table');
  return `${u.pathname}${u.search}`;
}

/**
 * THE STEER SURFACE (DES-steer-eval §2; operator-approved concept `concepts/tabs.html#steer`).
 * Desk v2's Steer tab hosts it; the standalone steering addresses render it too. One page:
 *
 *  - four tiles: rules in force, rule proposals to review, caught in the last eval, and the three
 *    ways to add (a rule, an import, the assistant);
 *  - the seven steering types as cards with a severity bar (All types first) — the type filter;
 *  - the rule list: In force / Proposals (policy proposals only — memory is the Memory tab's) /
 *    Retired, a search, each rule as its sentence with its
 *    id, type, eval status and Retire. A rule opens in the existing drawer (origin, history, hold,
 *    edit, retire). "Edit as a table" opens the existing spreadsheet editor for inline edits.
 *
 * Every write goes through crew's API exactly as before (upsert, import, author, retire, proposal
 * approve/reject) — this surface adds no new write and no new wire.
 */

const SEVERITIES = ['critical', 'error', 'warn', 'info'] as const;
type Severity = (typeof SEVERITIES)[number];
const PAGE = 20;

type ListView = 'live' | 'proposals' | 'retired';

type RulesRead = { kind: 'loading' } | { kind: 'ok'; rules: SteeringRule[] } | { kind: 'failed'; error: unknown };

/** The list's order: your words first, then the most serious, then the newest, then by id. */
export function bySeverity(rules: readonly SteeringRule[]): SteeringRule[] {
  const at = (r: SteeringRule): number => { const v = (r as { created_at?: unknown }).created_at; return typeof v === 'number' ? v : 0; };
  return [...rules].sort((a, b) =>
    Number(fromYourWords(b)) - Number(fromYourWords(a))
    || SEVERITIES.indexOf(sevOf(a)) - SEVERITIES.indexOf(sevOf(b))
    || at(b) - at(a)
    || a.id.localeCompare(b.id));
}

/** A rule's tags for the tag filter — its type, severity, every string target and applies_to value
 *  (the retired governance dashboard's vocabulary, kept: codex r2 #5). */
export function ruleFacets(rule: SteeringRule): string[] {
  const out = [`type=${steeringTypeOf(rule)}`, `severity=${rule.severity}`];
  for (const [key, value] of Object.entries(rule.targets ?? {})) if (typeof value === 'string' && value !== '') out.push(`${key}=${value}`);
  for (const value of rule.applies_to ?? []) if (value !== '') out.push(`applies_to=${value}`);
  return out;
}

function sevOf(r: SteeringRule): Severity {
  return (SEVERITIES as readonly string[]).includes(r.severity) ? (r.severity as Severity) : 'info';
}

export function SteerSurface({ pathname, search, navigate: navigateRaw, runs = [], address, title }: {
  /** Where a steering address lives in the host (the Desk: `/?tab=steer&at=<address>`). Every move
   *  inside the surface goes there directly, so the host never redirects and the surface never remounts. */
  address?: (steeringPath: string) => string;
  /** The page title (Steering, unless a host names it otherwise). */
  title?: string;
  /** The address this surface renders for — `/rules[/:id]` or `/steering/...`. */
  pathname: string;
  search: string;
  navigate: Navigate;
  runs?: SessionView[];
}): React.ReactElement {
  const phone = usePhone();
  const type = readSteeringTypeFilter(search);
  const query = new URLSearchParams(search);
  const routedRule = pathname.startsWith(`${RULES_PATH}/`) ? decodeURIComponent(pathname.slice(RULES_PATH.length + 1)) : query.get('rule');
  const usageAsked = query.get('usage') === 'unused';
  const mcpOnly = readMcpFilter(search);
  /** In-surface moves: steering addresses go through the host's `address`; anything else (a run, a chat)
   *  is a plain navigation. */
  const at = (path: string): string => (address !== undefined && (path.startsWith(RULES_PATH) || path.startsWith('/steering')) ? address(path) : path);
  const navigate: Navigate = (path, opts) => { if (opts === undefined) navigateRaw(at(path)); else navigateRaw(at(path), opts); };
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };

  // ── Reads ────────────────────────────────────────────────────────────────────────────────────
  const [read, setRead] = useState<RulesRead>({ kind: 'loading' });
  const seq = useRef(0);
  /** A refresh that fails after a good read keeps the rules it had (and says so): the list, and the
   *  id inventory an open create form checks collisions against, never drop to empty (codex r2 #1). */
  const [refreshFailed, setRefreshFailed] = useState<unknown>(null);
  const load = useCallback(async (): Promise<SteeringRule[] | null> => {
    const mine = ++seq.current;
    try {
      const { rules } = await api.listConformanceRules();
      if (mine === seq.current) { setRead({ kind: 'ok', rules: rules as SteeringRule[] }); setRefreshFailed(null); }
      return rules as SteeringRule[];
    } catch (e) {
      if (mine === seq.current) {
        setRead((cur) => (cur.kind === 'ok' ? cur : { kind: 'failed', error: e }));
        setRefreshFailed(e);
      }
      return null;
    }
  }, []);
  const [scoreboard, setScoreboard] = useState<ScoreboardState>({ kind: 'loading' });
  const [meta, setMeta] = useState<WikiMeta | null>(null);
  useEffect(() => {
    void load();
    void getWikiScoreboard()
      .then(({ scoreboard: sb }) => setScoreboard({ kind: 'loaded', scoreboard: sb }))
      .catch((e: unknown) => setScoreboard(isWikiUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', message: e instanceof Error ? e.message : String(e) }));
    void getWikiMeta().then(({ meta: m }) => setMeta(m ?? null)).catch(() => setMeta(null));
  }, [load]);
  const claims = useGovernanceClaims();
  const latest = useLatestEval();
  const daemonStore = useDaemonRuleStore();
  const [pending, setPending] = useState<number | null | 'unsupported'>(null);
  const [reviewTick, setReviewTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void listProposals({ state: 'pending' })
      .then((ps) => {
        if (cancelled) return;
        // Steer reviews the POLICY proposals; memory proposals are the Memory page's.
        setPending(ps.filter((p) => proposalKind(p) === 'policy').length);
        useNeedsSources.getState().depositProposals(ps);
      })
      .catch((e: unknown) => { if (!cancelled) setPending(isProposalsUnsupported(e) ? 'unsupported' : null); });
    return () => { cancelled = true; };
  }, [reviewTick]);

  const rules = useMemo(() => (read.kind === 'ok' ? read.rules : []), [read]);
  const projects = useProjectsStore((s) => s.projects);
  const projectName = (id: string | undefined): string | null => (id === undefined ? null : projects.find((p) => p.id === id)?.name ?? null);

  // ── Page state ───────────────────────────────────────────────────────────────────────────────
  // `/steering/proposals` (Needs you's Review, ⌘K) opens on the Proposals view.
  const askedProposals = pathname === steerProposalsPath();
  const [view, setView] = useState<ListView>(askedProposals ? 'proposals' : 'live');
  useEffect(() => { if (askedProposals) setView('proposals'); }, [askedProposals]);
  const [q, setQ] = useState('');
  const [facet, setFacet] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The open editor and this OPENING's token: a save that completes after Cancel and a reopen (even of
   *  the same rule) belongs to an older opening and closes nothing. */
  const [editing, setEditing] = useState<{ rule: SteeringRule; token: number } | null>(null);
  const opened = useRef(0);
  const edit = (r: SteeringRule): void => setEditing({ rule: r, token: ++opened.current });
  /** The open create form and this OPENING's token, as for editing: a late save closes only its own opening (codex r2 #2). */
  const [creating, setCreating] = useState<{ rule: SteeringRule; type: SteeringType; token: number } | null>(null);
  /** The open retire dialog and this OPENING's token: a late retirement closes only its own opening (codex r4 #2). */
  const [retiring, setRetiring] = useState<{ rule: SteeringRule; token: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  /** The assistant: mounted once opened and kept mounted (hidden) when closed, so a draft, its
   *  attachments and an authoring run survive Close (codex r1 #5). Only a new seeded request
   *  (Draft rules) starts a fresh one. */
  const [dock, setDock] = useState<{ text: string; key: number } | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setShown(PAGE); }, [type, view, q, usageAsked, mcpOnly, facet]);
  // The address names the open rule (`/rules/:id`, `?rule=`); a click opens it in place.
  // The editor belongs to the address too: Back to the list, or another rule, closes it.
  useEffect(() => { setSelectedId(routedRule); setEditing(null); }, [routedRule]);
  // Evaluate's Draft rules: open the assistant with the request typed in, for the gap's type.
  const seed = useSteerDraft((s) => s.seed);
  useEffect(() => {
    if (seed === null) return;
    const s = useSteerDraft.getState().take();
    // The seed's type is the page's: Draft rules navigates to that type's address.
    if (s !== null) { setDock({ text: s.text, key: s.at }); setDockOpen(true); }
  }, [seed]);

  const pageType: SteeringType = type ?? DEFAULT_STEERING_TYPE;

  // ── Folds ────────────────────────────────────────────────────────────────────────────────────
  const live = rules.filter((r) => r.retired !== true);
  const retiredRules = rules.filter((r) => r.retired === true);
  // A run judged against another rule store says nothing about THESE rules, even when ids match (codex r1 #2).
  const evalStatus = useMemo(() => (latest.kind === 'ok' && storeMatch(latest.eval.ruleStore, daemonStore) !== 'other'
    ? ruleEvalStatus(latest.eval.results) : new Map<string, RuleEvalStatus>()), [latest, daemonStore]);
  // Counts over the rules exist only once the rules were read: a failed read is not an empty store (codex r3 #3).
  const usage = scoreboard.kind === 'loaded' && read.kind === 'ok' ? ruleUsage(rules, scoreboard.scoreboard.evidence.per_rule) : null;
  const windows = claims.kind === 'loaded' ? usageWindows(claims.claims, Date.now()) : null;
  const governed = claims.kind === 'loaded' ? governedRuns(claims.claims, runs) : null;
  const unusedIds = usageAsked && usage !== null ? usage.unusedIds : null;

  const needle = q.trim().toLowerCase();
  const facetPairs = useMemo(() => [...new Set(rules.flatMap(ruleFacets))].sort(), [rules]);
  const listed = bySeverity(view === 'retired' ? retiredRules : live).filter((r) => {
    if (type !== null && steeringTypeOf(r) !== type) return false;
    if (mcpOnly && !isMcpRule(r)) return false;
    if (unusedIds !== null && !unusedIds.includes(r.id)) return false;
    if (needle !== '' && !r.id.toLowerCase().includes(needle) && !r.statement.toLowerCase().includes(needle)) return false;
    if (facet !== null && !ruleFacets(r).includes(facet)) return false;
    return true;
  });

  const selected = selectedId === null ? null : rules.find((r) => r.id === selectedId) ?? null;
  /** A rule opens on an address: `/rules/:id` from the overview, `?rule=` on a filtered view (the filter stays). */
  const openPath = (id: string): string => {
    if (pathname === RULES_PATH || pathname.startsWith(`${RULES_PATH}/`)) return rulePath(id);
    const n = new URLSearchParams(search); n.set('rule', id);
    return `${pathname}?${n.toString()}`;
  };
  const closeDrawer = (): void => {
    setSelectedId(null);
    if (pathname.startsWith(`${RULES_PATH}/`)) navigate(RULES_PATH);
    else if (query.get('rule') !== null) { const n = new URLSearchParams(search); n.delete('rule'); const s = n.toString(); navigate(`${pathname}${s === '' ? '' : `?${s}`}`); }
  };

  /** After a save: reload, and say where the SERVER filed the rule (an older engine drops steering_type). */
  const afterSaved = (id: string, intended: SteeringType): void => {
    void load().then((rs) => {
      const saved = (rs ?? []).find((r) => r.id === id);
      const landed = saved === undefined ? null : steeringTypeOf(saved);
      setNote({ tone: 'ok', text: landed !== null && landed !== intended
        ? `Saved ${id} — but this daemon's engine predates steering types, so it was filed under ${STEERING_TYPE_LABELS[landed]}.`
        : `Saved ${id}.` });
    });
  };

  // A new rule's id is checked against the rules in force: until they have loaded there is nothing to
  // check against, and a suggested id could overwrite one (codex r1 #1).
  const addRule = (): void => {
    if (read.kind !== 'ok') return;
    const t = pageType;
    setCreating({ type: t, token: ++opened.current, rule: { ...STEERING_RULE_TEMPLATE, steering_type: t, id: nextRuleId(rules, 'pattern') } });
  };
  const addMcp = (): void => { if (read.kind === 'ok') setCreating({ type: 'security', token: ++opened.current, rule: { ...MCP_POLICY_TEMPLATE, id: nextMcpPolicyId(rules) } }); };
  // The assistant authors for the page's type, whichever type it was first opened on (codex r2 #3).
  const openChat = (): void => {
    if (dock === null) setDock({ text: '', key: Date.now() });
    setDockOpen(true);
  };
  const closeChat = (): void => setDockOpen(false);
  // A dialog: focus in on open, back to the opener on close; on a phone it covers the page, so the
  // page behind is inert and Tab stays inside (codex r1 #8).
  useDialogFocus(dockOpen, dockRef, { modal: phone, background: scrollRef, prefer: 'textarea', key: dock?.key });

  const dockVerbs: AssistVerbs = useMemo(() => ({
    send: async (text, documents) => {
      try {
        return await authorSteeringRules({ instructions: text, type: pageType, ...(documents.length > 0 ? { documents } : {}) });
      } catch (e) {
        throw isSteeringUnsupported(e) ? new Error(STEERING_UNSUPPORTED_COPY) : e;
      }
    },
    importDirect: async (doc) => {
      const notes = await importRuleFile(doc, pageType);
      void load();
      return notes as AssistNote[];
    },
    onRunResolved: () => { void load(); },
  }), [pageType, load]);

  const unseeded = meta !== null && meta.seeded === false && rules.length === 0 && read.kind === 'ok';

  // ── Pieces (the calm page: title + one sentence + Add a rule; one filter; roomy rows) ─────────
  const lastEval = latest.kind === 'ok' ? latest.eval : null;
  const blocked = lastEval !== null ? lastEval.results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'bad').length : 0;
  // A run judged against another rule store did not test these rules: the line says so (DES-steer-eval §3.2).
  const otherStore = lastEval !== null && storeMatch(lastEval.ruleStore, daemonStore) === 'other';
  // How often each rule fired this week, from the gate-check record (null until it has been read).
  const fires = useMemo(() => (claims.kind === 'loaded' ? ruleFires(claims.claims, Date.now()) : null), [claims]);
  const typeLive = read.kind === 'ok' ? live.filter((r) => type === null || steeringTypeOf(r) === type).length : null;
  const sentence = read.kind === 'failed' ? 'Couldn’t read your rules just now.' : steerSentence({ live: typeLive, type, pending });

  const counts: Record<ListView, number | null> = {
    live: typeLive,
    proposals: typeof pending === 'number' ? pending : null,
    retired: retiredRules.filter((r) => type === null || steeringTypeOf(r) === type).length,
  };
  // The table opens on the same filters (type, MCP, unused) the list shows (codex r3 #4).
  const tableHref = steerHref(type, mcpOnly, usageAsked, true);
  const refreshAll = (): void => { void load(); setReviewTick((t) => t + 1); latest.reload(); };

  // The one action, and every other way to add or manage behind its menu.
  const moreMoves: MenuItem[] = [
    { id: 'chat', label: 'Add with chat', testId: 'steer-chat', onSelect: () => openChat() },
    { id: 'import', label: 'Import rules…', testId: 'steer-import', onSelect: () => setImporting(true) },
    { id: 'mcp', label: 'Add an MCP policy', testId: 'steering-add-mcp', onSelect: addMcp, disabled: read.kind === 'ok' ? null : 'Once the rules have loaded' },
    { id: 'table', label: 'Edit as a table', testId: 'steer-table', onSelect: () => navigate(tableHref) },
    view === 'retired'
      ? { id: 'live', label: 'Show the rules in force', testId: 'steer-view-retired', onSelect: () => setView('live') }
      : { id: 'retired', label: counts.retired !== null && counts.retired > 0 ? `Show retired rules (${counts.retired})` : 'Show retired rules', testId: 'steer-view-retired', onSelect: () => setView('retired') },
    { id: 'refresh', label: 'Refresh', testId: 'steer-refresh', onSelect: refreshAll },
  ];
  const action = (
    <CalmAction label="Add a rule" testId="steer-add-rule" icon={<Plus size={16} aria-hidden />} onClick={addRule} disabled={read.kind !== 'ok'}
      title={read.kind === 'ok' ? undefined : 'Available once the rules have loaded (a new id must not collide with one in force)'}
      menu={moreMoves} menuLabel="More ways to add and manage rules" menuTestId={/* testid */ 'steer-more'} />
  );

  // The seven steering types are sub-pages of one layout: a quiet picker stands in for the list's label.
  const typePick = (
    <label className="wk-calm-typepick">
      <span className="sr-only">Steering type</span>
      <select className="wk-calm-pick" data-testid="steer-type-pick" value={type ?? 'all'} aria-label="Steering type"
        onChange={(e) => { const t = e.target.value === 'all' ? null : (e.target.value as SteeringType); navigate(policiesPath(t, mcpOnly)); }}>
        <option value="all">{view === 'retired' ? 'Retired · all types' : 'All rules'}</option>
        {STEERING_TYPES.map((t) => {
          const n = read.kind === 'ok' ? (view === 'retired' ? retiredRules : live).filter((r) => steeringTypeOf(r) === t).length : null;
          return <option key={t} value={t}>{`${STEERING_TYPE_LABELS[t]}${n === null ? '' : ` (${n})`}`}</option>;
        })}
      </select>
    </label>
  );

  const ruleRow = (r: SteeringRule): React.ReactElement => {
    const st = evalStatus.get(r.id);
    const sentenceLine = ruleSentence(r, projectName(r.targets.project) ?? 'one project');
    const scoped = r.targets.project !== undefined && r.targets.project !== '';
    const title = r.id.startsWith('proposal:') && r.statement.trim() === '' ? 'Proposed rule' : ruleTitle(r.statement);
    const effect = effectWord(r);
    const n = fires?.get(r.id);
    return (
      <CalmRow key={r.id} data-testid="rules-row" data={{ 'rule-id': r.id, group: groupOf(r), retired: r.retired === true, sev: sevOf(r) }}
        tone={r.retired === true ? 'quiet' : 'ok'} title={title} titleAttr={r.statement}
        sub={(
          <span data-testid="rules-row-line" data-sentence={sentenceLine} title={sentenceLine}>
            {ruleTypeWord(r)}
            {' · '}
            {/* studio#836: the reach is on the row, scoped or not. */}
            <span data-testid="rules-row-reach" data-reach={scoped ? 'project' : 'everywhere'}>{ruleReach(r, (id) => projectName(id))}</span>
            {effect !== null && effect !== 'allows' && ` · ${effect}`}
            {fromYourWords(r) && ' · from your words'}
            {st !== undefined && <> · <span className="wk-se-evalst" data-eval={st}>{RULE_EVAL_WORDS[st].toLowerCase()}</span></>}
          </span>
        )}
        meta={r.retired === true ? 'Retired' : fires === null ? null : <span data-testid="rules-row-fires" data-fires={n ?? 0}>{firesWord(n)}</span>}
        href={at(openPath(r.id))} onOpen={() => navigate(openPath(r.id))} openTestId={/* testid */ 'rules-row-open'} openLabel={`${title}: open the rule`}
        menuLabel={`More for ${title}`} menuTestId={/* testid */ 'steer-row-more'}
        menu={[
          { id: 'open', label: 'Open details', onSelect: () => navigate(openPath(r.id)) },
          ...(r.retired !== true ? [{ id: 'retire', label: 'Retire…', danger: true, testId: 'steer-retire', onSelect: () => setRetiring({ rule: r, token: ++opened.current }) }] : []),
        ]} />
    );
  };

  const filterNotes = (
    <>
      {usageAsked && (
        <CalmNote data-testid="steering-usage-filter-note">
          {unusedIds !== null ? `Only the ${unusedIds.length} rules no run has cited.` : 'Studio’s service can’t say which rules are unused yet, so all rules are shown.'}{' '}
          <a href={at(steerHref(type, mcpOnly, false))} onClick={go(steerHref(type, mcpOnly, false))} className="wk-link" data-testid="steering-usage-filter-clear">Show all</a>
        </CalmNote>
      )}
      {mcpOnly && (
        <CalmNote data-testid="steer-mcp-note">Only rules that govern MCP calls. <a href={at(steerHref(type, false, usageAsked))} onClick={go(steerHref(type, false, usageAsked))} className="wk-link" data-testid="steer-mcp-clear">Show all</a></CalmNote>
      )}
      {view === 'retired' && (
        <CalmNote data-testid="steer-retired-note">Retired rules: helpers no longer follow them; they stay listed here, never deleted. <button type="button" className="wk-link wk-se-linkbtn" onClick={() => setView('live')}>Back to the rules in force</button></CalmNote>
      )}
      {refreshFailed !== null && read.kind === 'ok' && (
        <CalmNote tone="fail" data-testid="steer-refresh-failed" role="status">
          Couldn&rsquo;t refresh the rules; showing the last ones read. <button type="button" className="wk-link wk-se-x" onClick={() => { void load(); }}>Try again</button>
        </CalmNote>
      )}
      {note !== null && (
        <CalmNote tone={note.tone} data-testid="steering-saved-note" role="status">
          {note.text} <button type="button" className="wk-link wk-se-x" onClick={() => setNote(null)} aria-label="Dismiss">Dismiss</button>
        </CalmNote>
      )}
    </>
  );

  const tools = (
    <>
      {view !== 'proposals' && (
        <CalmSearch value={q} onChange={setQ} placeholder="Search rules" label="Search rules" testId="steer-search" buttonTestId={/* testid */ 'steer-search-open'}
          startOpen={facet !== null}
          extra={facetPairs.length > 0 ? <FacetAutocomplete testId="steer-facet" options={facetPairs} value={facet} onChange={setFacet} label="Filter rules by tags" placeholder="Filter by tag" /> : undefined} />
      )}
      <CalmSeg label="Which rules" value={view} onChange={setView} data-testid="steer-view"
        options={[
          { value: 'live', label: 'Active', testId: 'steer-view-live' },
          { value: 'proposals', label: typeof pending === 'number' ? `Proposed (${pending})` : 'Proposed', testId: 'steer-view-proposals' },
        ]} />
    </>
  );

  const list = (
    <CalmSection labelNode={view === 'proposals' ? <h2 className="wk-calm-label">Proposed rules</h2> : typePick} tools={tools} data-testid="steer-rules" ariaLabel="Rules">
      {filterNotes}
      {view === 'proposals' ? (
        <div className="wk-se-proposals wk-calm-proposals" data-testid="governance-review-inbox">
          <ProposalsSection kind="policy" heading="Rule proposals" onDecision={() => { setReviewTick((t) => t + 1); void load(); }} />
        </div>
      ) : read.kind === 'loading' ? (
        <CalmLoading data-testid="rules-loading" rows={5} label="Reading your rules" />
      ) : read.kind === 'failed' ? (
        <StateBanner data-testid="rules-error" kind={readErrorKind(read.error)} what="the rules"
          error={read.error instanceof Error ? read.error.message : String(read.error)} onRetry={() => { setRead({ kind: 'loading' }); void load(); }} />
      ) : unseeded ? (
        <CalmEmpty data-testid="steering-unseeded" title="No steering rules yet."
          body={<>
            <p>Rules tell your agents how this team works. Add one, import a doctrine doc, or describe them in a chat. Or seed from the runbook at{' '}
              <a href={SEED_RUNBOOK_URL} target="_blank" rel="noreferrer" className="wk-link">{SEED_RUNBOOK_PATH}</a>.</p>
            <TechDetails summary="Seed command" text={SEED_COMMAND} />
          </>}
          action={<CalmButton onClick={() => openChat()}>Describe them in a chat</CalmButton>} />
      ) : listed.length === 0 ? (
        <CalmEmpty data-testid="steer-rules-empty"
          title={needle !== '' ? 'No rule matches that search.' : facet !== null || mcpOnly || unusedIds !== null ? 'No rule matches these filters.' : view === 'retired' ? 'Nothing retired.' : type !== null ? `No ${STEERING_TYPE_LABELS[type]} rules yet.` : 'No rules in force.'}
          body={view === 'retired' ? <p>A retired rule stays listed here, never deleted.</p> : needle !== '' || facet !== null ? undefined : <p>Add one with Add a rule, or describe what you want in a chat.</p>}
          action={needle !== '' || facet !== null ? <CalmButton onClick={() => { setQ(''); setFacet(null); }}>Clear the search</CalmButton> : undefined} />
      ) : (
        <CalmRows data-testid="steer-rule-list" label="Rules">{listed.slice(0, shown).map(ruleRow)}</CalmRows>
      )}
      {view !== 'proposals' && read.kind === 'ok' && listed.length > shown && (
        <button type="button" className="wk-calm-more" data-testid="steer-show-all" onClick={() => setShown(listed.length)}>Show all {listed.length}</button>
      )}
      {read.kind === 'ok' && routedRule !== null && !rules.some((r) => r.id === routedRule) && (
        <CalmNote data-testid="rules-missing">That rule isn&rsquo;t here; it may have been removed. <TechDetails text={routedRule} summary="Rule id" /></CalmNote>
      )}
    </CalmSection>
  );

  // The numbers a person rarely needs — the store's health, the gate record, the last evaluation — behind one quiet disclosure.
  const health = (
    <details className="wk-calm-disclose" data-testid="steer-health">
      <summary><ChevronDown size={16} aria-hidden className="wk-calm-chev" /> Rule health and the last evaluation</summary>
      <div className="wk-calm-disclose-body">
        {read.kind === 'ok' && <p className="wk-calm-foot" data-testid="rules-sentence" data-count={live.length}>{rulesSentence(rules)}</p>}
        <SteeringStoreHealth state={scoreboard} />
        <dl className="wk-calm-facts">
          <div><dt>Gate checks, {USAGE_WINDOW_DAYS} days</dt><dd data-testid="steer-fact-checks">{windows !== null ? windows.evaluations.current : claims.kind === 'loading' ? '…' : '—'}</dd></div>
          <div><dt>Denied</dt><dd>{windows !== null ? windows.denials.current : '—'}</dd></div>
          <div><dt>Runs checked</dt><dd>{governed !== null && governed.pct !== null ? `${governed.pct}%` : '—'}</dd></div>
          <div><dt>Never used</dt><dd data-testid="steer-fact-unused">
            {usage !== null ? (usage.unusedIds.length > 0
              ? <a href={at(steerHref(type, mcpOnly, true))} onClick={go(steerHref(type, mcpOnly, true))} className="wk-link" data-testid="steer-fact-unused-link">{usage.unusedIds.length}</a>
              : 0) : '—'}
          </dd></div>
          <div><dt>Last evaluation</dt><dd data-testid="steer-stat-eval" title={otherStore ? 'The last eval was judged against a different rule store, not this daemon’s, so it did not test these rules.' : undefined}>
            {lastEval !== null
              ? `${lastEval.summary.caught} of ${lastEval.summary.total} caught · ${blocked} bad blocked · ${lastEval.summary.gaps} gaps · ${otherStore ? 'another rule store' : relTime(lastEval.at)}`
              : latest.kind === 'loading' ? '…' : latest.kind === 'unavailable' ? 'Evaluations aren’t available here' : latest.kind === 'failed' ? 'Couldn’t read the last evaluation' : 'None yet'}
            {' '}<a href={testingPath('evals')} className="wk-link" onClick={(e) => { e.preventDefault(); navigate(testingPath('evals')); }}>Evaluate</a>
          </dd></div>
        </dl>
      </div>
    </details>
  );

  return (
    <div className="wk-se wk-se--calm" data-testid="steer-surface" data-steering-type={type ?? 'all'}>
      <div className="wk-se-scroll wk-calm" ref={scrollRef}>
        <div className="wk-calm-col">
          <CalmHead title={title ?? 'Steering'} sentence={sentence} sentenceTestId={/* testid */ 'steer-sentence'} action={action} />
          {list}
          {health}
        </div>
      </div>
      {dock !== null && (
        <div ref={dockRef} className="wk-se-dock" role="dialog" aria-label="Steering assistant" data-testid="steer-dock" hidden={!dockOpen}
          {...(phone ? { 'aria-modal': true } : {})}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeChat(); } }}>
          <AssistDock
            key={dock.key}
            context={{
              surface: 'steering',
              title: 'Assistant',
              contextLabel: `Steering · ${STEERING_TYPE_LABELS[pageType]}`,
              placeholder: `Describe the ${STEERING_TYPE_LABELS[pageType]} rules you want…`,
              hint: `Describe the ${STEERING_TYPE_LABELS[pageType]} rules you want, or drop .md or .json rule files to import them. A helper drafts the rules; nothing is saved until you approve them.`,
            }}
            verbs={dockVerbs}
            importable={(name) => /\.(md|markdown|json)$/i.test(name)}
            open={dockOpen}
            onOpenChange={(o) => { if (o) setDockOpen(true); else closeChat(); }}
            typeTarget="page"
            initialText={dock.text}
            fill
          />
        </div>
      )}

      {importing && (
        <ImportDialog defaultType={pageType} background={scrollRef} onClose={() => setImporting(false)} onImported={() => { void load(); }} />
      )}
      {selected !== null && (
        <SteeringRuleDrawer
          key={selected.id}
          rule={selected}
          evidence={scoreboard.kind === 'loaded' ? (scoreboard.scoreboard.evidence.per_rule.find((x) => x.rule_id === selected.id) ?? { denial_claims: 0, governs_evidence: 0 }) : null}
          onClose={closeDrawer}
          onEdit={edit}
          onRetired={(r, reason) => { setNote({ tone: 'ok', text: `Retired ${r.id}. Helpers no longer follow it; it stays listed under Retired. Your reason: “${reason}”` }); void load(); }}
          runs={runs}
          navigate={navigate}
          onHeld={() => { void load(); }}
        />
      )}
      {editing !== null && (
        <SteeringRuleFormModal key={editing.token} type={steeringTypeOf(editing.rule)} initial={editing.rule} onClose={() => setEditing(null)}
          // A save that completes late closes only the opening that started it.
          onSaved={(id) => { const mine = editing.token; const t = steeringTypeOf(editing.rule); setEditing((cur) => (cur !== null && cur.token === mine ? null : cur)); afterSaved(id, t); }} />
      )}
      {creating !== null && (
        <SteeringRuleFormModal key={creating.token} type={creating.type} initial={creating.rule} create existingIds={rules.map((r) => r.id)}
          onClose={() => setCreating(null)}
          onSaved={(id) => { const mine = creating.token; const t = creating.type; setCreating((cur) => (cur !== null && cur.token === mine ? null : cur)); afterSaved(id, t); }} />
      )}
      {retiring !== null && (
        <SteeringRetireModal key={retiring.token} rule={retiring.rule} onClose={() => setRetiring(null)}
          onRetired={(reason) => {
            const { token: mine, rule: { id } } = retiring;
            setRetiring((cur) => (cur !== null && cur.token === mine ? null : cur));
            setNote({ tone: 'ok', text: `Retired ${id}. Helpers no longer follow it; it stays listed under Retired. Your reason: “${reason}”` });
            void load();
          }} />
      )}
    </div>
  );
}

/** Import rule files: a markdown doctrine doc or a JSON batch, filed under one steering type. */
export function ImportDialog({ defaultType, background, onClose, onImported }: {
  defaultType: SteeringType;
  /** The page behind: inert while the dialog is open (codex r2 #8). */
  background: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onImported: () => void;
}): React.ReactElement {
  useModalEscape(onClose);
  const box = useRef<HTMLDivElement | null>(null);
  useDialogFocus(true, box, { modal: true, background, prefer: 'select' });
  const [t, setT] = useState<SteeringType>(defaultType);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<{ tone: string; text: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const run = async (): Promise<void> => {
    if (file === null || busy) return;
    setBusy(true); setError(null); setNotes([]);
    try {
      const content = await readFileText(file);
      setNotes(await importRuleFile({ name: file.name, content }, t));
      // The file is spent: Import stays off until another is chosen, so a second press can't
      // send the same batch again (agy r1).
      setFile(null);
      onImported();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wk-se-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="steer-import-title" className="wk-card wk-se-dialog" data-testid="steer-import-dialog">
        <h2 id="steer-import-title" className="wk-se-dialog-title">Import rules</h2>
        <p className="wk-se-dialog-sub">A markdown doctrine doc (one rule per item under “## Rules”) or a JSON list of rules. Nothing already in force changes unless an id matches.</p>
        <label className="wk-se-field">
          <span>File them under</span>
          <select className="wk-field" value={t} onChange={(e) => setT(e.target.value as SteeringType)} data-testid="steer-import-type">
            {STEERING_TYPES.map((x) => <option key={x} value={x}>{STEERING_TYPE_LABELS[x]}</option>)}
          </select>
        </label>
        <FilePick data-testid="steer-import-file" label="Choose a file…" accept=".md,.markdown,.json,application/json,text/markdown" file={file} onChange={setFile} />
        {notes.length > 0 && (
          <ul className="wk-se-notes" data-testid="steer-import-notes" role="status">
            {notes.map((n, i) => <li key={i} data-tone={n.tone}>{n.text}</li>)}
          </ul>
        )}
        {error !== null && <StateBanner kind={readErrorKind(error)} what="the import" error={error instanceof Error ? error.message : String(error)} onRetry={() => void run()} />}
        <div className="wk-se-dialog-actions">
          <button type="button" className="wk-btn wk-btn--secondary" onClick={onClose} data-testid="steer-import-cancel">{notes.length > 0 ? 'Done' : 'Cancel'}</button>
          <button type="button" className="wk-btn wk-btn--primary" disabled={file === null || busy} onClick={() => void run()} data-testid="steer-import-go">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
