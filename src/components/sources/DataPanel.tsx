import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Database, Lock, Plus, Table2 } from 'lucide-react';
import { CREW_SOURCE, sourcesApi, type McpServer, type SourceCatalogRelation, type SourceCatalogResponse, type SourceRowWrite } from '../../api/sources.js';
import { OverflowMenu, type MenuItem } from '../ui/OverflowMenu.js';
import { isSqlCatalog, relationName, rowWriteLine, rowsLine, sourceChip } from './sourceModel.js';

/** A declared row write as the panel lists it. */
export interface PanelRowWrite {
  /** Unique per source and declaration (`rowWriteKey`). */
  id: string;
  /** What the list shows. */
  label: string;
  source: string;
  write: SourceRowWrite;
  granted: boolean;
}

/** A query as the panel lists it (the app host supplies them; the Sources page has none). */
export interface PanelQuery {
  id: string;
  meta?: string;
}

/** Why a table's "Declare a row write" is not offered, or `null` when it is. */
export function rowWriteMenuBlocker(source: McpServer, r: SourceCatalogRelation): string | null {
  if (source.kind !== 'sql' || source.sql?.driver !== 'postgres') {
    return source.sql?.driver === 'sqlite' ? 'An upload is a copy: no writes' : 'MySQL sources get no writes in v1';
  }
  if (r.kind !== 'table') return 'Row writes need a plain table';
  if (r.primaryKey.length === 0) return 'No primary key';
  return null;
}

/**
 * THE DATA PANEL (DES-APPS-001 §6.1, mockup states A and B): Sources (＋ opens the sheet), each source's
 * tables with a menu to declare a row write, the queries and actions the host gives it. Pure
 * presentation over what it is handed, except the catalog of a source the person opens (read-only).
 * The components palette is the runtime's (K4) and rides `children`.
 */
