import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import {
  authorSteeringRules,
  DEFAULT_STEERING_TYPE,
  importSteeringRules,
  importEntryOutcome,
  isSteeringUnsupported,
  policiesPath,
  STEERING_TYPE_LABELS,
  STEERING_UNSUPPORTED_COPY,
  steeringTypeOf,
  type SteeringRule,
  type SteeringType,
} from '../api/steering.js';
import {
  getWikiMeta,
  getWikiScoreboard,
  isWikiUnsupported,
  SEED_COMMAND,
  SEED_RUNBOOK_PATH,
  SEED_RUNBOOK_URL,
  type WikiMeta,
} from '../api/wiki.js';
import type { SessionView } from '../api/types.js';
import { ruleUsage } from '../board/steeringUsage.js';
import { AssistDock, useAssistDockOpen, type AssistNote, type AssistVerbs } from './AssistDock.js';
import { SteeringAddMenu } from './SteeringAddMenu.js';
import { SteeringUsageBand } from './SteeringUsageBand.js';
import { SteeringGrid } from './SteeringGrid.js';
import { SteeringHealth, SteeringStoreHealth, type ScoreboardState } from './SteeringHealth.js';
import { SteeringRuleDrawer } from './SteeringRuleDrawer.js';
import { SteeringRuleFormModal } from './SteeringRuleForm.js';
import { SteeringTypeFilter } from './SteeringTypeFilter.js';

/**
 * The Steering surface's POLICIES sub-section (`/steering/policies`, DES-MEM-FACETED-001 unified
 * surface). One page that both MANAGES existing policies and REVIEWS policy proposals:
 *
 *  - the old seven type pages/cards COLLAPSED into ONE grid with a TYPE FILTER (SteeringTypeFilter:
 *    `All` + the seven types, riding `?type=` in the URL). `type === null` is the `All` view — the
 *    grid shows every rule (each row still shows its type, editable inline) and the store-wide
 *    health + usage band render; a `type` scopes the grid and shows that type's health header.
 *  - the GRID (SteeringGrid) is the editable spreadsheet over the common columns — per-row saves on
 *    the SHIPPING upsert wire (optimistic here, reverted on error, the server's answer reloaded, the
 *    "where the server filed it" honesty note included); add = a draft row; remove = the retire kill
 *    switch. The ADVANCED fields stay in the DRAWER the id cell opens.
 *  - the ASSIST DOCK (DES-ASSIST-DOCK) sits beside the grid: a typed message launches the governed
 *    steering-author run for the active type (architecture in the `All` view) and narrates inline;
 *    rule-shaped attachments fork import-directly vs analyze-with-chat.
 *  - the agent-proposed steering policies are REVIEWED in the governed-knowledge dashboard's
 *    consolidated inbox (`/steering/dashboard`) — no longer buried below this grid; this page is
 *    the pure "manage existing" surface.
 *
 * Every management write still goes through crew's API (the governed operator path) — estate MCP
 * stays read-only (AW-11).
 */

