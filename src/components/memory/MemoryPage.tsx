import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { askPage, PageAskButton, pageTextLines, usePageChatHostPage } from '../chat/PageChat.js';
import {
  addMemory, AddMemoryApproveError, AddMemoryScopeUnsupported, editMemory, isEraseByIdUnsupported, isMemoryEditUnsupported, isMemoryUnsupported,
  eraseMemoryItem, listMemories, listRetiredMemories, memoryCoverage, memoryPath, readMemoryView, retireMemory, retireMemoryItem,
  type MemoryCoverage, type MemoryItem, type MemoryView,
} from '../../api/memory.js';
import { FILE_PROPOSAL_TIERS, isProposalsUnsupported, listProposals, proposalKind, type FileProposalTier } from '../../api/proposals.js';
import type { RepoEntry } from '../../api/types.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { readErrorKind } from '../../api/errors.js';
import { relTime } from '../../board/relTime.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useNeedsSources } from '../../store/needsSources.js';
import { useProjectsStore } from '../../store/projects.js';
import { useCapabilities } from '../../store/capabilities.js';
import { FacetAutocomplete } from '../FacetAutocomplete.js';
import { useModalEscape } from '../Modal.js';
import { shortContent } from '../ProposalChips.js';
import { NotAcceptedList } from '../NotAcceptedList.js';
import { ProposalsSection } from '../ProposalsSection.js';
import { StateBanner, TechDetails } from '../ui/index.js';
import { CalmButton, CalmEmpty, CalmFacts, CalmHead, CalmLoading, CalmMenu, CalmNote, CalmRow, CalmRows, CalmSearch, CalmSection, CalmSeg } from '../calm/Calm.js';
import { memoryOrigin, memorySentence, shortDate } from '../../board/calmMemory.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';
import { MemoryCaptureAdd, MemoryRetired, MemoryTable } from './MemoryAdd.js';

/**
 * THE MEMORY PAGE (operator 2026-10-17: "memories and steering are separate"). Memory is what
 * helpers REMEMBER — witnessed or told context they recall; Steer is the rules they are HELD to.
 * A Desk tab beside Steer (`/memory`, `/memory?view=proposals`, `/memory?view=not-accepted`), in Steer's
 * visual language:
 *
 *  - the header: the title, one sentence, and the ⋯ menu (Add a memory first; operator 2026-11-01);
 *  - Steer's pills over the list: Active (search, kind and tag filters, Edit, Retire one, Retire a
 *    scope), Proposed (approve as filed or with an edit, reject) and Not accepted (what was turned
 *    down, kept by the store, read only).
 *
 * Every write goes through crew's API: add = file a proposal then approve it (crew has no direct
 * memory write); edit = crew's `/memory/edit` (a new memory replaces the old one); retire =
 * `/memory/retire-item` or the subtree `/memory/retire`.
 */

type Failure = { kind: 'offline' | 'error'; message: string };
function failure(e: unknown): Failure {
  return { kind: readErrorKind(e), message: e instanceof Error ? e.message : String(e) };
}

