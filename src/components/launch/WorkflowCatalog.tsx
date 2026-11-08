import { useId, useMemo, useRef, useState } from 'react';
import {
  applyFilters, filtersActive, needsLine, NO_FILTERS, searchCatalog, topEntries,
  type CatalogEntry, type CatalogFilters, type CatalogView, type RepoFilter,
} from '../../board/workflowCatalog.js';
import { artShapeOf, hasWorkflowArt, WorkflowArt } from './WorkflowArt.js';

/**
 * NEW JOB'S FIRST STEP: THE WORKFLOW CATALOG (operator 2026-11-01). Search on top, filters under it,
 * then one scrolling panel: "Best fit" for the words New job was opened with, "Your top" (what this
 * operator launches most, recency-weighted; hidden for a new user), then a section per category.
 * Typing replaces the sections with one ranked list. An older daemon has no categories: one
 * uncategorised list, still searchable.
 *
 * Keyboard: focus starts in the search box (or on the job already picked); ArrowDown goes to the
 * first card; the arrows move between cards as laid out (Up from the top row returns to search);
 * Enter in the search box picks the best match; Enter or Space on a card picks it.
 */
export interface WorkflowCatalogProps {
  /** null while the catalog (or the older daemon's list) is still being read. */
  view: CatalogView | null;
  /** The daemon serves a catalog but this read failed, and there is none to show. */
  failed?: boolean;
  /** The draft's workflow, when one is picked (Change job): its card is pressed and focused. */
  pickedId: string | null;
  /** The card picked, when the pick came from the catalog (two cards may launch one workflow). */
  pickedEntryId?: string | null;
  /** The words New job was opened with (the desk ask): "Best fit" ranks the catalog by them. */
  intent: string;
  now: number;
  onPick: (e: CatalogEntry) => void;
  onChat: () => void;
}

type Place = 'fit' | 'top' | 'cat' | 'result';
const BEST_FIT_MAX = 3;

