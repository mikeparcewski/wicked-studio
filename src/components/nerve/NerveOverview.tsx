import type { SystemAction, SystemAttention, SystemSnapshot } from '../../api/system.js';
import type { RosterSeat } from '../../api/types.js';
import type { NerveState } from '../../board/nerveCenter.js';
import {
  cliTile, overviewSentence, slowingItems, slowingLine, systemTiles, tilesNeedingALook, waitingItems, waitingWords, type Tile,
} from '../../board/nerveOverview.js';
import { landingTab, nerveTabPath, type NerveTab } from '../../board/nerveTabs.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmButton, CalmHead, CalmLoading, CalmSection } from '../calm/Calm.js';
import { seatStandingWord, type HealthRegistry } from '../HealthRailSection.js';
import { InsightsLine } from '../insights/InsightsLine.js';

/** Where "See what needs you" goes: Needs you in full. */
const NEEDS_PATH = '/needs';

const ACTION_WORD: Record<SystemAction['kind'], string> = { 'sign-in': 'Sign in', recheck: 'Check again', 'open-gate': 'Open the gate', 'open-run': 'Open the job' };

const PANEL_TAB: Record<SystemAttention['panel'], NerveTab> = { clis: 'clis', runs: 'runs', infra: 'infra', governance: 'governance' };

/** An older crew's helper tile, from the roster (no week, no pass rate: it does not count them). */
function seatTile(seat: RosterSeat): Tile {
  const k = seatStandingWord(seat).kind;
  const status = (seat.health as { status?: string } | null | undefined)?.status;
  const base = { id: seat.key, name: seat.display_name || seat.key, tab: 'clis' as const, line: null };
  if (status !== undefined && status !== 'active') return { ...base, state: 'Paused', tone: 'warn' };
  if (k === 'signed-in' || k === 'no-sign-in-needed') return { ...base, state: 'Ready', tone: 'ok' };
  if (k === 'signed-out') return { ...base, state: 'Not signed in', tone: 'quiet', signIn: seat.key };
  if (k === 'ineligible') return { ...base, state: 'Not picked for checks', tone: 'quiet' };
  return { ...base, state: 'Not known', tone: 'quiet' };
}

