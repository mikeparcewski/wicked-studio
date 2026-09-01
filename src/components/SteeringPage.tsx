import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import {
  authorSteeringRules,
  importSteeringRules,
  importEntryOutcome,
  isSteeringUnsupported,
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
import { AssistDock, useAssistDockOpen, type AssistNote, type AssistVerbs } from './AssistDock.js';
import { SteeringAddMenu } from './SteeringAddMenu.js';
import { SteeringGrid } from './SteeringGrid.js';
import { SteeringHealth, SteeringStoreHealth, type ScoreboardState } from './SteeringHealth.js';
import { SteeringRuleDrawer } from './SteeringRuleDrawer.js';
import { SteeringRuleFormModal } from './SteeringRuleForm.js';
import { SteeringTypeCards } from './SteeringTypeCards.js';

/**
 * The Steering surface after the SPREADSHEET wave (round-3 operator steer: "steering should be
 * treated like a spreadsheet … with a right panel that lets you add data by chatting or
 * analysis of docs or uploading directly"):
 *
 *  - `/steering` (type === null) — the LANDING, unchanged: a calm grid of seven compact type
 *    cards, each carrying that type's rule count from the ONE rules fetch.
 *  - `/steering/:type` — the rule GRID (SteeringGrid): an editable spreadsheet over the common
 *    columns, per-row saves on the SHIPPING upsert wire (optimistic here, reverted on error,
 *    the server's answer reloaded — the "where the server filed it" honesty note included),
 *    add = a draft row, remove = the retire kill switch. The ADVANCED fields stay in the
 *    DRAWER a row's id cell opens.
 *  - The ASSIST DOCK (AssistDock — v1 of the app-wide panel, DES-ASSIST-DOCK) sits beside the
 *    grid: a typed message launches the governed steering-author run for THIS page's type and
 *    narrates inline; rule-shaped attachments fork import-directly vs analyze-with-chat.
 *
 * Every management write still goes through crew's API (the governed operator path) — estate
 * MCP stays read-only (AW-11).
 */

export function SteeringPage({ type, navigate, search = '' }: {
  /** The routed steering type — null on the bare `/steering` landing. */
  type: SteeringType | null;
  navigate: (path: string) => void;
  /** The URL search string — `?rule=<id>` deep-links a rule's drawer open
   *  (the Evals gap rows link here, qe finding: hints became links). */
  search?: string;
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

  // Type change is a NAVIGATION between sub-pages: page-local UI state resets with it
  // (the grid's facets reset via its `key={type}` remount below). The dock deliberately
  // does NOT remount — its thread survives the walk across type pages; the verbs close
  // over the CURRENT type on every render.
  useEffect(() => {
    setSelectedId(null);
    setEditing(null);
    setSavedNote(null);
    setRetiredNote(null);
    setCommitError(null);
  }, [type]);

  // `?rule=<id>` deep-links a rule's drawer open (the Evals gap rows link
  // here). Declared AFTER the type-reset effect so a cross-page navigation
  // that carries both a new type and a rule id lands with the drawer open.
  useEffect(() => {
    const routed = new URLSearchParams(search).get('rule');
    if (routed !== null && rules.some((r) => r.id === routed)) setSelectedId(routed);
  }, [search, rules]);

  // A `?rule=<id>` deep link on the LANDING (the failure banner links here because a rule id
  // alone does not name its type page): once rules load, resolve the id to its type and land on
  // that page with the drawer open. Unknown ids stay on the landing — no dead redirect.
  useEffect(() => {
    if (type !== null || rulesLoading || rulesError !== null) return;
    const routed = new URLSearchParams(search).get('rule');
    if (routed === null) return;
    const hit = rules.find((r) => r.id === routed);
    if (hit !== undefined) navigate(`/steering/${steeringTypeOf(hit)}?rule=${encodeURIComponent(routed)}`);
  }, [type, search, rules, rulesLoading, rulesError, navigate]);

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
        setSavedNote(`Saved ${id} — filed under ${STEERING_TYPE_LABELS[landed]}; it lives on that page now.`);
      } else {
        setSavedNote(`Saved ${id}.`);
      }
    });
  }, [loadRules, type]);

  const onSaved = (id: string): void => {
    setEditing(null);
    afterSaved(id, type ?? 'architecture');
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
  const pageType: SteeringType = type ?? 'architecture';
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

  // ── The landing (`/steering`) — the calm grid, nothing else open by default ─────────────────
  if (type === null) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div data-testid="steering-landing" className="flex max-w-5xl flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Steering</h2>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              The governance surface — one steering-rule model across seven types. Pick a type to
              browse and manage its rules.
            </p>
          </div>
          {/* The store-wide verdict lives HERE, the one place it is actionable
              (review #5) — its raw diagnostics fold behind a details toggle. */}
          <SteeringStoreHealth state={scoreboard} />
          {rulesLoading ? (
            <p data-testid="steering-rules-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading rules…</p>
          ) : rulesError !== null ? (
            <p data-testid="steering-rules-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
              {rulesError}
            </p>
          ) : (
            <SteeringTypeCards rules={rules} navigate={navigate} />
          )}
        </div>
      </div>
    );
  }

  // ── A type page (`/steering/:type`) — the grid + the dock ──────────────────────────────────

  // The id alone selects (no type gate): the type-change effect above already
  // resets a stale selection, and a `?rule=` deep link may name a rule filed
  // under a neighbouring type — the drawer must still open for it.
  const selected = selectedId === null
    ? null
    : rules.find((r) => r.id === selectedId) ?? null;

  // The EMPTY-STORE state keys on an EXPLICIT `seeded: false` from the meta route — a daemon
  // that cannot answer must not be accused of an unseeded store. It does NOT replace the Add
  // menu: the draft row and the assistant are exactly how a store gets seeded from here, so
  // the banner names both ways in.
  const unseeded = meta !== null && meta.seeded === false && rules.length === 0 && !rulesLoading;

  return (
    <div
      data-testid="steering-page"
      data-steering-type={type}
      className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      {/* The page column — scrolls on its own; the GRID additionally scrolls horizontally
          inside its container, so grid + dock coexist at 1440×700 with zero page-level
          horizontal scroll. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <div className="flex items-center gap-2">
          {/* The breadcrumb back to the landing — the seven-tab strip retired with it. */}
          <a
            data-testid="steering-breadcrumb"
            href="/steering"
            onClick={(e) => { e.preventDefault(); navigate('/steering'); }}
            className="text-sm font-semibold hover:underline"
            style={{ color: 'var(--ink-muted)', textDecoration: 'none' }}
          >
            Steering
          </a>
          <span aria-hidden className="text-sm" style={{ color: 'var(--ink-dim)' }}>›</span>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>
            {STEERING_TYPE_LABELS[type]}
          </h2>
          <button
            type="button"
            onClick={() => void loadRules()}
            className="ml-auto text-[10px] hover:underline"
            style={{ color: 'var(--ink-dim)' }}
          >
            Refresh
          </button>
        </div>

        {/* TYPE-scoped numbers only (review #5); an empty type page renders no
            stats at all — the store-wide verdict + diagnostics live on the
            landing, where they are actionable. */}
        <SteeringHealth
          state={scoreboard}
          type={type}
          typeRuleCount={rules.filter((r) => steeringTypeOf(r) === type).length}
        />

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

        {/* ONE Add menu — two entries now: the grid's draft row, and the assist dock
            (import / add-with-chat live THERE). */}
        <SteeringAddMenu
          key={`add-${type}`}
          onAddRow={() => setAddTick((t) => t + 1)}
          onOpenAssistant={() => setDockOpen(true)}
        />

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
            key={`grid-${type}`}
            rules={rules}
            type={type}
            loading={rulesLoading}
            error={rulesError}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
            onCommit={commitRule}
            onCreate={createRule}
            onRetired={onRetired}
            addRequestTick={addTick}
          />
        )}
      </div>

      {/* The assist dock — v1 of the app-wide right panel (DES-ASSIST-DOCK). */}
      <AssistDock
        context={{
          surface: 'steering',
          title: 'Assistant',
          contextLabel: `Steering · ${STEERING_TYPE_LABELS[type]}`,
          placeholder: `Describe the ${STEERING_TYPE_LABELS[type]} rules to author…`,
          hint: 'A message launches a governed authoring run: it reads what you attach, drafts '
            + `${STEERING_TYPE_LABELS[type]} steering rules, and stops at a propose gate — nothing `
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
          type={type}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
