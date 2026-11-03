import { useCallback, useEffect, useRef, useState } from 'react';
import { CREW_SOURCE, readSourceDeepLink, sourcesApi, sourcesPath, type McpServer, type SourceCatalogRelation, type SourceCatalogResponse, type SourcePrivilegeReport, type SourceRowWrite } from '../../api/sources.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmAction, CalmHead, CalmPage } from '../calm/Calm.js';
import { DataPanel, type PanelRowWrite } from './DataPanel.js';

/** A declared row write as the page keeps it: granted FOR one connection descriptor of its source. */
interface PageRowWrite extends Omit<PanelRowWrite, 'granted'> {
  /** The source descriptor the host granted it under (`null` = not granted). A re-saved source's
   *  grants were for its old descriptor, so they do not show as granted on the new one. */
  grantedFor: string | null;
}
import { NO_APP_GRANTS, RowWriteDialog, type RowWriteGrantPort } from './RowWriteDialog.js';
import { SourceSheet, type SheetTarget } from './SourceSheet.js';
import { relationName, rowWriteKey } from './sourceModel.js';

/** The registered servers an app may read from: data sources, REST APIs and MCP servers. */
const appReadable = (s: McpServer): boolean => s.kind === 'sql' || s.kind === 'graphql' || s.kind === 'rest' || s.kind === 'mcp-http';

/**
 * DATA SOURCES (`/sources`, Build & settings): the data panel over every source an app can read, the
 * "Add a data source" sheet, and the row-write declaration from a table's menu. A grant belongs to an
 * app's action (DES §9.4), so here the checks run and `NO_APP_GRANTS` says where the grant is made; the
 * Apps section (K5) mounts the same panel with its app's grant port.
 */
