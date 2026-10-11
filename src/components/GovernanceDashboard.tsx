import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { isProposalsUnsupported, listProposals, proposalKind, type Proposal } from '../api/proposals.js';
import { isMemoryUnsupported, listMemories, memoryCoverage, type MemoryItem } from '../api/memory.js';
import { memoriesPath, policiesPath, steeringTypeOf, STEERING_TYPE_LABELS, type SteeringRule } from '../api/steering.js';
import { readErrorKind } from '../api/errors.js';
import type { Navigate } from '../hooks/useRoute.js';
import { ProposalsSection } from './ProposalsSection.js';
import { FacetAutocomplete } from './FacetAutocomplete.js';
import { KeyValueChips, severityWord } from './ProposalChips.js';
import { StateBanner, EmptyState, Skeleton, StatLine, TechDetails } from './ui/index.js';
import { useNeedsSources } from '../store/needsSources.js';

type ReadFailure = { kind: 'offline' | 'error'; message: string };
function readFailure(e: unknown): ReadFailure {
  return { kind: readErrorKind(e), message: e instanceof Error ? e.message : String(e) };
}
type PageLink = (path: string) => { href: string; onClick: (e: React.MouseEvent) => void };

function ruleFacets(rule: SteeringRule): string[] {
  const out = [`type=${steeringTypeOf(rule)}`, `severity=${rule.severity}`];
  for (const [key, value] of Object.entries(rule.targets ?? {})) if (typeof value === 'string' && value !== '') out.push(`${key}=${value}`);
  for (const value of rule.applies_to ?? []) if (value !== '') out.push(`applies_to=${value}`);
  return out;
}

export function GovernanceDashboard({ navigate }: { navigate: Navigate }): React.ReactElement {
  const [pending, setPending] = useState<Proposal[] | null>(null);
  const [proposalsUnsupported, setProposalsUnsupported] = useState(false);
  const [proposalsError, setProposalsError] = useState<ReadFailure | null>(null);
  const [coverageTotal, setCoverageTotal] = useState<number | null>(null);
  const [coverageError, setCoverageError] = useState<ReadFailure | null>(null);
  const [rules, setRules] = useState<SteeringRule[] | null>(null);
  const [rulesError, setRulesError] = useState<ReadFailure | null>(null);

  const loadPending = useCallback(async (): Promise<void> => {
    setPending(null);
    setProposalsError(null);
    setProposalsUnsupported(false);
    try {
      const proposals = await listProposals({ state: 'pending' });
      setPending(proposals);
      useNeedsSources.getState().depositProposals(proposals);
    } catch (e) {
      if (isProposalsUnsupported(e)) setProposalsUnsupported(true);
      else setProposalsError(readFailure(e));
    }
  }, []);
  const loadCoverage = useCallback((): void => {
    setCoverageTotal(null);
    setCoverageError(null);
    void memoryCoverage()
      .then((coverage) => setCoverageTotal(typeof coverage.total === 'number' ? coverage.total : null))
      .catch((e: unknown) => { if (!isMemoryUnsupported(e)) setCoverageError(readFailure(e)); });
  }, []);
  const loadRules = useCallback((): void => {
    setRules(null);
    setRulesError(null);
    void api.listConformanceRules()
      .then(({ rules: rows }) => setRules(rows as SteeringRule[]))
      .catch((e: unknown) => setRulesError(readFailure(e)));
  }, []);
  useEffect(() => { void loadPending(); loadCoverage(); loadRules(); }, [loadPending, loadCoverage, loadRules]);
  const refreshHeadline = useCallback((): void => { void loadPending(); loadCoverage(); loadRules(); }, [loadPending, loadCoverage, loadRules]);
  const activeRules = useMemo(() => rules?.filter((rule) => rule.retired !== true) ?? null, [rules]);
  const needsReview = pending === null ? null : pending.filter((proposal) => proposalKind(proposal) !== 'other').length;
  const link: PageLink = (path) => ({ href: path, onClick: (e) => { e.preventDefault(); navigate(path); } });

  return (
    <div data-testid="governance-dashboard" className="wk-gk-page">
      <header className="wk-page-head wk-gk-head">
        <div className="wk-page-head-text">
          <h1 className="wk-page-title">Steering dashboard</h1>
          <p className="wk-page-intro">Review what helpers proposed to remember or enforce, and see what is in force.</p>
        </div>
        <div className="wk-page-actions">
          <a {...link(policiesPath())} data-testid="governance-manage-policies" className="wk-btn wk-btn--secondary wk-btn--sm">Manage rules</a>
          <a {...link(memoriesPath())} data-testid="governance-manage-memories" className="wk-btn wk-btn--secondary wk-btn--sm">Manage memories</a>
          <button type="button" data-testid="governance-refresh" onClick={refreshHeadline} className="wk-btn wk-btn--quiet wk-btn--sm">Refresh</button>
        </div>
      </header>
      <div data-testid="governance-kpis" className="wk-gk-stats">
        <div data-testid="gk-stat-needs-review"><StatLine items={[{ label: 'to review', value: needsReview }]} showZero /></div>
        <div data-testid="gk-stat-memories"><StatLine items={[{ label: 'memories', value: coverageTotal }]} showZero /></div>
        <div data-testid="gk-stat-rules"><StatLine items={[{ label: 'rules in force', value: activeRules?.length ?? null }]} showZero /></div>
      </div>
      {proposalsError !== null && <StateBanner kind={proposalsError.kind} what="the review count" error={proposalsError.message} onRetry={() => void loadPending()} />}
      {proposalsUnsupported && <EmptyState title="Studio's service does not support proposal review yet." />}
      {coverageError !== null && <StateBanner kind={coverageError.kind} what="the memory total" error={coverageError.message} onRetry={loadCoverage} />}
      <section data-testid="governance-review" className="wk-gk-card">
        <h2 className="wk-section-title">Review inbox</h2>
        <div data-testid="governance-review-inbox" className="wk-gk-grid">
          <ProposalsSection kind="memory" heading="Memory proposals" onDecision={refreshHeadline} />
          <ProposalsSection kind="policy" heading="Policy proposals" onDecision={refreshHeadline} />
        </div>
      </section>
      <section data-testid="governance-browse" className="wk-gk-stack">
        <h2 className="wk-section-title">Browse</h2>
        <MemoriesBrowse link={link} coverageTotal={coverageTotal} />
        <RulesBrowse rules={activeRules} error={rulesError} onRetry={loadRules} link={link} />
      </section>
    </div>
  );
}

