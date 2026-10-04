import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { RULES_PATH, rulePath } from '../../api/decisions.js';
import { policiesPath, steeringTypeOf, type SteeringRule } from '../../api/steering.js';
import type { SessionView } from '../../api/types.js';
import { ruleSentence } from '../../board/ruleOrigin.js';
import { GROUP_LABELS, GROUP_ORDER, groupOf, landedWithoutProject, orderRules, rulesSentence, type RulesGroup } from '../../board/rulesPage.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useProjectsStore } from '../../store/projects.js';
import { SteeringRuleDrawer } from '../SteeringRuleDrawer.js';
import { SteeringRuleFormModal } from '../SteeringRuleForm.js';

type Read = { kind: 'loading' } | { kind: 'ok'; rules: SteeringRule[] } | { kind: 'failed'; message: string };

/**
 * THE RULES PAGE (`/rules`, `/rules/:ruleId`; DES-STUDIO-REBUILD-001 §5.4, slice S12): decision
 * capture PLACED. Crew's rules as sentences, grouped — from your words (DC), testing rules (WT),
 * other — newest first, retired last; one line says what is in force. A rule opens on its own
 * address as DC's components, the same drawer the steering grid shows (scope and effect as one
 * sentence, ORIGIN, history, where it was considered — DC §3 B11); "Hold work to it" appears only
 * where that drawer already renders it (a testing rule, WT-U2) — this page adds none of its own.
 * Every DC line that names a rule lands here (`rulePath`). The steering grid stays one link away
 * as "All rules". A route for every skin; no rule model is derived in this repo.
 *
 * A failed read says so with Try again and is never shown as "no rules"; a rule the daemon does
 * not list is said to be missing while the rest of the page stands.
 */
export function RulesPage({ ruleId, runs, navigate }: {
  /** The rule open on the page (`/rules/:ruleId`), or null on `/rules`. */
  ruleId: string | null;
  /** The app's runs — the drawer's "Where it was considered" looks into recent steps. */
  runs: SessionView[];
  navigate: Navigate;
}): React.ReactElement {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [editing, setEditing] = useState<SteeringRule | null>(null);
  const projects = useProjectsStore((s) => s.projects);
  const projectName = (id: string | undefined): string | null => (id === undefined ? null : projects.find((p) => p.id === id)?.name ?? null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const { rules } = await api.listConformanceRules();
      setRead({ kind: 'ok', rules: rules as SteeringRule[] });
    } catch (e) {
      setRead({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const rules = read.kind === 'ok' ? read.rules : [];
  const ordered = orderRules(rules);
  const open = ruleId === null ? null : rules.find((r) => r.id === ruleId) ?? null;
  const live = ordered.filter((r) => r.retired !== true);
  const retired = ordered.filter((r) => r.retired === true);

  const row = (r: SteeringRule): React.ReactElement => (
    <li key={r.id} data-testid="rules-row" data-rule-id={r.id} data-group={groupOf(r)} data-retired={r.retired === true} className="wk-rules-row">
      <a href={rulePath(r.id)} onClick={go(rulePath(r.id))} data-testid="rules-row-open" className="wk-rules-statement">{r.statement}</a>
      <span data-testid="rules-row-line" className="wk-rules-line">{ruleSentence(r, projectName(r.targets.project))}</span>
      {landedWithoutProject(r) && (
        <span data-testid="rules-row-aside" className="wk-rules-aside">Landed without its project — it applies everywhere until you scope it on the grid.</span>
      )}
    </li>
  );

  const group = (g: RulesGroup | 'retired', label: string, rows: SteeringRule[]): React.ReactElement | null => (rows.length === 0 ? null : (
    <section key={g} data-testid="rules-group" data-group={g} aria-label={label} className="wk-rules-group">
      <p className="wk-desk-label">{label}</p>
      <ul className="wk-rules-list">{rows.map(row)}</ul>
    </section>
  ));

  return (
    <div data-testid="rules-page" data-object="rules" className="wk-rules">
      <header className="wk-rules-head">
        <h1 className="wk-session-title">Rules</h1>
        {read.kind === 'loading' && <p data-testid="rules-loading" aria-busy="true" className="wk-session-status">Reading the rules…</p>}
        {read.kind === 'failed' && (
          <p data-testid="rules-error" className="wk-session-status">
            Could not read the rules — {read.message}.{' '}
            <button type="button" data-testid="rules-retry" onClick={() => { setRead({ kind: 'loading' }); void load(); }} className="wk-since-toggle">Try again</button>
          </p>
        )}
        {read.kind === 'ok' && <p data-testid="rules-sentence" data-count={live.length} className="wk-session-status">{rulesSentence(rules)}</p>}
      </header>
      <div className="wk-rules-body">
        {read.kind === 'ok' && ruleId !== null && open === null && (
          <p data-testid="rules-missing" className="wk-desk-quiet">
            No rule <span className="font-mono">{ruleId}</span> here — it may have been removed, or it lives on another daemon.
          </p>
        )}
        {GROUP_ORDER.map((g) => group(g, GROUP_LABELS[g], live.filter((r) => groupOf(r) === g)))}
        {group('retired', 'Retired', retired)}
        <p className="wk-desk-more">
          <a href={policiesPath()} onClick={go(policiesPath())} data-testid="rules-all" className="wk-desk-more">All rules → the full grid, with import and the assistant</a>
        </p>
      </div>

      {open !== null && (
        <SteeringRuleDrawer
          rule={open}
          evidence={null}
          onClose={() => navigate(RULES_PATH)}
          onEdit={setEditing}
          onRetired={() => { void load(); }}
          runs={runs}
          navigate={navigate}
          onHeld={() => { void load(); }}
        />
      )}
      {editing !== null && (
        <SteeringRuleFormModal
          type={steeringTypeOf(editing)}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}