export function DataPanel({ sources, epochs, loading, error, onAdd, onOpen, onTest, onAsk, onDeclare, queries, actions, onGrantAction, children, 'data-testid': testId = 'data-panel' }: {
  sources: readonly McpServer[];
  /** Per source, a count the host bumps when it was described again (its tables may have changed). */
  epochs?: Readonly<Record<string, number>>;
  loading: boolean;
  error: string | null;
  onAdd: () => void;
  onOpen: (name: string) => void;
  /** "Test connection" on a saved SQL or GraphQL source (its sheet opens and tests at once). */
  onTest?: (name: string) => void;
  /** "Ask a question…" on a saved SQL source (its sheet opens on the question). */
  onAsk?: (name: string) => void;
  onDeclare: (source: McpServer, relation: SourceCatalogRelation, catalog: SourceCatalogResponse) => void;
  queries?: readonly PanelQuery[] | null;
  actions: readonly PanelRowWrite[];
  onGrantAction: (id: string) => void;
  children?: React.ReactNode;
  'data-testid'?: string;
}): React.ReactElement {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /** Catalogs by source AND version (its descriptor, else its last save): a re-saved source reads afresh. */
  const [catalogs, setCatalogs] = useState<Record<string, SourceCatalogResponse | string>>({});
  const versionOf = (s: McpServer): string => `${s.name}@${s.descriptorHash ?? ''}@${s.updatedAt}@${epochs !== undefined && Object.hasOwn(epochs, s.name) ? epochs[s.name] : 0}`;
  /** The latest request per version: an older answer (or error) never lands over a newer one. */
  const reqGen = useRef<Record<string, number>>({});

  /** Source names are data: read the records by own property only (`constructor` is a valid name). */
  const isOpen = (name: string): boolean => Object.hasOwn(open, name) && open[name] === true;
  /** Versions with a read out: one request per version at a time. */
  const pending = useRef(new Set<string>());
  const load = async (s: McpServer): Promise<void> => {
    const v = versionOf(s);
    const gen = (reqGen.current[v] ?? 0) + 1;
    reqGen.current[v] = gen;
    pending.current.add(v);
    try {
      const c = await sourcesApi.catalog(s.name);
      if (reqGen.current[v] !== gen) return;
      // An answer for another version of the source is not this one's: say so, never show it.
      const other = c.descriptorHash !== null && s.descriptorHash !== undefined && c.descriptorHash !== s.descriptorHash;
      setCatalogs((m) => ({ ...m, [v]: other ? `${s.name} changed while its tables were read: close and open it again` : c }));
    } catch (e) {
      if (reqGen.current[v] === gen) setCatalogs((m) => ({ ...m, [v]: e instanceof Error ? e.message : String(e) }));
    } finally {
      if (reqGen.current[v] === gen) pending.current.delete(v);
    }
  };
  /** Read when there is nothing for this version yet, or only an error (reopening retries it). */
  const needsRead = (s: McpServer): boolean => {
    const v = versionOf(s);
    const have = Object.hasOwn(catalogs, v) ? catalogs[v] : undefined;
    return !pending.current.has(v) && (have === undefined || typeof have === 'string');
  };
  const toggle = (s: McpServer): void => {
    const next = !isOpen(s.name);
    setOpen((o) => ({ ...o, [s.name]: next }));
    if (next && needsRead(s)) void load(s);
  };
  // A source saved (or described) again while its tables are open is read again: its old tables are not its tables.
  const versions = sources.map(versionOf).join('|');
  useEffect(() => {
    for (const s of sources) if (isOpen(s.name) && !Object.hasOwn(catalogs, versionOf(s)) && !pending.current.has(versionOf(s))) void load(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the versions; load reads the latest state
  }, [versions]);

  /** A source row's own menu: test it, ask it, open it. */
  const sourceMenu = (s: McpServer): MenuItem[] => [
    ...(onTest !== undefined && (s.kind === 'sql' || s.kind === 'graphql') ? [{ id: 'test', label: 'Test connection', onSelect: () => onTest(s.name), testId: 'data-panel-test' }] : []),
    ...(onAsk !== undefined && s.kind === 'sql' ? [{ id: 'ask', label: 'Ask a question…', onSelect: () => onAsk(s.name), testId: 'data-panel-ask' }] : []),
    { id: 'open', label: 'Open the source', onSelect: () => onOpen(s.name), testId: 'data-panel-open-source' },
  ];

  const menuFor = (s: McpServer, r: SourceCatalogRelation, c: SourceCatalogResponse): MenuItem[] => [
    { id: 'row-write', label: 'Declare a row write…', disabled: rowWriteMenuBlocker(s, r), onSelect: () => onDeclare(s, r, c), testId: 'data-panel-declare' },
    { id: 'open', label: 'Open the source', onSelect: () => onOpen(s.name) },
  ];

  return (
    <nav className="wk-src-panel" aria-label="Data" data-testid={testId}>
      <section className="wk-src-sec" aria-label="Sources">
        <div className="wk-src-sech">
          <span>Sources</span>
          <span className="wk-src-sp" />
          <button type="button" className="wk-btn wk-btn--quiet wk-btn--icon" aria-label="Add a data source" title="Add a data source" data-testid="data-panel-add" onClick={onAdd}><Plus size={16} aria-hidden /></button>
        </div>
        {loading && <p className="wk-src-cap">Reading sources…</p>}
        {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail">{error}</p>}
        <ul className="wk-src-list">
          {sources.map((s) => {
            const shown = isOpen(s.name);
            const c = Object.hasOwn(catalogs, versionOf(s)) ? catalogs[versionOf(s)] : undefined;
            const tables = typeof c === 'object' && isSqlCatalog(c.catalog as never) ? (c.catalog as { relations: SourceCatalogRelation[] }).relations : null;
            return (
              <li key={s.name} data-testid="data-panel-source" data-source={s.name}>
                <div className="wk-src-row">
                  {s.kind === 'sql' ? (
                    <button type="button" className="wk-src-disclose" aria-expanded={shown} aria-label={`${shown ? 'Hide' : 'Show'} ${s.name}’s tables`} onClick={() => toggle(s)}>
                      {shown ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                    </button>
                  ) : <span className="wk-src-disclose" aria-hidden />}
                  <button type="button" className="wk-src-row-main" data-testid="data-panel-open" onClick={() => onOpen(s.name)}>
                    <Database size={14} aria-hidden className="wk-src-ico" />
                    <span className="wk-src-row-name">{s.name}</span>
                  </button>
                  <span className={`wk-src-chip${s.allowWrites === true ? ' wk-src-chip--writes' : ''}`} data-testid="data-panel-chip">{sourceChip(s)}</span>
                  {(onTest !== undefined || onAsk !== undefined) && <OverflowMenu label={`${s.name}: more`} items={sourceMenu(s)} data-testid={`data-panel-source-menu-${s.name}`} />}
                </div>
                {shown && (
                  <ul className="wk-src-tables" data-testid="data-panel-tables">
                    {c === undefined && <li className="wk-src-cap">Reading the catalog…</li>}
                    {typeof c === 'string' && <li role="alert" className="wk-src-note wk-src-tone-fail">{c}</li>}
                    {tables?.map((r) => (
                      <li key={relationName(r)} className="wk-src-row wk-src-row--table" data-testid="data-panel-table" data-table={relationName(r)}>
                        <Table2 size={13} aria-hidden className="wk-src-ico" />
                        <span className="wk-src-row-name">{relationName(r)}</span>
                        <span className="wk-src-meta">{rowsLine(r, s.sql?.driver === 'sqlite')}</span>
                        <OverflowMenu label={`${relationName(r)}: more`} items={menuFor(s, r, c as SourceCatalogResponse)} data-testid={`data-panel-table-menu-${relationName(r)}`} />
                      </li>
                    ))}
                    {tables !== null && tables.length === 0 && <li className="wk-src-cap">No tables this login can see.</li>}
                  </ul>
                )}
              </li>
            );
          })}
          <li data-testid="data-panel-source" data-source={CREW_SOURCE}>
            <div className="wk-src-row">
              <span className="wk-src-disclose" aria-hidden />
              <button type="button" className="wk-src-row-main" onClick={() => onOpen(CREW_SOURCE)}>
                <Database size={14} aria-hidden className="wk-src-ico" />
                <span className="wk-src-row-name">{CREW_SOURCE}</span>
              </button>
              <span className="wk-src-chip">built-in</span>
            </div>
          </li>
        </ul>
      </section>
      {queries !== undefined && queries !== null && (
        <section className="wk-src-sec" aria-label="Queries">
          <div className="wk-src-sech"><span>Queries</span><span className="wk-src-sp" /><span className="wk-src-cap">{queries.length} · all reads</span></div>
          <ul className="wk-src-list">{queries.map((q) => <li key={q.id} className="wk-src-row"><span className="wk-src-row-name">{q.id}</span>{q.meta !== undefined && <span className="wk-src-meta">{q.meta}</span>}</li>)}</ul>
        </section>
      )}
      <section className="wk-src-sec" aria-label="Actions">
        <div className="wk-src-sech"><span>Actions</span><span className="wk-src-sp" /><span className="wk-src-cap">asks every time</span></div>
        {actions.length === 0 && <p className="wk-src-cap" data-testid="data-panel-no-actions">None yet. Once a source has tables, use a table’s ⋯ menu to allow an app to change rows.</p>}
        <ul className="wk-src-list">
          {actions.map((a) => (
            <li key={a.id} className="wk-src-row" data-testid="data-panel-action" data-granted={a.granted ? 'yes' : 'no'}>
              <Lock size={13} aria-hidden className="wk-src-ico" />
              <span className="wk-src-row-name" title={`${a.source}: ${rowWriteLine(a.write)}`}>{a.label}</span>
              <span className={`wk-src-chip${a.granted ? ' wk-src-chip--ok' : ''}`}>{a.granted ? 'row write · granted' : 'row write · not granted'}</span>
              {!a.granted && <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="data-panel-grant" onClick={() => onGrantAction(a.id)}>Grant</button>}
            </li>
          ))}
        </ul>
      </section>
      {children}
    </nav>
  );
}
