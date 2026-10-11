import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { RULES_PATH, rulePath } from '../../api/decisions.js';
import { policiesPath, STEERING_TYPE_LABELS, steeringTypeOf, type SteeringRule } from '../../api/steering.js';
import { readErrorKind } from '../../api/errors.js';
import { Skeleton, StateBanner, TechDetails } from '../ui/index.js';
import type { SessionView } from '../../api/types.js';
import { ruleSentence } from '../../board/ruleOrigin.js';
import { GROUP_LABELS, GROUP_ORDER, groupOf, orderRules, rulesSentence, type RulesGroup } from '../../board/rulesPage.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useProjectsStore } from '../../store/projects.js';
import { SteeringRuleDrawer } from '../SteeringRuleDrawer.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { SteeringRuleFormModal } from '../SteeringRuleForm.js';

type Read = { kind: 'loading' } | { kind: 'ok'; rules: SteeringRule[] } | { kind: 'failed'; message: string; error: unknown };

const SEVERITY_WORD: Record<string, string> = { info: 'Info', warn: 'Warning', error: 'Error', critical: 'Critical' };

/** What a rule does when it fires, as one short tag (the full sentence stays the tags' title). */
function effectWord(r: SteeringRule): string {
  switch (r.effect) {
    case 'deny': return 'Blocks';
    case 'allow_with_conditions': return 'Adds conditions';
    case 'allow': return 'Allows';
    case undefined: return 'Guidance';
    default: return String(r.effect);
  }
}

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
 * not list is said to be missing while the rest of the page stands. Reads commit in order (a
 * reload after Hold or Retire is never overwritten by an older read; StrictMode replays the mount
 * read); the drawer is the addressed rule's (keyed by it) and the editor closes when the address
 * changes — a save that completes late closes only the opening that started it, never a later editor
 * (even of the same rule). DC §5.2's "landed without its project"
 * is NOT said here: the rule alone cannot tell a legacy global landing from one the operator
 * scoped `everywhere` or widened — that needs a crew marker.
 */
