import { useCallback, useEffect, useState } from 'react';
import { CREW_SOURCE, readSourceDeepLink, sourcesApi, sourcesPath, type McpServer, type SourceCatalogRelation, type SourceCatalogResponse, type SourcePrivilegeReport, type SourceRowWrite } from '../../api/sources.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmAction, CalmHead, CalmPage } from '../calm/Calm.js';
import { DataPanel, type PanelRowWrite } from './DataPanel.js';
import { NO_APP_GRANTS, RowWriteDialog, type RowWriteGrantPort } from './RowWriteDialog.js';
import { SourceSheet, type SheetTarget } from './SourceSheet.js';
import { relationName } from './sourceModel.js';

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
  const [actions, setActions] = useState<PanelRowWrite[]>([]);
  const [dialog, setDialog] = useState<{ source: string; relation: SourceCatalogRelation; privileges: SourcePrivilegeReport | null; declared: PanelRowWrite | null } | null>(null);

  const refresh = useCallback(async (): Promise<McpServer[]> => {
    try {
      const r = await sourcesApi.list();
      const list = r.servers.filter(appReadable);
      setSources(list);
      setError(null);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // `?source=<name>` opens that source's sheet (the address a link or Back returns to).
  const deep = readSourceDeepLink(search);
  useEffect(() => {
    if (deep === null) return;
    if (deep === CREW_SOURCE) { setSheet({ mode: 'crew' }); return; }
    const s = sources.find((x) => x.name === deep);
    if (s !== undefined) setSheet({ mode: 'saved', server: s });
  }, [deep, sources]);

  const open = (name: string): void => navigate(sourcesPath(name));
  const close = (): void => { setSheet(null); if (deep !== null) navigate(sourcesPath()); };
  const setWrites = (name: string, allowed: boolean): void => {
    setSources((list) => list.map((s) => (s.name === name ? { ...s, allowWrites: allowed } : s)));
    // Turning it off withdraws every row-write grant on the source (crew does; the list says so too).
    if (!allowed) setActions((list) => list.map((a) => (a.source === name ? { ...a, granted: false } : a)));
  };
  const declare = (source: McpServer, relation: SourceCatalogRelation, c: SourceCatalogResponse): void => {
    setDialog({ source: source.name, relation, privileges: c.privileges ?? null, declared: null });
  };
  const onDeclared = (source: string, write: SourceRowWrite): void => {
    const id = `${write.op}_${write.table}${write.op === 'update' ? `_${write.set.join('_')}` : ''}`.slice(0, 63);
    setActions((list) => [...list.filter((a) => a.id !== id), { id, source, write, granted: false }]);
    setDialog((d) => (d === null ? d : { ...d, declared: { id, source, write, granted: false } }));
  };
  const grantAction = async (id: string): Promise<void> => {
    const a = actions.find((x) => x.id === id);
    if (a === undefined) return;
    try {
      const c = await sourcesApi.catalog(a.source);
      const rel = 'relations' in c.catalog ? c.catalog.relations.find((r) => r.schema === a.write.schema && r.name === a.write.table) : undefined;
      if (rel === undefined) { setError(`${a.write.schema}.${a.write.table} is no longer in ${a.source}’s catalog: describe it again`); return; }
      setDialog({ source: a.source, relation: rel, privileges: c.privileges ?? null, declared: a });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const dialogSource = dialog === null ? null : sources.find((s) => s.name === dialog.source) ?? null;
  const shownGrants: RowWriteGrantPort = {
    grant: async (source, write, fingerprint) => {
      const why = await grants.grant(source, write, fingerprint);
      if (why === null) setActions((list) => list.map((a) => (a.source === source && a.write.table === write.table && a.write.op === write.op ? { ...a, granted: true } : a)));
      return why;
    },
  };

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
          loading={loading}
          error={error}
          onAdd={() => setSheet({ mode: 'new' })}
          onOpen={open}
          onDeclare={declare}
          actions={actions}
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
          onClose={close}
        />
      )}
      {dialog !== null && dialogSource !== null && (
        <RowWriteDialog
          key={`${dialog.source}:${relationName(dialog.relation)}`}
          source={dialogSource}
          relation={dialog.relation}
          privileges={dialog.privileges}
          declared={dialog.declared?.write ?? null}
          port={shownGrants}
          onDeclared={(w) => onDeclared(dialog.source, w)}
          onAllowWrites={(allowed) => setWrites(dialog.source, allowed)}
          onClose={() => setDialog(null)}
        />
      )}
    </CalmPage>
  );
}
