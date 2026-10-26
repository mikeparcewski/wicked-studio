import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  addMemory, AddMemoryApproveError, editMemory, isEraseByIdUnsupported, isMemoryEditUnsupported, isMemoryUnsupported,
  listMemories, memoryCoverage, memoryPath, readMemoryView, retireMemory, retireMemoryItem,
  type MemoryCoverage, type MemoryItem, type MemoryView,
} from '../../api/memory.js';
import { isProposalsUnsupported, listProposals, proposalKind } from '../../api/proposals.js';
import { readErrorKind } from '../../api/errors.js';
import { relTime } from '../../board/relTime.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useNeedsSources } from '../../store/needsSources.js';
import { useProjectsStore } from '../../store/projects.js';
import { FacetAutocomplete } from '../FacetAutocomplete.js';
import { useModalEscape } from '../Modal.js';
import { shortContent } from '../ProposalChips.js';
import { ProposalsSection } from '../ProposalsSection.js';
import { StateBanner, TechDetails } from '../ui/index.js';
import { CalmAction, CalmButton, CalmEmpty, CalmFacts, CalmHead, CalmLoading, CalmNote, CalmRow, CalmRows, CalmSearch, CalmSection } from '../calm/Calm.js';
import { memoryOrigin, memorySentence, shortDate } from '../../board/calmMemory.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';

