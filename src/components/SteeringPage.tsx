import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import {
  STEERING_TYPE_LABELS,
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
import { SteeringAddMenu } from './SteeringAddMenu.js';
import { SteeringHealth, SteeringStoreHealth, type ScoreboardState } from './SteeringHealth.js';
import { SteeringRuleDrawer } from './SteeringRuleDrawer.js';
import { SteeringRuleFormModal } from './SteeringRuleForm.js';
import { SteeringRuleList } from './SteeringRuleList.js';
import { SteeringTypeCards } from './SteeringTypeCards.js';

/**
 * The Steering surface — a SHELL now (the steering-UX wave: "it's a lot to look at" → a calm
 * landing + on-demand management), presentation only over the SAME wires as before:
 *
 *  - `/steering` (type === null) — the LANDING: a calm grid of seven compact type cards, each
 *    carrying that type's rule count from the ONE rules fetch (counted client-side); nothing
 *    else renders by default.
 *  - `/steering/:type` — a clean rule LIST (severity chip · id · one-line statement · weight
 *    when non-default), the AW-23 health header (per-type when served, the honest 501 callout
 *    when the engine predates the scoreboard), and ONE "Add" menu holding the three management
 *    flows (individual form / import / add-with-chat), each opening on demand.
 *  - A row click opens the rule DRAWER — full statement, provenance, applies_to/excludes/
 *    weight/effect, evidence, and the retire/edit actions — everything that used to crowd the
 *    page inline.
 *
 * The pieces live in their own components (SteeringTypeCards, SteeringRuleList,
 * SteeringRuleDrawer, SteeringAddMenu, SteeringRuleForm, SteeringImportPanel,
 * SteeringAuthorPanel, SteeringHealth); this shell owns the data loads and the cross-piece
 * state. Every management write still goes through crew's API (the governed operator path) —
 * estate MCP stays read-only (AW-11).
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
  // (the rule list's facets reset via its `key={type}` remount below).
  useEffect(() => {
    setSelectedId(null);
    setEditing(null);
    setSavedNote(null);
    setRetiredNote(null);
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

  const onSaved = (id: string): void => {
    setEditing(null);
    void loadRules().then((rs) => {
      // The honesty check: an older engine SILENTLY DROPS the unified fields (no
      // deny_unknown_fields on ConformanceRule), so a rule saved for this page can come back
      // filed under the serde default. Say where the server actually put it.
      const saved = rs.find((r) => r.id === id);
      const landed = saved === undefined ? null : steeringTypeOf(saved);
      if (type !== null && landed !== null && landed !== type) {
        setSavedNote(
          `Saved ${id} — but this daemon's engine predates steering_type, so the server filed it under ${STEERING_TYPE_LABELS[landed]}.`,
        );
      } else {
        setSavedNote(`Saved ${id}.`);
      }
    });
  };

  // ── The landing (`/steering`) — the calm grid, nothing else open by default ─────────────────
  if (type === null) {
    return (
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
    );
  }

  // ── A type page (`/steering/:type`) ─────────────────────────────────────────────────────────

  // The id alone selects (no type gate): the type-change effect above already
  // resets a stale selection, and a `?rule=` deep link may name a rule filed
  // under a neighbouring type — the drawer must still open for it.
  const selected = selectedId === null
    ? null
    : rules.find((r) => r.id === selectedId) ?? null;

  // The EMPTY-STORE state keys on an EXPLICIT `seeded: false` from the meta route — a daemon
  // that cannot answer must not be accused of an unseeded store. It does NOT replace the Add
  // menu: import/add/author are exactly how a store gets seeded from here, so the banner names
  // both ways in.
  const unseeded = meta !== null && meta.seeded === false && rules.length === 0 && !rulesLoading;

  return (
    <div data-testid="steering-page" data-steering-type={type} className="flex max-w-5xl flex-col gap-4">
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
            Import a doctrine doc, add a rule, or author with chat right here — or run the seed
            runbook at{' '}
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

      {/* ONE Add menu — the three management flows, each opening on demand. Every flow writes
          through crew's API, typed from THIS page. */}
      <SteeringAddMenu
        key={`add-${type}`}
        type={type}
        rules={rules}
        onSaved={onSaved}
        onRulesChanged={() => { void loadRules(); }}
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
        <SteeringRuleList
          key={`list-${type}`}
          rules={rules}
          type={type}
          loading={rulesLoading}
          error={rulesError}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
        />
      )}

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
          rules={rules}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