/** An older crew's System tiles: what studio can say itself (crew answering, the evidence store). */
function fallbackSystemTiles(registry: HealthRegistry): Tile[] {
  const services: Tile = registry.healthError !== null
    ? { id: 'services', name: 'Services', state: 'Crew is not answering', tone: 'fail', line: null, tab: 'infra' }
    : registry.health === null
      ? { id: 'services', name: 'Services', state: 'Checking…', tone: 'quiet', line: null, tab: 'infra' }
      : { id: 'services', name: 'Services', state: registry.health.status === undefined || registry.health.status === 'ok' ? 'Crew is answering' : `Crew reports ${registry.health.status}`, tone: registry.health.status === undefined || registry.health.status === 'ok' ? 'ok' : 'warn', line: 'This crew does not report its components', tab: 'infra' };
  const machine: Tile = { id: 'machine', name: 'This machine', state: 'Not reported', tone: 'quiet', line: 'This crew does not report disk or load', tab: 'infra' };
  const g = registry.governance;
  const governance: Tile = g.kind === 'ok'
    ? (() => {
      const errors = g.governance.findings.filter((f) => f.severity === 'error').length;
      const warnings = g.governance.findings.filter((f) => f.severity === 'warning').length;
      if (g.governance.store === null) return { id: 'governance', name: 'Governance', state: 'No evidence store', tone: 'fail' as const, line: null, tab: 'governance' as const };
      if (errors > 0) return { id: 'governance', name: 'Governance', state: `${errors} ${errors === 1 ? 'problem' : 'problems'}`, tone: 'fail' as const, line: null, tab: 'governance' as const };
      if (warnings > 0) return { id: 'governance', name: 'Governance', state: `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, tone: 'warn' as const, line: null, tab: 'governance' as const };
      return { id: 'governance', name: 'Governance', state: 'Healthy', tone: 'ok' as const, line: null, tab: 'governance' as const };
    })()
    : g.kind === 'absent' ? { id: 'governance', name: 'Governance', state: 'Not reported', tone: 'quiet', line: null, tab: 'governance' }
      : g.kind === 'error' ? { id: 'governance', name: 'Governance', state: 'Can’t be read', tone: 'warn', line: null, tab: 'governance' }
        : { id: 'governance', name: 'Governance', state: 'Checking…', tone: 'quiet', line: null, tab: 'governance' };
  return [services, machine, governance];
}

/**
 * NERVE CENTER, the calm overview (`/watch` with no `?tab=`; the operator-approved mockup `ui-v2-nerve`):
 * the one sentence, what is slowing work now (each with its fix), one tile per helper and three System
 * tiles. Every tile opens the tabbed detail (`?tab=`), where run ids, paths and raw checks live.
 * Read-only apart from Check again, Sign in and an item's own fix.
 */
export function NerveOverview({ state, snapshot, registry, reading, needCount, search, navigate, onRecheck, onAct, notes }: {
  state: NerveState;
  /** Crew's snapshot (a crew with `capabilities.system`), or null against an older crew or before it answers. */
  snapshot: SystemSnapshot | null;
  registry: HealthRegistry;
  reading: boolean;
  /** An older crew's needs-you count (the Desk's settled one). */
  needCount: number;
  search: string;
  navigate: Navigate;
  onRecheck: () => void;
  onAct: (a: SystemAction) => void;
  /** The upgrade notes (an older crew), under everything. */
  notes?: React.ReactNode;
}): React.ReactElement {
  const go = (path: string) => (e: React.MouseEvent): void => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path);
  };
  const slowing = slowingItems(state.attention);
  const waiting = snapshot !== null ? waitingItems(state.attention).length : needCount;
  const helpers: Tile[] | null = snapshot !== null ? snapshot.clis.map(cliTile) : registry.roster !== null ? registry.roster.map(seatTile) : null;
  const system: Tile[] | null = snapshot !== null ? systemTiles(snapshot) : state.read === 'checking' && registry.health === null ? null : fallbackSystemTiles(registry);
  // What needs a look without being in attention: a tile that is not fine (a degraded component, a helper
  // out of quota or signed out), less the areas attention already names.
  const named = new Set(slowing.map((a) => a.panel));
  const others = tilesNeedingALook([
    ...(helpers ?? []).filter(() => !named.has('clis')),
    ...(system ?? []).filter((t) => !named.has(t.tab === 'governance' ? 'governance' : 'infra')),
  ]);
  const sentence = overviewSentence(state, slowing, others);
  const details = nerveTabPath(search, landingTab(state) ?? 'attention');
  const waitLine = waitingWords(waiting);

  const fix = (a: SystemAttention): React.ReactElement => {
    const tab = PANEL_TAB[a.panel];
    if (a.action !== null) {
      const action = a.action;
      return (
        <button type="button" className="wk-calm-btn wk-calm-btn--link wk-ncv-fix" data-testid="nc-slow-fix" data-kind={action.kind} onClick={() => onAct(action)}>
          {action.label ?? ACTION_WORD[action.kind]} <span aria-hidden>→</span>
        </button>
      );
    }
    const path = nerveTabPath(search, tab);
    return <a href={path} onClick={go(path)} className="wk-calm-btn wk-calm-btn--link wk-ncv-fix" data-testid="nc-slow-fix" data-kind="details">See what to do <span aria-hidden>→</span></a>;
  };

  return (
    <>
      <CalmHead
        title={PAGE_NAMES.watch}
        sentenceTestId="nc-headline"
        sentence={<>
          <span className="wk-ncv-lead" data-tone={sentence.tone}>{sentence.lead}</span>
          {sentence.rest !== '' && <> <span>{sentence.rest}</span></>}
        </>}
        action={<CalmButton testId="nc-recheck" disabled={reading} onClick={onRecheck}>{reading ? 'Checking…' : 'Check again'}</CalmButton>}
      />

      {waitLine !== null && (
        <p className="wk-ncv-waiting" data-testid="nc-waiting" data-count={waiting}>
          {waitLine} <a href={NEEDS_PATH} onClick={go(NEEDS_PATH)} className="wk-link" data-testid="nc-waiting-open">See what needs you</a>
        </p>
      )}

      {slowing.length > 0 && (
        <CalmSection label="Slowing work now" data-testid="nc-slowing">
          <ul className="wk-ncv-slow-list">
            {slowing.map((a) => (
              <li key={a.id} className="wk-ncv-slow" data-testid="nc-slow" data-id={a.id} data-level={a.level}>
                <span aria-hidden className="wk-calm-dot" data-tone={a.level === 'red' ? 'fail' : 'warn'} />
                <span className="wk-ncv-slow-text">
                  <span className="wk-ncv-slow-title"><span className="sr-only">{a.level === 'red' ? 'Stopping work: ' : 'Slowing work: '}</span>{a.text}</span>
                  {slowingLine(a, snapshot?.infra ?? null) !== null && <span className="wk-ncv-slow-line">{slowingLine(a, snapshot?.infra ?? null)}</span>}
                </span>
                {fix(a)}
              </li>
            ))}
          </ul>
        </CalmSection>
      )}

      <CalmSection label="Helpers" data-testid="nc-helpers">
        {helpers === null
          ? <CalmLoading rows={2} label="Reading the helpers" />
          : helpers.length === 0
            ? <p className="wk-calm-foot">Crew reports no helpers.</p>
            : <TileGrid tiles={helpers} cols={4} search={search} navigate={navigate} onSignIn={(key) => onAct({ kind: 'sign-in', target: key })} />}
      </CalmSection>

      <CalmSection label="System" data-testid="nc-system">
        {system === null
          ? <CalmLoading rows={1} label="Reading the system" />
          : <TileGrid tiles={system} cols={3} search={search} navigate={navigate} onSignIn={() => undefined} />}
      </CalmSection>

      <div className="wk-ncv-foot">
        <InsightsLine navigate={navigate} testId="nc-insights-line" />
        <p className="wk-calm-foot">
          <a href={details} onClick={go(details)} className="wk-link" data-testid="nc-details">All the details</a>: every job&apos;s state, the feed, and each check as crew answered it.
        </p>
        {notes}
      </div>
    </>
  );
}

function TileGrid({ tiles, cols, search, navigate, onSignIn }: {
  tiles: readonly Tile[]; cols: 3 | 4; search: string; navigate: Navigate; onSignIn: (key: string) => void;
}): React.ReactElement {
  return (
    <ul className="wk-ncv-tiles" data-cols={cols}>
      {tiles.map((t) => {
        const path = nerveTabPath(search, t.tab);
        return (
          <li key={t.id} className="wk-ncv-tile" data-testid="nc-tile" data-tile={t.id} data-tone={t.tone}>
            <a href={path} className="wk-ncv-tile-main" data-testid="nc-tile-open" data-tab={t.tab} aria-label={`${t.name}: ${t.state}${t.line !== null ? `, ${t.line}` : ''}. Open its details`}
              onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate(path); }}>
              <span className="wk-ncv-tile-name">{t.name}</span>
              <span className="wk-ncv-tile-state" data-testid="nc-tile-state" data-tone={t.tone}>{t.state}</span>
              {t.line !== null && <span className="wk-ncv-tile-line" data-testid="nc-tile-line">{t.line}</span>}
            </a>
            {t.signIn !== undefined && (
              <button type="button" className="wk-ncv-tile-signin" data-testid="nc-tile-signin" data-cli={t.signIn} onClick={() => onSignIn(t.signIn!)}>
                Sign in<span className="sr-only"> to {t.name}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