/**
 * THE MEMORY PAGE (operator 2026-10-17: "memories and steering are separate"). Memory is what
 * helpers REMEMBER — witnessed or told context they recall; Steer is the rules they are HELD to.
 * A Desk tab beside Steer (`/memory`, `/memory?view=proposals`), in Steer's visual language:
 *
 *  - tiles: the store's real totals (`GET /memory/coverage`), the memory proposals waiting on you,
 *    and Add a memory;
 *  - the kinds (tiers) as cards with the store's counts — the kind filter;
 *  - the list: Memories (search, tag filter, Edit, Retire one, Retire a scope) and Proposals
 *    (approve as filed or with an edit, reject).
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

/** Where a memory applies, in words: its project facet, else its scope, else everywhere. */
function whereWords(m: MemoryItem, projectName: (id: string) => string | null): string {
  const project = m.facets.project;
  if (project !== undefined && project !== '') return projectName(project) ?? `Project ${project}`;
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
  const go = (v: MemoryView): void => navigate(address(memoryPath(v)));

  // ── Reads ────────────────────────────────────────────────────────────────────────────────────
  const [memories, setMemories] = useState<MemoryItem[]>([]);
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

  // ── Moves ────────────────────────────────────────────────────────────────────────────────────
  const [note, setNote] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  const opened = useRef(0);
  const [adding, setAdding] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ memory: MemoryItem; token: number } | null>(null);
  const [retiring, setRetiring] = useState<{ memory: MemoryItem; width: 'item' | 'scope'; token: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Pieces (the calm page: title + one sentence + one action; a quiet search; roomy rows) ──────
  const total = coverage.kind === 'ok' && typeof coverage.value.total === 'number' ? coverage.value.total : null;
  const byTier = coverage.kind === 'ok' ? coverage.value.by_tier ?? {} : {};
  const present = [...TIERS, ...Object.keys(byTier).filter((t) => !(TIERS as readonly string[]).includes(t))].filter((t) => (byTier[t] ?? 0) > 0);
  const tierList = tier !== null && !present.includes(tier) ? [...present, tier] : present;
  const waiting = typeof pending === 'number' ? pending : 0;

  const sentence = memorySentence({ total, pending, coverage: coverage.kind });
  const addIt = (): void => setAdding(++opened.current);
  const refresh = (): void => { reread(); setReviewTick((t) => t + 1); };
  // One action: review what is waiting when something is; otherwise add a memory. The rest sit in its menu.
  const action = waiting > 0 && view !== 'proposals'
    ? <CalmAction label={`Review ${waiting} ${waiting === 1 ? 'proposal' : 'proposals'}`} testId="memory-view-proposals" onClick={() => go('proposals')}
        menuLabel="More for memory" menuTestId="memory-more"
        menu={[{ id: 'add', label: 'Add a memory…', testId: 'memory-add', onSelect: addIt }, { id: 'refresh', label: 'Refresh', testId: 'memories-refresh', onSelect: refresh }]} />
    : <CalmAction label="Add a memory" testId="memory-add" icon={<Plus size={16} aria-hidden />} onClick={addIt}
        menuLabel="More for memory" menuTestId="memory-more"
        menu={[
          ...(view === 'proposals' ? [] : [{ id: 'proposals', label: pending === 'unsupported' ? 'Proposals (not available here)' : 'Show proposals', testId: 'memory-view-proposals', onSelect: () => go('proposals'), disabled: pending === 'unsupported' ? 'This crew has no proposal review' : null }]),
          { id: 'refresh', label: 'Refresh', testId: 'memories-refresh', onSelect: refresh },
        ]} />;

  const memoryRow = (m: MemoryItem): React.ReactElement => {
    const where = whereWords(m, projectName);
    const tags = Object.entries(m.facets).filter(([k]) => k !== 'project');
    const origin = memoryOrigin(m);
    const added = typeof m.created_at === 'number' ? shortDate(m.created_at * 1000) : null;
    return (
      <CalmRow key={m.id} data-testid="memory-row" data={{ 'memory-id': m.id, tier: m.tier, scope: m.scope, origin: origin ?? 'unknown' }}
        tone="accent" title={<span data-testid="memory-content">{m.content}</span>} titleAttr={m.content}
        sub={<span data-testid="memory-meta">{origin === 'told' ? 'Told by you' : origin === 'session' ? 'Learned in a session' : tierWord(m.tier)} · <span data-testid="memory-where">{where}</span></span>}
        meta={added ?? undefined}
        openTestId="memory-open" openLabel={`${shortContent(m.content)}: show details`}
        menuLabel={`More for ${shortContent(m.content)}`} menuTestId="memory-actions"
        menu={[
          { id: 'edit', label: 'Edit…', testId: 'memory-edit', onSelect: () => setEditing({ memory: m, token: ++opened.current }) },
          { id: 'retire', label: 'Retire', danger: true, testId: 'memory-retire', onSelect: () => setRetiring({ memory: m, width: 'item', token: ++opened.current }) },
          ...(m.scope !== '' ? [{ id: 'retire-scope', label: 'Retire everything in this scope…', onSelect: () => setRetiring({ memory: m, width: 'scope', token: ++opened.current }) }] : []),
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
  const searchTools = view === 'memories' ? (
    <CalmSearch value={queryInput} onChange={setQueryInput} onSubmit={applyQuery} placeholder="Search what was learned" label="Search memories"
      testId="memories-search" buttonTestId="memories-search-open" startOpen={filtered}
      extra={<>
        <button type="button" className="wk-calm-btn wk-calm-btn--link" data-testid="memories-search-go" onClick={applyQuery}>Search</button>
        {kindPick}
        {facetPairs.length > 0 && <FacetAutocomplete testId="memories-facet-filter" options={facetPairs} value={facet} onChange={setFacet} label="Filter memories by tags" placeholder="Filter by tag" />}
      </>} />
  ) : (
    <button type="button" className="wk-calm-btn wk-calm-btn--link" data-testid="memory-view-memories" onClick={() => go('memories')}>Back to everything learned</button>
  );

  const list = (
    <CalmSection label={view === 'proposals' ? 'Waiting for you' : 'Recently learned'} tools={searchTools} data-testid="memory-list-card" ariaLabel="Memories">
      {note !== null && (
        <CalmNote tone={note.tone} data-testid="memories-note" role="status">
          {note.text} <button type="button" className="wk-link wk-se-x" onClick={() => setNote(null)} aria-label="Dismiss">Dismiss</button>
        </CalmNote>
      )}
      {coverage.kind === 'failed' && <StateBanner kind={coverage.error.kind} what="the memory totals" error={coverage.error.message} onRetry={loadCoverage} />}
      {view === 'proposals' ? (
        <div className="wk-se-proposals wk-calm-proposals" data-testid="memory-proposals">
          <ProposalsSection kind="memory" heading="Memory proposals" editable revision={proposalsRev} onDecision={() => { setReviewTick((t) => t + 1); reread(); }} />
        </div>
      ) : loading ? (
        <CalmLoading data-testid="memories-loading" rows={4} label="Reading what your agents learned" />
      ) : unsupported ? (
        <CalmEmpty data-testid="memories-unsupported" title="This crew can’t browse its memories yet." body={<p>Memory proposals still show under Review.</p>} />
      ) : error !== null ? (
        <StateBanner data-testid="memories-error" kind={error.kind} what="the memories" error={error.message} onRetry={() => void load(query)} />
      ) : visible.length === 0 ? (
        <CalmEmpty data-testid="memories-empty"
          title={filtered ? (memories.length > 0 ? 'No memory matches these filters.' : `No memory matches “${query}”.`)
            // The store's own total says otherwise (#406): never call a non-empty store empty.
            : total !== null && total > 0 ? `The store holds ${total} ${total === 1 ? 'memory' : 'memories'}, but none were listed.`
            : 'Your agents haven’t learned anything yet.'}
          body={filtered ? undefined : total !== null && total > 0 ? <p>Try a search.</p>
            : <p>When an agent learns something in a session, or you tell it something, it shows up here. Agents propose what to keep; you approve it.</p>}
          action={filtered
            ? <CalmButton onClick={clearFilters} testId="memories-clear">Clear filters</CalmButton>
            : <CalmButton onClick={addIt}>Tell your agents something</CalmButton>} />
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
          <CalmHead title="Memory" sentence={<span data-testid="memory-intro">{sentence}</span>} sentenceTestId="memory-sentence" action={action} />
          {list}
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
        <RetireMemoryDialog key={retiring.token} memory={retiring.memory} width={retiring.width} background={scrollRef} onClose={() => setRetiring(null)}
          onDone={(text, tone) => { const mine = retiring.token; setRetiring((cur) => (cur?.token === mine ? null : cur)); setNote({ tone, text }); if (tone === 'ok') reread(); }} />
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const words = text.trim();
  const save = async (): Promise<void> => {
    if (words === '' || busy) return;
    setBusy(true); setError(null);
    try {
      await addMemory(where === '' ? { content: words } : { content: words, project: where });
      onDone(`Added: ${shortContent(words)}`, 'ok');
    } catch (e) {
      if (e instanceof AddMemoryApproveError) onDone(`Filed as a proposal, but approving it failed (${e.message}). It waits under Proposals; nothing was remembered yet.`, 'fail');
      else { setError(failure(e)); setBusy(false); }
    }
  };
  const choices = projects.filter((p) => p.id !== 'default');
  return (
    <Dialog title="Add a memory" testId="memory-add-dialog" background={background} onClose={onClose}
      sub="Something helpers should know and recall. It is saved as a fact: crew files it as a memory proposal and you approve it in the same step, so it is on the record like any approved proposal.">
      <label className="wk-se-field">
        <span>What should helpers remember?</span>
        <textarea data-testid="memory-add-text" className="wk-field" rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="e.g. The billing service is deployed by hand on Fridays; never schedule it." />
      </label>
      <label className="wk-se-field">
        <span>Recall it on</span>
        <select data-testid="memory-add-project" className="wk-field" value={where} onChange={(e) => setWhere(e.target.value)}>
          <option value="">Every project</option>
          {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
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
      sub="The store can’t change a memory in place: your words are saved as a new memory with the same kind, scope and tags, and this one is retired. If this one can’t be retired, the new one is taken back out, and you are told what the store holds.">
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

/** Retire one memory, or every memory at or under its scope (the count read first). */
function RetireMemoryDialog({ memory, width, background, onClose, onDone }: {
  memory: MemoryItem; width: 'item' | 'scope'; background: React.RefObject<HTMLElement | null>; onClose: () => void; onDone: Done;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [count, setCount] = useState<number | null | 'failed'>(null);
  const [countTick, setCountTick] = useState(0);
  useEffect(() => {
    if (width !== 'scope') return undefined;
    let alive = true;
    setCount(null);
    void memoryCoverage({ scope_prefix: memory.scope })
      .then(({ total }) => { if (alive) setCount(typeof total === 'number' ? total : 'failed'); })
      .catch(() => { if (alive) setCount('failed'); });
    return () => { alive = false; };
  }, [width, memory.scope, countTick]);
  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (width === 'item') {
        await retireMemoryItem({ memory_id: memory.id });
        onDone(`Retired: ${shortContent(memory.content)}`, 'ok');
      } else {
        const { erased } = await retireMemory({ scope_prefix: memory.scope });
        onDone(`Retired everything in ${memory.scope}: ${erased} ${erased === 1 ? 'memory' : 'memories'} erased.`, 'ok');
      }
    } catch (e) {
      if (width === 'item' && isEraseByIdUnsupported(e)) onDone('This crew can’t retire a single memory yet, so nothing was deleted. Retire its whole scope instead.', 'fail');
      else { setError(failure(e)); setBusy(false); }
    }
  };
  return (
    <Dialog title={width === 'item' ? 'Retire this memory?' : 'Retire everything in this scope?'} testId="memory-retire-dialog" background={background} onClose={onClose}
      sub={width === 'item'
        ? 'Helpers stop recalling it. Only this memory is erased; others in its scope stay. This can’t be undone.'
        : <>Every memory filed at or under <code>{memory.scope}</code> is erased{count === null ? '' : typeof count === 'number' ? `: ${count} ${count === 1 ? 'memory' : 'memories'}` : ' (couldn’t count them)'}. This can’t be undone.</>}>
      <blockquote className="wk-mem-quote" data-testid="memory-retire-content">{memory.content}</blockquote>
      {width === 'scope' && count === 'failed' && <button type="button" className="wk-link wk-se-linkbtn" onClick={() => setCountTick((t) => t + 1)}>Count again</button>}
      {error !== null && <StateBanner kind={error.kind} what="the retirement" error={error.message} onRetry={() => void confirm()} />}
      <div className="wk-se-dialog-actions">
        <button type="button" className="wk-btn wk-btn--secondary" data-testid="memory-retire-cancel" onClick={onClose}>Cancel</button>
        <button type="button" className="wk-btn wk-btn--danger" data-testid="memory-retire-confirm" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Retiring…' : width === 'item' ? 'Retire this memory' : 'Retire everything in this scope'}
        </button>
      </div>
    </Dialog>
  );
}