export function WorkflowCatalog({ view, failed = false, pickedId, pickedEntryId = null, intent, now, onPick, onChat }: WorkflowCatalogProps): React.ReactElement {
  const isPicked = (en: CatalogEntry): boolean =>
    pickedId !== null && en.launchId === pickedId && (pickedEntryId === null || en.id === pickedEntryId);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CatalogFilters>(NO_FILTERS);
  const [moreFilters, setMoreFilters] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchId = useId();
  const filtersId = useId();

  const older = view?.source === 'fallback';
  const categories = useMemo(() => view?.categories ?? [], [view]);
  const catTitle = useMemo(() => new Map(categories.map((c) => [c.id, c.title] as const)), [categories]);
  const searching = query.trim() !== '';
  const filtered = useMemo(() => (view === null ? [] : applyFilters(view.entries, filters)), [view, filters]);
  // The chip counts ignore the category choice (each chip says what picking it would show).
  const forCounts = useMemo(() => (view === null ? [] : applyFilters(view.entries, { ...filters, category: null })), [view, filters]);
  const results = useMemo(() => {
    if (view === null || !searching) return [];
    const keep = new Set(filtered);
    return searchCatalog(view, query, now).filter((e) => keep.has(e));
  }, [view, searching, query, now, filtered]);
  const unfiltered = !filtersActive(filters);
  const fit = useMemo(() => (view === null || searching || !unfiltered || intent.trim() === ''
    ? [] : searchCatalog(view, intent, now).filter((e) => e.status === 'ready' && e.launchKind !== 'none').slice(0, BEST_FIT_MAX)), [view, searching, unfiltered, intent, now]);
  const top = useMemo(() => (view === null || searching || filters.category !== null || filters.repo !== 'any' ? [] : topEntries(view.entries, now)), [view, searching, filters, now]);
  const sections = useMemo(() => {
    if (view === null || searching) return [];
    if (older) return filtered.length === 0 ? [] : [{ id: 'all', title: 'All workflows', blurb: null as string | null, entries: filtered }];
    return categories
      .filter((c) => filters.category === null || c.id === filters.category)
      .map((c) => ({ id: c.id, title: c.title, blurb: c.blurb, entries: filtered.filter((e) => e.category === c.id) }))
      .filter((s) => s.entries.length > 0);
  }, [view, searching, older, categories, filters.category, filtered]);

  const setFilter = (patch: Partial<CatalogFilters>): void => setFilters((f) => ({ ...f, ...patch }));
  const clearAll = (): void => { setQuery(''); setFilters(NO_FILTERS); searchRef.current?.focus(); };

  const cardButtons = (): HTMLButtonElement[] => [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button[data-catalog-card]') ?? [])];
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      const first = cardButtons()[0];
      if (first !== undefined) { e.preventDefault(); first.focus(); first.scrollIntoView?.({ block: 'nearest' }); }
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      cardButtons()[0]?.click();
    }
  };
  // Arrows move as the cards are laid out: Left/Right in reading order, Up/Down to the nearest card
  // in the row above or below (sections included). Home/End go to the ends.
  const onPanelKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const btns = cardButtons();
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const last = btns.length - 1;
    let to: number | null = null;
    if (e.key === 'ArrowRight') to = Math.min(at + 1, last);
    else if (e.key === 'ArrowLeft') to = Math.max(at - 1, 0);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      to = verticalNeighbour(btns, at, e.key === 'ArrowDown' ? 1 : -1);
      if (to === null && e.key === 'ArrowUp') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (to === null) to = at;
    }
    if (to === null) return;
    e.preventDefault();
    btns[to]?.focus();
    btns[to]?.scrollIntoView?.({ block: 'nearest' });
  };

  const card = (en: CatalogEntry, place: Place): React.ReactElement => {
    const showCat = place !== 'cat' && !older && en.category !== null;
    // Needs and time on the card; cost is on the next step (Usually), so the line never truncates.
    const meta = [needsLine(en), en.time].filter((x): x is string => x !== null && x !== '');
    const offered = en.status === 'ready' && en.launchKind !== 'none';
    const metaText = meta.join(' · ');
    const body = (
      <>
        <span className="wk-catalog-card-art"><WorkflowArt workflowKey={en.artKey} shape={artShapeOf(en)} /></span>
        <span className="wk-catalog-card-words">
          <span className="wk-catalog-card-name">
            <span className="wk-launch-wizard-choice-name">{en.title}</span>
            {showCat && <span className="wk-catalog-card-cat">{catTitle.get(en.category!) ?? ''}</span>}
          </span>
          <span className="wk-launch-wizard-choice-line" title={en.gets}>{en.gets}</span>
          {offered ? (
            <span className="wk-catalog-card-meta" title={metaText}>{metaText}</span>
          ) : (
            <span className="wk-catalog-card-meta" title={en.statusNote ?? undefined}>
              <span className="wk-tag" data-testid={en.status === 'unavailable' ? 'launch-catalog-unavailable-tag' : 'launch-catalog-soon-tag'}>{en.status === 'unavailable' ? 'Not available' : 'Coming soon'}</span>
              {en.statusNote !== null && !/^(coming soon|not available)\.?$/i.test(en.statusNote) ? ` ${en.statusNote}` : ''}
            </span>
          )}
        </span>
      </>
    );
    const key = `${place}:${en.id}`;
    if (!offered) {
      return (
        <div key={key} role="group" aria-disabled="true" aria-label={`${en.title}, ${en.status === 'unavailable' ? 'not available' : 'coming soon'}`}
          data-testid={`launch-catalog-soon-${en.id}`} data-job={en.id}
          className="wk-launch-wizard-choice wk-catalog-card wk-catalog-card--soon">{body}</div>
      );
    }
    const on = isPicked(en);
    return (
      <button
        key={key}
        type="button"
        data-catalog-card={place}
        data-job={en.id}
        data-testid={place === 'fit' ? `launch-catalog-fit-${en.launchId}` : place === 'top' ? `launch-catalog-top-${en.launchId}` : `launch-wizard-workflow-${en.launchId}`}
        data-art={hasWorkflowArt(en.artKey) ? en.artKey : artShapeOf(en) ?? 'fallback'}
        data-autofocus={on && place === 'cat' ? 'true' : undefined}
        aria-pressed={on}
        className={`wk-launch-wizard-choice wk-catalog-card${on ? ' wk-launch-wizard-choice--on' : ''}`}
        onClick={() => onPick(en)}
      >{body}</button>
    );
  };

  const section = (id: string, title: string, blurb: string | null, entries: readonly CatalogEntry[], place: Place): React.ReactElement => (
    <section key={id} className="wk-catalog-section" data-testid={place === 'fit' ? 'launch-catalog-fit' : place === 'top' ? 'launch-catalog-top' : 'launch-catalog-section'} data-section={id} aria-labelledby={`${searchId}-${id}`}>
      <h3 id={`${searchId}-${id}`} className="wk-catalog-section-head">
        <span className="wk-catalog-section-title">{title}</span>
        {blurb !== null && blurb !== '' && <span className="wk-catalog-section-blurb">{blurb}</span>}
      </h3>
      <div className="wk-catalog-grid">{entries.map((en) => card(en, place))}</div>
    </section>
  );

  const total = view?.entries.length ?? 0;
  const noResults = view !== null && total > 0 && (searching ? results.length === 0 : sections.length === 0);
  const pickedOnLoad = view?.entries.some((e) => isPicked(e) && e.status === 'ready') ?? false;
  const extraFilters = (filters.repo !== 'any' ? 1 : 0) + (filters.showSoon !== NO_FILTERS.showSoon ? 1 : 0);

  return (
    <div className="wk-catalog" data-testid="launch-catalog" data-source={view?.source ?? 'loading'}>
      <div className="wk-catalog-top">
        <div className="wk-catalog-searchrow">
          <label htmlFor={searchId} className="wk-sr-only">Search the workflows</label>
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            role="searchbox"
            autoComplete="off"
            spellCheck={false}
            data-testid="launch-catalog-search"
            data-autofocus={pickedOnLoad ? undefined : 'true'}
            className="wk-field wk-catalog-search"
            placeholder="What do you want to do? Try “write docs for the auth service”"
            value={query}
            aria-describedby={`${searchId}-count`}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <button type="button" className="wk-btn wk-btn--secondary wk-catalog-chat" data-testid="launch-wizard-start-chat" onClick={onChat}
            title="Not sure yet? Talk it through first, then start a job from the chat">
            <span className="wk-catalog-chat-long">Talk it through first</span><span className="wk-catalog-chat-short" aria-hidden="true">Chat</span>
          </button>
        </div>
        <div className="wk-catalog-filters" data-testid="launch-catalog-filters">
          {!older && categories.length > 0 && (
            <div className="wk-catalog-cats" role="group" aria-label="Category">
              <button type="button" className="wk-chip" aria-pressed={filters.category === null} data-testid="launch-catalog-cat" data-cat="all"
                onClick={() => setFilter({ category: null })}>All <span className="wk-catalog-count">{forCounts.length}</span></button>
              {categories.map((c) => (
                <button key={c.id} type="button" className="wk-chip" aria-pressed={filters.category === c.id} data-testid="launch-catalog-cat" data-cat={c.id}
                  onClick={() => setFilter({ category: filters.category === c.id ? null : c.id })}>
                  {c.title} <span className="wk-catalog-count">{forCounts.filter((e) => e.category === c.id).length}</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm wk-catalog-filters-toggle" data-testid="launch-catalog-filters-toggle"
            aria-expanded={moreFilters} aria-controls={filtersId} onClick={() => setMoreFilters((v) => !v)}>
            Filters{extraFilters > 0 ? ` (${extraFilters})` : ''}
          </button>
          <div id={filtersId} className="wk-catalog-more" data-open={moreFilters ? 'true' : 'false'}>
            <label className="wk-catalog-repo">
              <span className="wk-catalog-filter-label">Repository</span>
              <select className="wk-field" data-testid="launch-catalog-repo" value={filters.repo}
                onChange={(e) => setFilter({ repo: e.target.value as RepoFilter })}>
                <option value="any">Any</option>
                <option value="needs">Needs a repository</option>
                <option value="without">Works without one</option>
              </select>
            </label>
            <label className="wk-catalog-soon-filter">
              <input type="checkbox" data-testid="launch-catalog-soon-toggle" checked={filters.showSoon}
                onChange={(e) => setFilter({ showSoon: e.target.checked })} />
              Show unavailable
            </label>
          </div>
        </div>
      </div>

      <p id={`${searchId}-count`} className="wk-sr-only" role="status" data-testid="launch-catalog-count">
        {view === null ? '' : searching ? `${results.length} ${results.length === 1 ? 'workflow matches' : 'workflows match'}` : ''}
      </p>

      <div className="wk-catalog-panel" ref={panelRef} data-testid="launch-catalog-results" onKeyDown={onPanelKey}>
        {view === null && failed && (
          <div className="wk-catalog-empty" data-testid="launch-catalog-failed" role="alert">
            <p className="wk-field-note">Couldn’t read the workflows. Close New job and open it again to try again.</p>
            <button type="button" className="wk-btn wk-btn--secondary" onClick={onChat}>Talk it through first</button>
          </div>
        )}
        {view === null && !failed && (
          <div data-testid="launch-catalog-loading" aria-busy="true">
            <p className="wk-field-note">Reading the workflows…</p>
            <div className="wk-catalog-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className="wk-catalog-card wk-catalog-card--skeleton" />)}</div>
          </div>
        )}
        {view !== null && older && (
          <p className="wk-field-note" data-testid="launch-catalog-older">This daemon has no workflow catalog yet, so the workflows are not grouped. Search still finds them.</p>
        )}
        {view !== null && total === 0 && (
          <div className="wk-catalog-empty" data-testid="launch-catalog-empty">
            <p className="wk-field-note">This daemon lists no workflows.</p>
            <button type="button" className="wk-btn wk-btn--secondary" onClick={onChat}>Talk it through first</button>
          </div>
        )}
        {noResults && (
          <div className="wk-catalog-empty" data-testid="launch-catalog-noresults">
            <p className="wk-field-note">{searching ? <>Nothing matches “{query.trim()}”{filtersActive(filters) ? ' with these filters' : ''}.</> : 'No workflow fits these filters.'}</p>
            <div className="wk-catalog-empty-actions">
              {searching && <button type="button" className="wk-btn wk-btn--secondary" data-testid="launch-catalog-clear-search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>Clear search</button>}
              {filtersActive(filters) && <button type="button" className="wk-btn wk-btn--secondary" data-testid="launch-catalog-clear-filters" onClick={clearAll}>Clear filters</button>}
              <button type="button" className="wk-btn wk-btn--quiet" onClick={onChat}>Talk it through first</button>
            </div>
          </div>
        )}
        {searching && results.length > 0 && section('results', 'Results', null, results, 'result')}
        {fit.length > 0 && section('fit', 'Best fit for what you asked', `“${clip(intent.trim(), 60)}”`, fit, 'fit')}
        {top.length > 0 && section('top', 'Your top', 'What you start most, recent first', top, 'top')}
        {sections.map((s) => section(s.id, s.title, s.blurb, s.entries, 'cat'))}
      </div>
    </div>
  );
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * The card above or below `at` as laid out: the nearest row in that direction, then the card in it
 * closest to `at`'s horizontal centre. null when there is no row that way. Without layout (every card
 * at one spot), Down and Up move one card in reading order.
 */
export function verticalNeighbour(btns: readonly HTMLElement[], at: number, dir: 1 | -1): number | null {
  const rects = btns.map((b) => b.getBoundingClientRect());
  const cur = rects[at]!;
  const flat = rects.every((r) => r.top === cur.top && r.left === cur.left);
  if (flat) {
    const to = at + dir;
    return to >= 0 && to < btns.length ? to : null;
  }
  const rowTops = [...new Set(rects.map((r) => Math.round(r.top)))].sort((a, b) => a - b);
  const row = rowTops.indexOf(Math.round(cur.top));
  const target = rowTops[row + dir];
  if (target === undefined) return null;
  const cx = cur.left + cur.width / 2;
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  rects.forEach((r, i) => {
    if (Math.round(r.top) !== target) return;
    const d = Math.abs(r.left + r.width / 2 - cx);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