export function SourcesPage({ navigate, search, grants = NO_APP_GRANTS }: { navigate: Navigate; search: string; grants?: RowWriteGrantPort }): React.ReactElement {
  const [sources, setSources] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [actions, setActions] = useState<PageRowWrite[]>([]);
  const [dialog, setDialog] = useState<{ source: string; relation: SourceCatalogRelation; privileges: SourcePrivilegeReport | null; declared: PageRowWrite | null } | null>(null);
  /** Per source, bumped when the sheet described it again: the panel reads its tables afresh. */
  const [epochs, setEpochs] = useState<Record<string, number>>({});
  /** The Grant button's catalog read: only the latest one opens the dialog, and Close cancels it. */
  const openGen = useRef(0);

  /** Each list read's generation: an older answer never replaces a newer one (a save re-reads the list). */
  const listGen = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    const gen = ++listGen.current;
    try {
      const r = await sourcesApi.list();
      if (gen !== listGen.current) return;
      setSources(r.servers.filter(appReadable));
      setError(null);
    } catch (e) {
      if (gen === listGen.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === listGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // `?source=<name>` opens that source's sheet: the address owns it, so Back (or a link to a source that
  // isn't there) closes it. A new source's sheet is the page's own, not the address's.
  const deep = readSourceDeepLink(search);
  useEffect(() => {
    if (deep === null) { setSheet((s) => (s !== null && s.mode !== 'new' ? null : s)); return; }
    if (deep === CREW_SOURCE) { setSheet({ mode: 'crew' }); return; }
    const s = sources.find((x) => x.name === deep);
    if (s !== undefined) { setSheet({ mode: 'saved', server: s }); return; }
    if (!loading) { setSheet((cur) => (cur !== null && cur.mode !== 'new' ? null : cur)); setError(`No source named ${deep}.`); }
  }, [deep, sources, loading]);

  const open = (name: string): void => navigate(sourcesPath(name));
  const close = (): void => { setSheet(null); if (deep !== null) navigate(sourcesPath()); };
  const setWrites = (name: string, allowed: boolean): void => {
    setSources((list) => list.map((s) => (s.name === name ? { ...s, allowWrites: allowed } : s)));
    // Turning it off withdraws every row-write grant on the source (crew does; the list says so too).
    if (!allowed) setActions((list) => list.map((a) => (a.source === name ? { ...a, grantedFor: null } : a)));
    // A list read that was out before the switch changed is older than it: read again after it.
    void refresh();
  };
  const declare = (source: McpServer, relation: SourceCatalogRelation, c: SourceCatalogResponse): void => {
    setDialog({ source: source.name, relation, privileges: c.privileges ?? null, declared: null });
  };
  const onDeclared = (source: string, write: SourceRowWrite): void => {
    // The id is the whole declaration with its source: two declarations never share one.
    const id = rowWriteKey(source, write);
    const label = `${write.op} ${write.schema}.${write.table}${write.op === 'update' ? ` (${write.set.join(', ')})` : ''}`;
    setActions((list) => (list.some((a) => a.id === id) ? list : [...list, { id, label, source, write, grantedFor: null }]));
    setDialog((d) => (d === null ? d : { ...d, declared: { id, label, source, write, grantedFor: null } }));
  };
  const grantAction = async (id: string): Promise<void> => {
    const a = actions.find((x) => x.id === id);
    if (a === undefined) return;
    const mine = ++openGen.current;
    try {
      const c = await sourcesApi.catalog(a.source);
      if (mine !== openGen.current) return; // another Grant was clicked since, or the dialog closed
      const rel = 'relations' in c.catalog ? c.catalog.relations.find((r) => r.schema === a.write.schema && r.name === a.write.table) : undefined;
      if (rel === undefined) { setError(`${a.write.schema}.${a.write.table} is no longer in ${a.source}’s catalog: describe it again`); return; }
      setDialog({ source: a.source, relation: rel, privileges: c.privileges ?? null, declared: a });
    } catch (e) {
      if (mine === openGen.current) setError(e instanceof Error ? e.message : String(e));
    }
  };
  const closeDialog = (): void => { openGen.current++; setDialog(null); };
  const dialogSource = dialog === null ? null : sources.find((s) => s.name === dialog.source) ?? null;
  const shownGrants: RowWriteGrantPort = {
    grant: async (source, write, fingerprint) => {
      // The descriptor the grant is asked under, read before the host answers.
      const descriptor = sources.find((s) => s.name === source)?.descriptorHash ?? null;
      const why = await grants.grant(source, write, fingerprint);
      // Only the exact declaration the host granted is marked granted, and only for that descriptor.
      const id = rowWriteKey(source, write);
      if (why === null && descriptor !== null) setActions((list) => list.map((a) => (a.id === id ? { ...a, grantedFor: descriptor } : a)));
      return why;
    },
  };

  const shownActions: PanelRowWrite[] = actions.map(({ grantedFor, ...a }) => ({
    ...a,
    granted: grantedFor !== null && grantedFor === (sources.find((s) => s.name === a.source)?.descriptorHash ?? null),
  }));
  const count = sources.length;
  return (
    <CalmPage data-testid="sources-page" className="wk-src-page">
      <CalmHead
        title={PAGE_NAMES.sources}
        sentence={loading ? 'Reading sources…' : `${count === 0 ? 'No sources yet' : `${count} source${count === 1 ? '' : 's'}`} plus crew’s own API. Apps read them through queries crew checks; agents see their structure, never their rows.`}
        action={<CalmAction label="Add a data source" onClick={() => setSheet({ mode: 'new' })} testId="sources-add" />}
      />
      <div className="wk-src-page-body">
        <DataPanel
          sources={sources}
          epochs={epochs}
          loading={loading}
          error={error}
          onAdd={() => setSheet({ mode: 'new' })}
          onOpen={open}
          onDeclare={declare}
          actions={shownActions}
          onGrantAction={(id) => void grantAction(id)}
        />
      </div>
      {sheet !== null && (
        <SourceSheet
          key={sheet.mode === 'saved' ? `saved:${sheet.server.name}` : sheet.mode}
          target={sheet}
          existing={sources.map((s) => s.name)}
          onSaved={() => void refresh()}
          onAllowWrites={setWrites}
          onDescribed={(name) => setEpochs((m) => ({ ...m, [name]: (m[name] ?? 0) + 1 }))}
          onClose={close}
        />
      )}
      {dialog !== null && dialogSource !== null && (
        <RowWriteDialog
          // One dialog per declaration: opening Grant for another one starts afresh (its own op and columns).
          key={`${dialog.source}:${relationName(dialog.relation)}:${dialog.declared?.id ?? 'new'}`}
          source={dialogSource}
          relation={dialog.relation}
          privileges={dialog.privileges}
          declared={dialog.declared?.write ?? null}
          port={shownGrants}
          onDeclared={(w) => onDeclared(dialog.source, w)}
          onAllowWrites={(allowed) => setWrites(dialog.source, allowed)}
          onClose={closeDialog}
        />
      )}
    </CalmPage>
  );
}