export function RulesPage({ ruleId, runs, navigate }: {
  /** The rule open on the page (`/rules/:ruleId`), or null on `/rules`. */
  ruleId: string | null;
  /** The app's runs — the drawer's "Where it was considered" looks into recent steps. */
  runs: SessionView[];
  navigate: Navigate;
}): React.ReactElement {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  /** The open editor: the rule and this OPENING's token — a save that completes after Cancel and a reopen
   *  (even of the same rule) belongs to an older opening and closes nothing. */
  const [editing, setEditing] = useState<{ rule: SteeringRule; token: number } | null>(null);
  const opened = useRef(0);
  const edit = (r: SteeringRule): void => setEditing({ rule: r, token: ++opened.current });
  /** The newest read's number: an older read that answers later commits nothing. */
  const seq = useRef(0);
  const projects = useProjectsStore((s) => s.projects);
  const projectName = (id: string | undefined): string | null => (id === undefined ? null : projects.find((p) => p.id === id)?.name ?? null);

  const load = useCallback(async (): Promise<void> => {
    const mine = ++seq.current;
    try {
      const { rules } = await api.listConformanceRules();
      if (mine === seq.current) setRead({ kind: 'ok', rules: rules as SteeringRule[] });
    } catch (e) {
      if (mine === seq.current) setRead({ kind: 'failed', message: e instanceof Error ? e.message : String(e), error: e });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // The address changed (Back, another rule, the list): whatever editor was open belonged to the old one.
  useEffect(() => { setEditing(null); }, [ruleId]);

  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const rules = read.kind === 'ok' ? read.rules : [];
  const ordered = orderRules(rules);
  const open = ruleId === null ? null : rules.find((r) => r.id === ruleId) ?? null;
  const live = ordered.filter((r) => r.retired !== true);
  const retired = ordered.filter((r) => r.retired === true);

  const row = (r: SteeringRule): React.ReactElement => (
    <li key={r.id} data-testid="rules-row" data-rule-id={r.id} data-group={groupOf(r)} data-retired={r.retired === true} className="wk-rules-row">
      <a href={rulePath(r.id)} onClick={go(rulePath(r.id))} data-testid="rules-row-open" className="wk-rules-statement" title={r.statement}>{r.statement}</a>
      {/* studio#689 row 46: type, scope and effect as tags, not the same sentence under every rule;
          the sentence stays as the tags' accessible description. */}
      <span data-testid="rules-row-line" data-sentence={ruleSentence(r, projectName(r.targets.project) ?? 'one project')} title={ruleSentence(r, projectName(r.targets.project) ?? 'one project')} className="wk-rules-tags">
        <span className="wk-tag">{STEERING_TYPE_LABELS[steeringTypeOf(r)] ?? steeringTypeOf(r)}</span>
        {r.targets.project !== undefined && r.targets.project !== '' ? (
          <span className="wk-tag" title={projectName(r.targets.project) === null ? 'A project that is no longer listed' : undefined}>{projectName(r.targets.project) ?? 'One project'}</span>
        ) : <span className="wk-tag">Everywhere</span>}
        <span className={`wk-tag${r.effect === 'deny' ? ' wk-tag--fail' : r.effect === 'allow_with_conditions' ? ' wk-tag--gate' : ''}`}>{effectWord(r)}</span>
        {r.severity !== undefined && r.severity !== 'info' && (
          <span className={`wk-tag${r.severity === 'critical' || r.severity === 'error' ? ' wk-tag--fail' : ' wk-tag--warn'}`}>{SEVERITY_WORD[r.severity] ?? r.severity}</span>
        )}
      </span>
      {r.statement.length > 160 && (
        <a href={rulePath(r.id)} onClick={go(rulePath(r.id))} data-testid="rules-row-more" className="wk-link wk-rules-more">Read the full rule</a>
      )}
    </li>
  );

  const group = (g: RulesGroup | 'retired', label: string, rows: SteeringRule[]): React.ReactElement | null => (rows.length === 0 ? null : (
    <section key={g} data-testid="rules-group" data-group={g} aria-label={label} className="wk-rules-group">
      <h2 className="wk-section-title">{label}</h2>
      <ul className="wk-rules-list">{rows.map(row)}</ul>
    </section>
  ));

  return (
    <div data-testid="rules-page" data-object="rules" className="wk-rules">
      <header className="wk-page-head wk-rules-head">
        <div className="wk-page-head-text">
          <h1 className="wk-page-title">{PAGE_NAMES.steering}</h1>
          <p className="wk-page-intro">What helpers are told to follow. Open a rule to see where it came from and where it applied.</p>
          {read.kind === 'ok' && <p data-testid="rules-sentence" data-count={live.length} className="wk-rules-count">{rulesSentence(rules)}</p>}
        </div>
        <div className="wk-page-actions">
          <a href={policiesPath()} onClick={go(policiesPath())} data-testid="rules-manage" className="wk-btn wk-btn--secondary wk-btn--sm">Manage rules</a>
        </div>
      </header>
      {read.kind === 'loading' && <div data-testid="rules-loading" className="wk-rules-state"><Skeleton rows={5} /></div>}
      {read.kind === 'failed' && (
        <div className="wk-rules-state">
          <StateBanner
            data-testid="rules-error"
            kind={readErrorKind(read.error)}
            what="the rules"
            error={read.message}
            onRetry={() => { setRead({ kind: 'loading' }); void load(); }}
          />
        </div>
      )}
      <div className="wk-rules-body">
        {read.kind === 'ok' && ruleId !== null && open === null && (
          <p data-testid="rules-missing" className="wk-desk-quiet">
            That rule isn&rsquo;t here; it may have been removed.
            <TechDetails text={ruleId} summary="Rule id" />
          </p>
        )}
        {GROUP_ORDER.map((g) => group(g, GROUP_LABELS[g], live.filter((r) => groupOf(r) === g)))}
        {group('retired', 'Retired', retired)}
        <p className="wk-desk-more">
          <a href={policiesPath()} onClick={go(policiesPath())} data-testid="rules-all" className="wk-link">Manage rules: edit, import or draft rules with the assistant</a>
        </p>
      </div>

      {open !== null && (
        <SteeringRuleDrawer
          key={open.id}
          rule={open}
          evidence={null}
          onClose={() => navigate(RULES_PATH)}
          onEdit={edit}
          onRetired={() => { void load(); }}
          runs={runs}
          navigate={navigate}
          onHeld={() => { void load(); }}
        />
      )}
      {editing !== null && (
        <SteeringRuleFormModal
          key={editing.token}
          type={steeringTypeOf(editing.rule)}
          initial={editing.rule}
          onClose={() => setEditing(null)}
          // A save that completes late (the address moved on; Cancel and a reopen) closes only the opening
          // that started it — `token` is this render's, the one the form's submit closure saw.
          onSaved={() => { const mine = editing.token; setEditing((cur) => (cur !== null && cur.token === mine ? null : cur)); void load(); }}
        />
      )}
    </div>
  );
}