function MemoriesBrowse({ link, coverageTotal }: { link: PageLink; coverageTotal: number | null }): React.ReactElement {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<ReadFailure | null>(null);
  const [facet, setFacet] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUnsupported(false);
    void listMemories()
      .then((rows) => { if (!cancelled) setMemories(rows); })
      .catch((e: unknown) => {
        if (!cancelled) {
          setMemories([]);
          if (isMemoryUnsupported(e)) setUnsupported(true);
          else setError(readFailure(e));
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [generation]);
  const facetPairs = useMemo(() => [...new Set(memories.flatMap((memory) => Object.entries(memory.facets).map(([key, value]) => `${key}=${value}`)))].sort(), [memories]);
  const visible = useMemo(() => {
    if (facet === null) return memories;
    const [key, value] = facet.split(/=(.*)/s);
    return memories.filter((memory) => memory.facets[key ?? ''] === value);
  }, [memories, facet]);
  const listed = visible.slice(0, 20);
  const partial = coverageTotal !== null && coverageTotal > memories.length;
  return (
    <div data-testid="gk-browse-memories" className="wk-gk-card">
      <div className="wk-gk-row">
        <h2 className="wk-section-title">Memories{!loading && !unsupported && error === null && !partial && <span className="wk-gk-count"> ({listed.length} listed)</span>}</h2>
        <a {...link(memoriesPath())} data-testid="gk-browse-memories-manage" className="wk-link">Manage memories</a>
      </div>
      {facetPairs.length > 0 && !loading && error === null && <FacetAutocomplete testId="gk-memories-facet" options={facetPairs} value={facet} onChange={setFacet} label="Filter memories by tags" placeholder="Choose a tag" />}
      {loading ? <Skeleton data-testid="gk-memories-loading" /> : unsupported ? (
        <EmptyState data-testid="gk-memories-unsupported" title="Studio's service does not support memory management yet." />
      ) : error !== null ? (
        <StateBanner kind={error.kind} what="memories" error={error.message} onRetry={() => setGeneration((value) => value + 1)} />
      ) : listed.length === 0 ? (
        <EmptyState data-testid="gk-memories-empty" title={memories.length > 0 ? 'No memories match this tag.' : partial ? 'No memories are listed in this preview.' : 'No memories listed yet.'} action={<a {...link(memoriesPath())} className="wk-link">Manage memories</a>} />
      ) : (
        <ul data-testid="gk-memories-list" className="wk-gk-list">
          {listed.map((memory) => (
            <li key={memory.id} data-testid="gk-memory-row" data-memory-id={memory.id} className="wk-gk-card">
              <p className="wk-gk-content">{memory.content}</p>
              <span className="wk-tag">{memory.tier.charAt(0).toUpperCase() + memory.tier.slice(1)}</span>
              <KeyValueChips testid="gk-memory-facets" entries={{ ...memory.facets, memory_id: memory.id, scope: memory.scope }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RulesBrowse({ rules, error, onRetry, link }: {
  rules: SteeringRule[] | null; error: ReadFailure | null; onRetry: () => void; link: PageLink;
}): React.ReactElement {
  const [facet, setFacet] = useState<string | null>(null);
  const facetPairs = useMemo(() => [...new Set((rules ?? []).flatMap(ruleFacets))].sort(), [rules]);
  const visible = useMemo(() => (rules ?? []).filter((rule) => facet === null || ruleFacets(rule).includes(facet)).slice(0, 20), [rules, facet]);
  return (
    <div data-testid="gk-browse-rules" className="wk-gk-card">
      <div className="wk-gk-row">
        <h2 className="wk-section-title">Rules in force{rules !== null && error === null && <span className="wk-gk-count"> ({visible.length} listed)</span>}</h2>
        <a {...link(policiesPath())} data-testid="gk-browse-rules-manage" className="wk-link">Manage rules</a>
      </div>
      {facetPairs.length > 0 && <FacetAutocomplete testId="gk-rules-facet" options={facetPairs} value={facet} onChange={setFacet} label="Filter rules by tags" placeholder="Choose a tag" />}
      {error !== null ? <StateBanner kind={error.kind} what="rules in force" error={error.message} onRetry={onRetry} /> : rules === null ? <Skeleton /> : visible.length === 0 ? (
        <EmptyState data-testid="gk-rules-empty" title={rules.length === 0 ? 'No rules in force.' : 'No rules match this tag.'} />
      ) : (
        <ul data-testid="gk-rules-list" className="wk-gk-list">
          {visible.map((rule) => (
            <li key={rule.id} data-testid="gk-rule-row" data-rule-id={rule.id} className="wk-gk-card">
              <p className="wk-gk-content">{rule.statement}</p>
              <div className="wk-gk-row"><span className="wk-tag">{severityWord(rule.severity)}</span><span className="wk-tag">{STEERING_TYPE_LABELS[steeringTypeOf(rule)]}</span></div>
              <TechDetails text={[`rule_id: ${rule.id}`, ...ruleFacets(rule)]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