/** The kinds the store files a memory under, in the order they are shown. */
const TIERS = ['semantic', 'episodic', 'procedural', 'working', 'archival'] as const;
const TIER_WORDS: Record<string, string> = {
  semantic: 'Facts and decisions',
  episodic: 'Things that happened',
  procedural: 'How things are done',
  working: 'Working notes',
  archival: 'Archived',
};
function tierWord(tier: string): string {
  return TIER_WORDS[tier] ?? tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** (studio#1095) What a person may file a memory as, in the Add a memory dialog's words. */
export const ADD_TIER_WORDS: Record<FileProposalTier, string> = {
  semantic: 'A fact or decision',
  procedural: 'How something is done',
  episodic: 'Something that happened',
};

/** What to do when an older crew refused the kind and/or the repository (crew#1878 adds them). */
export function scopeRefusedWords(refused: ReadonlyArray<'tier' | 'repo'>): string {
  const what = [refused.includes('tier') ? 'a kind other than a fact' : null, refused.includes('repo') ? 'a repository' : null].filter((x) => x !== null).join(' or ');
  const instead = refused.includes('tier') && refused.includes('repo') ? 'save it as a fact on any repository'
    : refused.includes('tier') ? 'save it as a fact' : 'save it for any repository';
  return `This crew can’t save ${what} yet, so nothing was saved. Update wicked-crew, or ${instead}.`;
}

/** Where a memory applies, in words: its project and repository facets, else its scope, else everywhere. */
function whereWords(m: MemoryItem, projectName: (id: string) => string | null, repoName: (id: string) => string | null = () => null): string {
  const project = m.facets.project;
  const repo = m.facets['repo'];
  const parts: string[] = [];
  if (project !== undefined && project !== '') parts.push(projectName(project) ?? `Project ${project}`);
  if (repo !== undefined && repo !== '') parts.push(`repository ${repoName(repo) ?? repo}`);
  if (parts.length > 0) { const w = parts.join(', '); return w.charAt(0).toUpperCase() + w.slice(1); }
  return m.scope === '' ? 'Everywhere' : m.scope;
}

type Coverage = { kind: 'loading' } | { kind: 'ok'; value: MemoryCoverage } | { kind: 'unsupported' } | { kind: 'failed'; error: Failure };

export function MemoryPage({ search, navigate, address = (p) => p, project = null }: {
  /** The page's own query (`?view=proposals`; `?q=` opens it filtered to those words — a search hit). */
  search: string;
  navigate: Navigate;
  /** Where a Memory address lives in the host (the Desk: `/?tab=memory&at=<address>`). */
  address?: (memoryAddress: string) => string;
  /** A project's page hosts it: Add a memory offers that project first. */
  project?: string | null;
}): React.ReactElement {
  const view = readMemoryView(search);
  // A run's end card opens the queue on that run's learnings (`?view=proposals&run=<id>`).
  const runFilter = view === 'proposals' ? (new URLSearchParams(search).get('run') ?? '').trim() || null : null;
  const go = (v: MemoryView): void => navigate(address(memoryPath(v)));

  // ── Reads ────────────────────────────────────────────────────────────────────────────────────
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  // (studio#1095) A memory scoped to one repository names it: the list is read once a listed memory has one (the one
  // session cache; no read for a list with none).
  const [repoList, setRepoList] = useState<RepoEntry[] | null>(getCachedRepos());
  const scopedToRepo = memories.some((m) => typeof m.facets['repo'] === 'string' && m.facets['repo'] !== '');
  useEffect(() => {
    if (!scopedToRepo) return undefined;
    let live = true;
    Promise.resolve().then(fetchReposCached).then((r) => { if (live) setRepoList(r); }, () => { /* the id stands in */ });
    return () => { live = false; };
  }, [scopedToRepo]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Failure | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  // A search hit (the search modal) opens the page filtered to the memory's words.
  const [query, setQuery] = useState(() => (new URLSearchParams(search).get('q') ?? '').trim());
  const [queryInput, setQueryInput] = useState(query);
  const linkedQuery = (new URLSearchParams(search).get('q') ?? '').trim();
  useEffect(() => {
    if (linkedQuery === '') return;
    setQuery(linkedQuery);
    setQueryInput(linkedQuery);
  }, [linkedQuery]);
  const loadGeneration = useRef(0);
  const load = useCallback(async (q: string): Promise<void> => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    setUnsupported(false);
    try {
      const rows = await listMemories(q === '' ? {} : { query: q });
      if (generation === loadGeneration.current) setMemories(rows);
    } catch (e) {
      if (generation === loadGeneration.current) {
        setMemories([]);
        if (isMemoryUnsupported(e)) setUnsupported(true);
        else setError(failure(e));
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);
  // A write's re-read bumps `rev`, so it reads the CURRENT query, never the one its dialog opened under.
  const [rev, setRev] = useState(0);
  useEffect(() => { void load(query); }, [load, query, rev]);

  const [coverage, setCoverage] = useState<Coverage>({ kind: 'loading' });
  const coverageGen = useRef(0);
  const loadCoverage = useCallback((): void => {
    const generation = ++coverageGen.current;
    void memoryCoverage()
      .then((value) => { if (generation === coverageGen.current) setCoverage({ kind: 'ok', value }); })
      .catch((e: unknown) => {
        if (generation === coverageGen.current) setCoverage(isMemoryUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', error: failure(e) });
      });
  }, []);
  useEffect(() => { loadCoverage(); }, [loadCoverage]);

  const [pending, setPending] = useState<number | null | 'unsupported'>(null);
  const [reviewTick, setReviewTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void listProposals({ state: 'pending' })
      .then((ps) => {
        if (cancelled) return;
        setPending(ps.filter((p) => proposalKind(p) === 'memory').length);
        useNeedsSources.getState().depositProposals(ps);
      })
      .catch((e: unknown) => { if (!cancelled) setPending(isProposalsUnsupported(e) ? 'unsupported' : null); });
    return () => { cancelled = true; };
  }, [reviewTick]);

  const projects = useProjectsStore((s) => s.projects);
  useEffect(() => { if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load(); }, []);
  const projectName = useCallback((id: string): string | null => projects.find((p) => p.id === id)?.name ?? null, [projects]);

  const reread = (): void => { setRev((r) => r + 1); loadCoverage(); };
  /** Bumped when a write files a proposal, so an open Proposals list reads it (Add's approve may fail). */
  const [proposalsRev, setProposalsRev] = useState(0);

  // ── Filters ──────────────────────────────────────────────────────────────────────────────────
  const [tier, setTier] = useState<string | null>(null);
  const [facet, setFacet] = useState<string | null>(null);
  const facetPairs = useMemo(() => [...new Set(memories.flatMap((m) => Object.entries(m.facets).map(([k, v]) => `${k}=${v}`)))].sort(), [memories]);
  const visible = useMemo(() => {
    const [key, value] = facet?.split(/=(.*)/s) ?? [];
    return [...memories]
      .filter((m) => (tier === null || m.tier === tier) && (facet === null || m.facets[key ?? ''] === value))
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || a.id.localeCompare(b.id));
  }, [memories, facet, tier]);
  const applyQuery = (): void => { setFacet(null); setQuery(queryInput.trim()); };
  const clearFilters = (): void => { setQueryInput(''); setFacet(null); setTier(null); setQuery(''); };

  /** Bumped by Refresh, so an open Not accepted list reads the queue again. */
  const [rejectedRev, setRejectedRev] = useState(0);

  // ── Moves ────────────────────────────────────────────────────────────────────────────────────
  const [note, setNote] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  const opened = useRef(0);
  const [adding, setAdding] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ memory: MemoryItem; token: number } | null>(null);
  const [retiring, setRetiring] = useState<{ memory: MemoryItem; width: 'item' | 'scope' | 'erase'; token: number } | null>(null);
  // crew#1697: a retire is soft (kept, restorable) on a crew that serves restore; an older crew erases; `null` = not
  // known yet (health pending or unreadable), so the words promise neither.
  const soft = useCapabilities((s) => s.memoryRestore);
  useEffect(() => { void useCapabilities.getState().load(); }, []);
  /** Bumped by every change to the retired set (a retire, a delete, a restore) and by Refresh, so Show retired reads again. */
  const [retiredRev, setRetiredRev] = useState(0);
  // DES-LEARN §6.3: Steering's ways in, opened from the Add menu, shown above the list.
  const [panel, setPanel] = useState<'import' | 'table' | 'retired' | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Pieces (the calm page: title + one sentence + one action; a quiet search; roomy rows) ──────
  const total = coverage.kind === 'ok' && typeof coverage.value.total === 'number' ? coverage.value.total : null;
  const byTier = coverage.kind === 'ok' ? coverage.value.by_tier ?? {} : {};
  const present = [...TIERS, ...Object.keys(byTier).filter((t) => !(TIERS as readonly string[]).includes(t))].filter((t) => (byTier[t] ?? 0) > 0);
  const tierList = tier !== null && !present.includes(tier) ? [...present, tier] : present;

  const sentence = memorySentence({ total, pending, coverage: coverage.kind });
  const addIt = (): void => setAdding(++opened.current);
  usePageChatHostPage('memory', {
    knows: `Knows Memory: ${total !== null ? `${total} kept` : `${memories.length} listed`}${typeof pending === 'number' ? `, ${pending} suggested` : ''}. What it suggests is filed for you to keep.`,
    data: () => pageTextLines(scrollRef.current),
  });
  const ways = [
    // DES-LEARN §6.3 (operator 2026-10-31): Add with chat IS this page's chat, the dynamic one: what it would keep ends
    // in a pick-several, filed for your approval. Never a separate panel.
    { id: 'chat', label: 'Add with chat', testId: 'memory-add-chat', onSelect: () => { setPanel(null); askPage('memory', { focus: null }); } },
    { id: 'import', label: 'Import a doc…', testId: 'memory-add-import', onSelect: () => setPanel('import') },
    { id: 'table', label: 'Edit as a table', testId: 'memory-add-table', onSelect: () => setPanel('table') },
    { id: 'retired', label: 'Show retired', testId: 'memory-add-retired', onSelect: () => setPanel('retired') },
  ];
  const refresh = (): void => { reread(); setReviewTick((t) => t + 1); setRejectedRev((r) => r + 1); setProposalsRev((r) => r + 1); setRetiredRev((r) => r + 1); };
  // Operator 2026-11-01: no header button; Add a memory is the ⋯ menu's first item, the pills switch the list.
  const action = (
    <CalmMenu menuLabel="More for memory" menuTestId={/* testid */ 'memory-more'}
      menu={[{ id: 'add', label: 'Add a memory…', testId: 'memory-add', onSelect: addIt }, ...ways, { id: 'refresh', label: 'Refresh', testId: 'memories-refresh', onSelect: refresh }]} />
  );

  const memoryRow = (m: MemoryItem): React.ReactElement => {
    // (studio#1095) The repository a memory is scoped to is part of where it applies, not a tag.
    const where = whereWords(m, projectName, (id) => repoList?.find((r) => r.id === id)?.name ?? null);
    const tags = Object.entries(m.facets).filter(([k]) => k !== 'project' && k !== 'repo');
    const origin = memoryOrigin(m);
    const added = typeof m.created_at === 'number' ? shortDate(m.created_at * 1000) : null;
    return (
      <CalmRow key={m.id} data-testid="memory-row" data={{ 'memory-id': m.id, tier: m.tier, scope: m.scope, origin: origin ?? 'unknown' }}
        tone="accent" title={<span data-testid="memory-content">{m.content}</span>} titleAttr={m.content}
        sub={<span data-testid="memory-meta">{origin === 'told' ? 'Told by you' : origin === 'session' ? 'Learned in a session' : tierWord(m.tier)} · <span data-testid="memory-where">{where}</span></span>}
        meta={added ?? undefined}
        openTestId={/* testid */ 'memory-open'} openLabel={`${shortContent(m.content)}: show details`}
        menuLabel={`More for ${shortContent(m.content)}`} menuTestId={/* testid */ 'memory-actions'}
        menu={[
          { id: 'edit', label: 'Edit…', testId: 'memory-edit', onSelect: () => setEditing({ memory: m, token: ++opened.current }) },
          { id: 'retire', label: 'Retire', danger: true, testId: 'memory-retire', onSelect: () => setRetiring({ memory: m, width: 'item', token: ++opened.current }) },
          ...(soft === true ? [{ id: 'erase', label: 'Delete for good…', danger: true, testId: 'memory-erase', onSelect: () => setRetiring({ memory: m, width: 'erase', token: ++opened.current }) }] : []),
          ...(m.scope !== '' ? [{ id: 'retire-scope', label: soft !== false ? 'Delete everything in this scope for good…' : 'Retire everything in this scope…', onSelect: () => setRetiring({ memory: m, width: 'scope', token: ++opened.current }) }] : []),
        ]}
        details={(
          <>
            <p data-testid="memory-full">{m.content}</p>
            <CalmFacts facts={[
              { k: 'Kind', v: tierWord(m.tier), testId: 'memory-tier' },
              { k: 'Recalled on', v: where },
              ...(tags.length > 0 ? [{ k: 'Tags', v: tags.map(([k, v]) => `${k}: ${v}`).join(' · ') }] : []),
              ...(typeof m.created_at === 'number' ? [{ k: 'Added', v: relTime(m.created_at * 1000) }] : []),
            ]} />
            <span data-testid="memory-scope"><TechDetails text={[`memory_id: ${m.id}`, `scope: ${m.scope === '' ? '(root)' : m.scope}`, ...Object.entries(m.facets).map(([k, v]) => `${k}: ${v}`)]} /></span>
          </>
        )} />
    );
  };

  const filtered = query !== '' || facet !== null || tier !== null;
  const kindPick = tierList.length > 0 ? (
    <select className="wk-calm-pick wk-calm-pick--field" data-testid="memory-kind" aria-label="Kind of memory" value={tier ?? 'all'}
      onChange={(e) => setTier(e.target.value === 'all' ? null : e.target.value)}>
      <option value="all">{`All kinds${total !== null ? ` (${total})` : ''}`}</option>
      {tierList.map((t) => <option key={t} value={t}>{`${tierWord(t)} (${byTier[t] ?? 0})`}</option>)}
    </select>
  ) : null;
  const pills = (
    <CalmSeg label="Which memories" value={view} onChange={go} data-testid="memory-view"
      options={[
        { value: 'memories', label: 'Active', testId: 'memory-view-memories' },
        { value: 'proposals', label: typeof pending === 'number' ? `Proposed (${pending})` : 'Proposed', testId: 'memory-view-proposals' },
        { value: 'not-accepted', label: 'Not accepted', testId: 'memory-view-not-accepted' },
      ]} />
  );
  // The pills keep one place in the tree on every view, so the focused pill keeps focus when the address changes.
  const searchTools = (
    <>
    {view === 'memories' && (
    <CalmSearch value={queryInput} onChange={setQueryInput} onSubmit={applyQuery} placeholder="Search what was learned" label="Search memories"
      testId="memories-search" buttonTestId={/* testid */ 'memories-search-open'} startOpen={filtered}
      extra={<>
        <button type="button" className="wk-calm-btn wk-calm-btn--link" data-testid="memories-search-go" onClick={applyQuery}>Search</button>
        {kindPick}
        {facetPairs.length > 0 && <FacetAutocomplete testId="memories-facet-filter" options={facetPairs} value={facet} onChange={setFacet} label="Filter memories by tags" placeholder="Filter by tag" />}
      </>} />
    )}
    {pills}
    </>
  );

  const list = (
    <CalmSection label={view === 'proposals' ? 'Waiting for you' : view === 'not-accepted' ? 'Not accepted' : 'Recently learned'} tools={searchTools} data-testid="memory-list-card" ariaLabel="Memories">
      {note !== null && (
        <CalmNote tone={note.tone} data-testid="memories-note" role="status">
          {note.text} <button type="button" className="wk-link wk-se-x" onClick={() => setNote(null)} aria-label="Dismiss">Dismiss</button>
        </CalmNote>
      )}
      {coverage.kind === 'failed' && error === null && <StateBanner kind={coverage.error.kind} what="the memory totals" error={coverage.error.message} onRetry={loadCoverage} />}
      {view === 'proposals' ? (
        <div className="wk-se-proposals wk-calm-proposals" data-testid="memory-proposals">
          <ProposalsSection kind="memory" heading="Memory proposals" editable revision={proposalsRev} runId={runFilter}
            onShowAll={() => go('proposals')} onDecision={() => { setReviewTick((t) => t + 1); reread(); }} onSettled={() => setRejectedRev((r) => r + 1)} />
        </div>
      ) : view === 'not-accepted' ? (
        <NotAcceptedList kind="memory" revision={rejectedRev} projectName={projectName} />
      ) : loading && memories.length === 0 ? (
        // A re-read after a write keeps the rows on screen (no flash to the loading shape); the first read shows it.
        <CalmLoading data-testid="memories-loading" rows={4} label="Reading what your helpers learned" />
      ) : unsupported ? (
        <CalmEmpty data-testid="memories-unsupported" title="This crew can’t browse its memories yet." body={<p>Memory proposals still show under Proposed.</p>} />
      ) : error !== null ? (
        <StateBanner data-testid="memories-error" kind={error.kind} what="the memories" error={error.message} onRetry={() => void load(query)} />
      ) : visible.length === 0 ? (
        <CalmEmpty data-testid="memories-empty"
          title={filtered ? (memories.length > 0 ? 'No memory matches these filters.' : `No memory matches “${query}”.`)
            // The store's own total says otherwise (#406): never call a non-empty store empty.
            : total !== null && total > 0 ? `The store holds ${total} ${total === 1 ? 'memory' : 'memories'}, but none were listed. Try a search.`
            : 'When your helpers learn something, it shows up here.'}
          body={filtered || (total !== null && total > 0) ? undefined
            : <p>It may come from a session, or from something you tell them. Agents propose what to keep; you approve it.</p>}
          action={filtered
            ? <CalmButton onClick={clearFilters} testId="memories-clear">Clear filters</CalmButton>
            : <CalmButton onClick={addIt}>Tell your helpers something</CalmButton>} />
      ) : (
        <CalmRows data-testid="memories-list" label="Memories">{visible.map(memoryRow)}</CalmRows>
      )}
      {view === 'memories' && !loading && !unsupported && error === null && visible.length > 0 && (
        <p className="wk-calm-foot" data-testid="memories-count" data-count={visible.length}>
          {filtered ? `${visible.length} shown of ${memories.length} read`
            : total !== null && total > memories.length ? `${visible.length} listed of ${total} in the store`
            : `${visible.length} ${visible.length === 1 ? 'memory' : 'memories'}`}
          {filtered && <> · <button type="button" className="wk-link wk-se-linkbtn" data-testid="memories-clear" onClick={clearFilters}>Clear filters</button></>}
        </p>
      )}
    </CalmSection>
  );

  return (
    <div className="wk-se wk-mem wk-se--calm" data-testid="memory-page" data-view={view}>
      <div className="wk-se-scroll wk-calm" ref={scrollRef}>
        <div className="wk-calm-col">
          <CalmHead title="Memory" titleAside={<PageAskButton kind="memory" testId="memory-page-ask" />} sentence={<span data-testid="memory-intro">{sentence}</span>} sentenceTestId={/* testid */ 'memory-sentence'} action={action} />
          {panel === 'import' ? (
            <MemoryCaptureAdd key={panel} mode="import" project={project ?? 'default'}
              projects={[{ id: 'default', name: 'Unfiled (every project)' }, ...projects.filter((p) => p.id !== 'default').map((p) => ({ id: p.id, name: p.name }))]}
              onClose={() => setPanel(null)} onKept={() => { reread(); setReviewTick((t) => t + 1); }} />
          ) : panel === 'table' ? (
            <MemoryTable memories={memories} onSaved={reread} onClose={() => setPanel(null)} />
          ) : panel === 'retired' ? (
            <>
            {note !== null && (
              <CalmNote tone={note.tone} data-testid="memories-note" role="status">
                {note.text} <button type="button" className="wk-link wk-se-x" onClick={() => setNote(null)} aria-label="Dismiss">Dismiss</button>
              </CalmNote>
            )}
            <MemoryRetired soft={soft} revision={retiredRev} onClose={() => setPanel(null)} onBrought={() => { reread(); setRetiredRev((r) => r + 1); }} onErase={(m) => setRetiring({ memory: m, width: 'erase', token: ++opened.current })} />
            </>
          ) : null}
          {panel === 'table' || panel === 'retired' ? null : list}
        </div>
      </div>
      {adding !== null && (
        <AddMemoryDialog key={adding} background={scrollRef} project={project} projects={projects} onClose={() => setAdding(null)}
          onDone={(text, tone) => { const mine = adding; setAdding((cur) => (cur === mine ? null : cur)); setNote({ tone, text }); reread(); setReviewTick((t) => t + 1); setProposalsRev((r) => r + 1); }} />
      )}
      {editing !== null && (
        <EditMemoryDialog key={editing.token} memory={editing.memory} background={scrollRef} onClose={() => setEditing(null)}
          onDone={(text, tone) => { const mine = editing.token; setEditing((cur) => (cur?.token === mine ? null : cur)); setNote({ tone, text }); if (tone === 'ok') reread(); }} />
      )}
      {retiring !== null && (
        <RetireMemoryDialog key={retiring.token} memory={retiring.memory} width={retiring.width} soft={soft} background={scrollRef} onClose={() => setRetiring(null)}
          onDone={(text, tone) => { const mine = retiring.token; setRetiring((cur) => (cur?.token === mine ? null : cur)); setNote({ tone, text }); if (tone === 'ok') { reread(); setRetiredRev((r) => r + 1); } }} />
      )}
    </div>
  );
}

type Done = (text: string, tone: 'ok' | 'fail') => void;

function Dialog({ title, sub, testId, background, onClose, children }: {
  title: string; sub: React.ReactNode; testId: string; background: React.RefObject<HTMLElement | null>; onClose: () => void; children: React.ReactNode;
}): React.ReactElement {
  useModalEscape(onClose);
  const box = useRef<HTMLDivElement | null>(null);
  useDialogFocus(true, box, { modal: true, background, prefer: 'textarea' });
  return (
    <div className="wk-se-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} className="wk-card wk-se-dialog" data-testid={testId}>
        <h2 id={`${testId}-title`} className="wk-se-dialog-title">{title}</h2>
        <p className="wk-se-dialog-sub">{sub}</p>
        {children}
      </div>
    </div>
  );
}

/** Add a memory: filed as a proposal and approved in one step (crew has no direct memory write). */
function AddMemoryDialog({ background, project, projects, onClose, onDone }: {
  background: React.RefObject<HTMLElement | null>; project: string | null; projects: readonly { id: string; name: string }[]; onClose: () => void; onDone: Done;
}): React.ReactElement {
  const [text, setText] = useState('');
  const [where, setWhere] = useState<string>(project !== null && project !== 'default' ? project : '');
  // (studio#1095) The kind it is filed as (a fact unless the person says otherwise), and the one repository it is
  // recalled on (crew's `repo` facet: the repository's id, as a run on it names it).
  const [tier, setTier] = useState<FileProposalTier>('semantic');
  const [repo, setRepo] = useState<string>('');
  const [repos, setRepos] = useState<RepoEntry[] | null>(getCachedRepos());
  /** The repository list could not be read: said beside the picker, with a retry that keeps the form. */
  const [reposFailed, setReposFailed] = useState(false);
  const [reposTry, setReposTry] = useState(0);
  useEffect(() => {
    let live = true;
    setReposFailed(false);
    Promise.resolve().then(fetchReposCached).then((r) => { if (live) setRepos(r); }, () => { if (live) setReposFailed(true); });
    return () => { live = false; };
  }, [reposTry]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  /** An older crew refused the kind or the repository (nothing was filed): what to change, said plainly. */
  const [refused, setRefused] = useState<{ text: string; raw: string } | null>(null);
  const words = text.trim();
  const save = async (): Promise<void> => {
    if (words === '' || busy) return;
    setBusy(true); setError(null); setRefused(null);
    try {
      await addMemory({ content: words, tier, ...(where === '' ? {} : { project: where }), ...(repo === '' ? {} : { repo }) });
      onDone(`Added: ${shortContent(words)}`, 'ok');
    } catch (e) {
      if (e instanceof AddMemoryApproveError) onDone(`Filed as a proposal, but approving it failed (${e.message}). It waits under Proposals; nothing was remembered yet.`, 'fail');
      else if (e instanceof AddMemoryScopeUnsupported) {
        // Nothing was filed: the dialog stays open with the words, and says what to change.
        setRefused({ text: scopeRefusedWords(e.refused), raw: e.message });
        setBusy(false);
      } else { setError(failure(e)); setBusy(false); }
    }
  };
  const choices = projects.filter((p) => p.id !== 'default');
  return (
    <Dialog title="Add a memory" testId="memory-add-dialog" background={background} onClose={onClose}
      sub="Something helpers should know and recall. crew files it as a memory proposal and you approve it in the same step, so it is on the record like any approved proposal.">
      <label className="wk-se-field">
        <span>What should helpers remember?</span>
        <textarea data-testid="memory-add-text" className="wk-field" rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="e.g. The billing service is deployed by hand on Fridays; never schedule it." />
      </label>
      <label className="wk-se-field">
        <span>Save it as</span>
        <select data-testid="memory-add-tier" className="wk-field" value={tier} onChange={(e) => setTier(e.target.value as FileProposalTier)}>
          {FILE_PROPOSAL_TIERS.map((t) => <option key={t} value={t}>{ADD_TIER_WORDS[t]}</option>)}
        </select>
      </label>
      <label className="wk-se-field">
        <span>Recall it on</span>
        <select data-testid="memory-add-project" className="wk-field" value={where} onChange={(e) => setWhere(e.target.value)}>
          <option value="">Every project</option>
          {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="wk-se-field">
        <span>Only on this repository</span>
        <select data-testid="memory-add-repo" className="wk-field" value={repo} onChange={(e) => setRepo(e.target.value)}>
          <option value="">Any repository</option>
          {(repos ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {reposFailed && (
          <span className="wk-field-note" data-testid="memory-add-repo-failed" role="status">
            Couldn’t read your repositories.{' '}
            <button type="button" className="wk-link" data-testid="memory-add-repo-retry" onClick={() => setReposTry((n) => n + 1)}>Try again</button>
          </span>
        )}
      </label>
      {refused !== null && (
        <div className="wk-state-banner wk-state-banner--fail" role="alert" data-testid="memory-add-refused">
          <p className="wk-state-banner-text">{refused.text}</p>
          <TechDetails text={refused.raw} />
        </div>
      )}
      {error !== null && <StateBanner kind={error.kind} what="the new memory" error={error.message} onRetry={() => void save()} />}
      <div className="wk-se-dialog-actions">
        <button type="button" className="wk-btn wk-btn--secondary" data-testid="memory-add-cancel" onClick={onClose}>Cancel</button>
        <button type="button" className="wk-btn wk-btn--primary" data-testid="memory-add-save" disabled={words === '' || busy} onClick={() => void save()}>{busy ? 'Adding…' : 'Add and approve'}</button>
      </div>
    </Dialog>
  );
}

/** Edit a memory's words: crew writes them as a new memory (same kind, scope and tags) and retires the old one. */
function EditMemoryDialog({ memory, background, onClose, onDone }: {
  memory: MemoryItem; background: React.RefObject<HTMLElement | null>; onClose: () => void; onDone: Done;
}): React.ReactElement {
  const [text, setText] = useState(memory.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const words = text.trim();
  const changed = words !== '' && words !== memory.content.trim();
  const save = async (): Promise<void> => {
    if (!changed || busy) return;
    setBusy(true); setError(null);
    try {
      await editMemory({ memory_id: memory.id, content: words });
      onDone(`Edited: ${shortContent(words)}`, 'ok');
    } catch (e) {
      if (isMemoryEditUnsupported(e)) onDone('This crew can’t edit a memory yet, so nothing changed. Retire it and add the new words instead.', 'fail');
      else { setError(failure(e)); setBusy(false); }
    }
  };
  return (
    <Dialog title="Edit a memory" testId="memory-edit-dialog" background={background} onClose={onClose}
      sub="The store can’t change a memory in place: your words are saved as a new memory with the same kind, scope and tags, and this one is deleted for good (it is not kept under Show retired). If this one can’t be deleted, the new one is taken back out, and you are told what the store holds.">
      <label className="wk-se-field">
        <span>The memory</span>
        <textarea data-testid="memory-edit-text" className="wk-field" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {error !== null && <StateBanner kind={error.kind} what="the edit" error={error.message} onRetry={() => void save()} />}
      <div className="wk-se-dialog-actions">
        <button type="button" className="wk-btn wk-btn--secondary" data-testid="memory-edit-cancel" onClick={onClose}>Cancel</button>
        <button type="button" className="wk-btn wk-btn--primary" data-testid="memory-edit-save" disabled={!changed || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Dialog>
  );
}

/**
 * Retire one memory, delete one for good, or delete every memory at or under its scope (the count read first).
 *
 * `soft` (crew#1697, `capabilities.memoryRestore`): a one-memory retire hides the memory and keeps it, so Show retired
 * can restore it; `erase` deletes one for good. `false` (an older crew): a retire ERASES, and the words say so. `null`
 * (not known): the words name both outcomes, and the note after it reads what the daemon answered (`retired` = kept,
 * `erased` = gone). The scope-wide move is a delete for good on either crew (`POST /memory/retire` erases a subtree,
 * retired memories in it too, so a soft crew counts both).
 */
export function RetireMemoryDialog({ memory, width, soft, background, onClose, onDone }: {
  memory: MemoryItem; width: 'item' | 'scope' | 'erase'; soft: boolean | null; background: React.RefObject<HTMLElement | null>; onClose: () => void; onDone: Done;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  /** Live memories in the scope, and (on a soft crew) retired ones; `retired: null` = not counted. */
  const [count, setCount] = useState<{ live: number; retired: number | null } | null | 'failed'>(null);
  const [countTick, setCountTick] = useState(0);
  useEffect(() => {
    if (width !== 'scope') return undefined;
    let alive = true;
    setCount(null);
    // `/memory/coverage` counts live memories only; the subtree erase takes the retired ones too. An older crew
    // (`soft === false`) has none, and its `GET /memory` ignores `retired=1`, so it is never asked.
    const retiredCount: Promise<number | null> = soft === false ? Promise.resolve(0)
      : listRetiredMemories({ scope_prefix: memory.scope }).then((rs) => rs.length, () => null);
    void Promise.all([memoryCoverage({ scope_prefix: memory.scope }), retiredCount])
      .then(([{ total }, retired]) => { if (alive) setCount(typeof total === 'number' ? { live: total, retired } : 'failed'); })
      .catch(() => { if (alive) setCount('failed'); });
    return () => { alive = false; };
  }, [width, memory.scope, countTick, soft]);
  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (width === 'item') {
        const res = await retireMemoryItem({ memory_id: memory.id });
        // What the daemon did, not what was assumed: `retired` = kept (soft), `erased` = gone (an older crew).
        const kept = typeof res.retired === 'number' || (soft === true && typeof res.erased !== 'number');
        onDone(kept ? `Retired: ${shortContent(memory.content)}. Restore it from Show retired.` : `Retired: ${shortContent(memory.content)}. The store erased it; it can’t be restored.`, 'ok');
      } else if (width === 'erase') {
        await eraseMemoryItem({ memory_id: memory.id });
        onDone(`Deleted for good: ${shortContent(memory.content)}`, 'ok');
      } else {
        const { erased } = await retireMemory({ scope_prefix: memory.scope });
        onDone(soft !== false
          ? `Deleted everything in ${memory.scope} for good: ${erased} ${erased === 1 ? 'memory' : 'memories'}.`
          : `Retired everything in ${memory.scope}: ${erased} ${erased === 1 ? 'memory' : 'memories'} erased.`, 'ok');
      }
    } catch (e) {
      if (width !== 'scope' && isEraseByIdUnsupported(e)) {
        onDone(width === 'erase' ? 'This crew can’t delete a single memory yet, so nothing was deleted.'
          : soft !== false ? 'This daemon’s memory store can’t retire a memory yet, so nothing changed.'
          : 'This crew can’t retire a single memory yet, so nothing was deleted. Retire its whole scope instead.', 'fail');
      } else { setError(failure(e)); setBusy(false); }
    }
  };
  const mems = (k: number): string => `${k} ${k === 1 ? 'memory' : 'memories'}`;
  const scopeCount = count === null ? '' : count === 'failed' ? ' (couldn’t count them)'
    : count.retired === null ? `: ${mems(count.live)}, and any retired ones filed there`
    : count.retired > 0 ? `: ${mems(count.live)} and ${count.retired} retired ${count.retired === 1 ? 'one' : 'ones'}`
    : `: ${mems(count.live)}`;
  const title = width === 'item' ? 'Retire this memory?' : width === 'erase' ? 'Delete this memory for good?' : soft !== false ? 'Delete everything in this scope for good?' : 'Retire everything in this scope?';
  const sub = width === 'item'
    ? (soft === true ? 'Helpers stop recalling it. It is kept: you can restore it from Show retired, or delete it for good there.'
      : soft === false ? 'Helpers stop recalling it. Only this memory is erased; others in its scope stay. This can’t be undone.'
      : 'Helpers stop recalling it. Studio couldn’t read what this daemon supports: a current one keeps it under Show retired, an older one erases it for good.')
    : width === 'erase' ? 'Helpers stop recalling it and the store deletes it. This can’t be undone.'
    : <>Every memory filed at or under <code>{memory.scope}</code> is {soft !== false ? 'deleted for good' : 'erased'}{scopeCount}. This can’t be undone.</>;
  const go = width === 'item' ? 'Retire this memory' : width === 'erase' ? 'Delete for good' : soft !== false ? 'Delete everything in this scope' : 'Retire everything in this scope';
  return (
    <Dialog title={title} testId={width === 'erase' ? 'memory-erase-dialog' : 'memory-retire-dialog'} background={background} onClose={onClose} sub={sub}>
      <blockquote className="wk-mem-quote" data-testid={width === 'erase' ? 'memory-erase-content' : 'memory-retire-content'}>{memory.content}</blockquote>
      {width === 'scope' && count === 'failed' && <button type="button" className="wk-link wk-se-linkbtn" onClick={() => setCountTick((t) => t + 1)}>Count again</button>}
      {error !== null && <StateBanner kind={error.kind} what={width === 'item' ? 'the retirement' : 'the deletion'} error={error.message} onRetry={() => void confirm()} />}
      <div className="wk-se-dialog-actions">
        <button type="button" className="wk-btn wk-btn--secondary" data-testid={width === 'erase' ? 'memory-erase-cancel' : 'memory-retire-cancel'} onClick={onClose}>Cancel</button>
        <button type="button" className="wk-btn wk-btn--danger" data-testid={width === 'erase' ? 'memory-erase-confirm' : 'memory-retire-confirm'} disabled={busy} onClick={() => void confirm()}>
          {busy ? (width === 'item' ? 'Retiring…' : 'Deleting…') : go}
        </button>
      </div>
    </Dialog>
  );
}