export function SteeringPage({ type, navigate, search = '', runs = [] }: {
  /** The active type FILTER read from `?type=` — `null` is the `All` view (every rule). */
  type: SteeringType | null;
  navigate: (path: string) => void;
  /** The URL search string — `?type=<type>` is the type filter; `?rule=<id>` deep-links a rule's
   *  drawer open (the Evals gap rows link here); `?usage=unused` filters the grid to the rules the
   *  enforcement record never cites (the usage band's click-through). */
  search?: string;
  /** The app's one runs list — the usage band's governed-runs join. */
  runs?: SessionView[];
}): React.ReactElement {
  const [scoreboard, setScoreboard] = useState<ScoreboardState>({ kind: 'loading' });
  const [meta, setMeta] = useState<WikiMeta | null>(null);
  const [rules, setRules] = useState<SteeringRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The rule the edit modal is open for, or null. */
  const [editing, setEditing] = useState<SteeringRule | null>(null);
  const [retiredNote, setRetiredNote] = useState<{ id: string; reason: string } | null>(null);
  /** The post-save honesty note: where the SERVER actually filed the rule. */
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** A failed cell commit — the optimistic row already reverted; say why. */
  const [commitError, setCommitError] = useState<string | null>(null);
  /** Bumped by the Add ▾ menu — the grid opens its draft row on change. */
  const [addTick, setAddTick] = useState(0);
  const [dockOpen, setDockOpen] = useAssistDockOpen('steering');

  /** The type a new/authored rule defaults to — the active filter, or architecture in the `All`
   *  view (the engine's serde default; the draft's type cell stays editable). */
  const pageType: SteeringType = type ?? DEFAULT_STEERING_TYPE;

  const loadRules = useCallback(async (): Promise<SteeringRule[]> => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const { rules: rs } = await api.listConformanceRules();
      setRules(rs as SteeringRule[]);
      return rs as SteeringRule[];
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
    void getWikiScoreboard()
      .then(({ scoreboard: sb }) => setScoreboard({ kind: 'loaded', scoreboard: sb }))
      .catch((e: unknown) => {
        if (isWikiUnsupported(e)) setScoreboard({ kind: 'unsupported' });
        else setScoreboard({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    void getWikiMeta()
      // `?? null`: a mis-shaped payload (no `meta` wrapper) must degrade exactly like an
      // unanswerable meta route — a daemon that cannot answer is never accused of an
      // unseeded store.
      .then(({ meta: m }) => setMeta(m ?? null))
      .catch(() => setMeta(null));
  }, [loadRules]);

  // A filter change is a NAVIGATION between views: page-local UI state resets with it (the grid's
  // facets reset via its `key={type}` remount below). The dock deliberately does NOT remount — its
  // thread survives the walk across filters; the verbs close over the CURRENT type on every render.
  useEffect(() => {
    setSelectedId(null);
    setEditing(null);
    setSavedNote(null);
    setRetiredNote(null);
    setCommitError(null);
  }, [type]);

  // `?rule=<id>` deep-links a rule's drawer open (the Evals gap rows and the failure banner link
  // here). It opens the drawer regardless of the active type filter — a rule filed under a
  // neighbouring type still opens, exactly as the eval-sample link intends. Declared AFTER the
  // filter-reset effect so a navigation carrying both a new filter and a rule id lands with the
  // drawer open.
  useEffect(() => {
    const routed = new URLSearchParams(search).get('rule');
    if (routed !== null && rules.some((r) => r.id === routed)) setSelectedId(routed);
  }, [search, rules]);

  /** evidence_count join: the AW-23 per-rule evidence rows, when the scoreboard is served. */
  const evidenceOf = (id: string): { denial_claims: number; governs_evidence: number } | null => {
    if (scoreboard.kind !== 'loaded') return null;
    const row = scoreboard.scoreboard.evidence.per_rule.find((r) => r.rule_id === id);
    return row ?? { denial_claims: 0, governs_evidence: 0 };
  };

  const onRetired = (rule: SteeringRule, reason: string): void => {
    setRetiredNote({ id: rule.id, reason });
    // Reload so the row shows the SERVER's state, never this surface's optimism.
    void loadRules();
  };

  /**
   * After ANY save (cell commit, draft row, edit modal): reload for the server's answer and
   * say where it actually filed the rule — the engine-drop honesty note when the server
   * ignored the intended type, the plain move note when the OPERATOR retyped it off this page.
   */
  const afterSaved = useCallback((id: string, intended: SteeringType): void => {
    void loadRules().then((rs) => {
      const saved = rs.find((r) => r.id === id);
      const landed = saved === undefined ? null : steeringTypeOf(saved);
      if (landed !== null && landed !== intended) {
        // The honesty check: an older engine SILENTLY DROPS the unified fields (no
        // deny_unknown_fields on ConformanceRule), so a rule saved for one type can come back
        // filed under the serde default. Say where the server actually put it.
        setSavedNote(
          `Saved ${id} — but this daemon's engine predates steering_type, so the server filed it under ${STEERING_TYPE_LABELS[landed]}.`,
        );
      } else if (landed !== null && type !== null && landed !== type) {
        setSavedNote(`Saved ${id} — filed under ${STEERING_TYPE_LABELS[landed]}; it lives under that filter now.`);
      } else {
        setSavedNote(`Saved ${id}.`);
      }
    });
  }, [loadRules, type]);

  const onSaved = (id: string): void => {
    setEditing(null);
    afterSaved(id, pageType);
  };

  /** A grid cell commit: OPTIMISTIC apply, per-row revert on error, server reload on success. */
  const commitRule = (next: SteeringRule, prev: SteeringRule): void => {
    setCommitError(null);
    setSavedNote(null);
    setRules((cur) => cur.map((r) => (r.id === prev.id ? next : r)));
    void api
      .upsertConformanceRule(next)
      .then(() => afterSaved(next.id, steeringTypeOf(next)))
      .catch((e: unknown) => {
        // Revert exactly the one row — the server refused, the sheet must not lie.
        setRules((cur) => cur.map((r) => (r.id === prev.id ? prev : r)));
        setCommitError(`${next.id}: ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  /** The draft row's save — the grid clears the draft when this resolves. */
  const createRule = async (rule: SteeringRule): Promise<void> => {
    await api.upsertConformanceRule(rule);
    afterSaved(rule.id, steeringTypeOf(rule));
  };

  // ── The assist dock's Steering binding (DES-ASSIST-DOCK §3) ────────────────────────────────
  const dockVerbs: AssistVerbs = useMemo(() => ({
    send: async (text, documents) => {
      try {
        return await authorSteeringRules({
          instructions: text,
          type: pageType,
          ...(documents.length > 0 ? { documents } : {}),
        });
      } catch (e) {
        throw isSteeringUnsupported(e) ? new Error(STEERING_UNSUPPORTED_COPY) : e;
      }
    },
    importDirect: async (doc) => {
      // .md = one doc entry through the MarkdownAdapter path; .json = a rule batch,
      // each object its own entry so a half-good batch reports per rule.
      let entries;
      try {
        entries = doc.name.toLowerCase().endsWith('.json')
          ? (JSON.parse(doc.content) as Record<string, unknown>[]).map((rule) => ({ kind: 'rule' as const, rule }))
          : [{ kind: 'doc' as const, name: doc.name, content: doc.content }];
      } catch {
        return [{ tone: 'fail', text: `${doc.name} is not valid JSON — fix the batch or attach it for analysis instead.` }];
      }
      try {
        const { results } = await importSteeringRules({ type: pageType, entries });
        void loadRules();
        const outcomes = results.map((r) => importEntryOutcome(r));
        const ok = outcomes.filter((o) => o.ok).length;
        const notes: AssistNote[] = [
          { tone: ok === outcomes.length ? 'work' : 'gate', text: `${doc.name}: ${ok} of ${outcomes.length} entr${outcomes.length === 1 ? 'y' : 'ies'} imported.` },
          ...outcomes.map((o): AssistNote => ({ tone: o.ok ? 'work' : 'fail', text: o.text })),
        ];
        return notes;
      } catch (e) {
        if (isSteeringUnsupported(e)) return [{ tone: 'gate', text: STEERING_UNSUPPORTED_COPY }];
        throw e;
      }
    },
    onRunResolved: () => {
      void loadRules();
    },
  }), [pageType, loadRules]);

  // The id alone selects (no type gate): the filter-change effect above already resets a stale
  // selection, and a `?rule=` deep link may name a rule filed under a neighbouring type — the
  // drawer must still open for it.
  const selected = selectedId === null
    ? null
    : rules.find((r) => r.id === selectedId) ?? null;

  // The EMPTY-STORE state keys on an EXPLICIT `seeded: false` from the meta route — a daemon
  // that cannot answer must not be accused of an unseeded store. It does NOT replace the Add
  // menu: the draft row and the assistant are exactly how a store gets seeded from here, so
  // the banner names both ways in.
  const unseeded = meta !== null && meta.seeded === false && rules.length === 0 && !rulesLoading;

  // `?usage=unused` (the usage band's click-through): filter the grid to the ACTIVE rules the
  // enforcement record never cites (per_rule: denial_claims + governs_evidence == 0). Computable
  // only when the scoreboard is served — otherwise the page SAYS so and the grid stays
  // unfiltered, never a silently empty sheet.
  const usageFilterAsked = new URLSearchParams(search).get('usage') === 'unused';
  const unusedIds =
    usageFilterAsked && scoreboard.kind === 'loaded'
      ? ruleUsage(rules, scoreboard.scoreboard.evidence.per_rule).unusedIds
      : null;

  /** Where the `Show all` link in the usage-filter note points — the current filter, usage cleared. */
  const clearUsageHref = policiesPath(type);

  return (
    <div
      data-testid="steering-page"
      data-steering-type={type ?? 'all'}
      className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      {/* The page column — scrolls on its own; the GRID additionally scrolls horizontally
          inside its container, so grid + dock coexist at 1440×700 with zero page-level
          horizontal scroll. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <div className="flex items-start gap-2">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Steering · Policies</h2>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              The governance surface — the seven-type steering-rule corpus. Filter by type and manage
              rules inline. Agent-proposed policies are reviewed in the governed-knowledge dashboard.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadRules()}
            className="ml-auto text-[10px] hover:underline"
            style={{ color: 'var(--ink-dim)' }}
          >
            Refresh
          </button>
        </div>

        {/* The type FILTER — `All` + the seven types, the collapse of the old seven cards/pages. */}
        {rulesError === null && (
          <SteeringTypeFilter rules={rules} activeType={type} navigate={navigate} />
        )}

        {rulesLoading && rules.length === 0 ? (
          <p data-testid="steering-rules-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading rules…</p>
        ) : rulesError !== null ? (
          <p data-testid="steering-rules-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {rulesError}
          </p>
        ) : (
          <>
            {/* Health: store-wide (verdict + usage band) in the `All` view — the one place the
                store-wide numbers are actionable; TYPE-scoped numbers on a filtered view. */}
            {type === null ? (
              <>
                <SteeringStoreHealth state={scoreboard} />
                <SteeringUsageBand runs={runs} rules={rules} scoreboard={scoreboard} navigate={navigate} />
              </>
            ) : (
              <SteeringHealth
                state={scoreboard}
                type={type}
                typeRuleCount={rules.filter((r) => steeringTypeOf(r) === type).length}
              />
            )}

            {unseeded && (
              <div
                data-testid="steering-unseeded"
                className="flex flex-col gap-2 rounded p-4"
                style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
              >
                <p className="text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>
                  No steering rules seeded yet.
                </p>
                <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  Add a row, or open the assistant to import a doctrine doc or author with chat — or
                  run the seed runbook at{' '}
                  <a href={SEED_RUNBOOK_URL} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent)' }}>
                    {SEED_RUNBOOK_PATH}
                  </a>:
                </p>
                <code
                  data-testid="steering-seed-command"
                  className="overflow-x-auto whitespace-pre rounded px-2 py-1.5 font-mono text-[10px]"
                  style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
                >
                  {SEED_COMMAND}
                </code>
              </div>
            )}

            {/* ONE Add menu — two entries: the grid's draft row, and the assist dock
                (import / add-with-chat live THERE). */}
            <SteeringAddMenu
              key={`add-${type ?? 'all'}`}
              onAddRow={() => setAddTick((t) => t + 1)}
              onOpenAssistant={() => setDockOpen(true)}
            />

            {usageFilterAsked && (
              <p
                data-testid="steering-usage-filter-note"
                className="rounded px-3 py-2 text-[11px]"
                style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
              >
                {unusedIds !== null ? (
                  <>
                    Showing the {unusedIds.length} rule{unusedIds.length === 1 ? '' : 's'} the enforcement
                    record never cites (no denial claims, no governs evidence).{' '}
                  </>
                ) : (
                  <>
                    This daemon does not serve the governance scoreboard, so &ldquo;unused&rdquo; cannot be
                    computed — showing all rules.{' '}
                  </>
                )}
                <a
                  data-testid="steering-usage-filter-clear"
                  href={clearUsageHref}
                  onClick={(e) => { e.preventDefault(); navigate(clearUsageHref); }}
                  className="underline"
                  style={{ color: 'var(--accent)' }}
                >
                  Show all
                </a>
              </p>
            )}

            {savedNote !== null && (
              <p
                data-testid="steering-saved-note"
                className="rounded px-3 py-2 text-[11px]"
                style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
              >
                {savedNote}
              </p>
            )}

            {commitError !== null && (
              <p
                data-testid="steering-commit-error"
                className="rounded px-3 py-2 text-[11px]"
                style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}
              >
                {commitError} — the cell reverted to the server&rsquo;s value.
              </p>
            )}

            {retiredNote !== null && (
              <p
                data-testid="steering-retired-note"
                className="rounded px-3 py-2 text-[11px]"
                style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
              >
                Retired <span className="font-mono">{retiredNote.id}</span> — withdrawn from recall and
                enforcement; the record stays listed. Your reason, for the doc PR if this rule came from
                one: <em>&ldquo;{retiredNote.reason}&rdquo;</em>
              </p>
            )}

            {!unseeded && (
              <SteeringGrid
                key={`grid-${type ?? 'all'}`}
                rules={rules}
                type={type ?? 'all'}
                loading={rulesLoading}
                error={rulesError}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
                onCommit={commitRule}
                onCreate={createRule}
                onRetired={onRetired}
                addRequestTick={addTick}
                idFilter={unusedIds}
              />
            )}
          </>
        )}
      </div>

      {/* The assist dock — v1 of the app-wide right panel (DES-ASSIST-DOCK). */}
      <AssistDock
        context={{
          surface: 'steering',
          title: 'Assistant',
          contextLabel: `Steering · ${type === null ? 'Policies' : STEERING_TYPE_LABELS[type]}`,
          placeholder: `Describe the ${STEERING_TYPE_LABELS[pageType]} rules to author…`,
          hint: 'A message launches a governed authoring run: it reads what you attach, drafts '
            + `${STEERING_TYPE_LABELS[pageType]} steering rules, and stops at a propose gate — nothing `
            + 'is written until you approve it here. Drop .md/.json rule files to import them directly.',
        }}
        verbs={dockVerbs}
        importable={(name) => /\.(md|markdown|json)$/i.test(name)}
        open={dockOpen}
        onOpenChange={setDockOpen}
      />

      {selected !== null && (
        <SteeringRuleDrawer
          rule={selected}
          evidence={evidenceOf(selected.id)}
          onClose={() => setSelectedId(null)}
          onEdit={setEditing}
          onRetired={onRetired}
        />
      )}

      {editing !== null && (
        <SteeringRuleFormModal
          type={pageType}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
