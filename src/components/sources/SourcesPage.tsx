import { useCallback, useEffect, useRef, useState } from 'react';
import { agentAccessOf, agentSwitchWrites } from '../../api/sourceAgents.js';
import { CREW_SOURCE, readSourceDeepLink, sourcesApi, sourcesPath, type McpServer, type SourceCatalogRelation, type SourceCatalogResponse, type SourcePrivilegeReport, type SourceRowWrite } from '../../api/sources.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { useCapabilities } from '../../store/capabilities.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmAction, CalmHead, CalmPage } from '../calm/Calm.js';
import { DataPanel, type PanelRowWrite } from './DataPanel.js';
import { NO_APP_GRANTS, RowWriteDialog, type RowWriteGrantPort } from './RowWriteDialog.js';
import { SourceSheet, type SheetTarget } from './SourceSheet.js';
import { relationName, rowWriteKey } from './sourceModel.js';

/** A declared row write as the page keeps it: granted FOR one connection descriptor of its source. */
interface PageRowWrite extends Omit<PanelRowWrite, 'granted'> {
  /** The source descriptor the host granted it under (`null` = not granted). A re-saved source's
   *  grants were for its old descriptor, so they do not show as granted on the new one. */
  grantedFor: string | null;
}

/** The registered servers an app may read from: data sources, REST APIs and MCP servers. */
const appReadable = (s: McpServer): boolean => s.kind === 'sql' || s.kind === 'graphql' || s.kind === 'rest' || s.kind === 'mcp-http';

/**
 * DATA SOURCES (`/sources`, Build & settings): the data panel over every source an app can read, the
 * "Add a data source" sheet, and the row-write declaration from a table's menu. A grant belongs to an
 * app's action (DES §9.4), so here the checks run and `NO_APP_GRANTS` says where the grant is made; the
 * Apps section (K5) mounts the same panel with its app's grant port.
 */
export function SourcesPage(props: { navigate: Navigate; search: string; grants?: RowWriteGrantPort }): React.ReactElement {
  // A crew from before Apps data sources (K1) serves none of the routes: the page says so, by address only
  // (the sidebar shows the entry only when crew advertises them, `HealthCapabilities.apps.uploads`).
  const loaded = useCapabilities((s) => s.loaded);
  const supported = useCapabilities((s) => s.dataSources);
  useEffect(() => { if (!loaded) void useCapabilities.getState().load(); }, [loaded]);
  if (!loaded) {
    return (
      <CalmPage data-testid="sources-page" className="wk-src-page">
        <CalmHead title={PAGE_NAMES.sources} sentence="Checking what this crew supports…" />
      </CalmPage>
    );
  }
  if (!supported) {
    return (
      <CalmPage data-testid="sources-page" className="wk-src-page">
        <CalmHead title={PAGE_NAMES.sources} sentence="This crew doesn’t support data sources yet." sentenceTestId="sources-unsupported" />
        <p className="wk-src-note" data-testid="sources-unsupported-why">
          Data sources (databases, APIs and files that apps read from) come with a newer crew. Update crew, then open this page again. Nothing was read or changed.
        </p>
      </CalmPage>
    );
  }
  return <SourcesPageBody {...props} />;
}

function SourcesPageBody({ navigate, search, grants = NO_APP_GRANTS }: { navigate: Navigate; search: string; grants?: RowWriteGrantPort }): React.ReactElement {
  const [sources, setSources] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [actions, setActions] = useState<PageRowWrite[]>([]);
  const [dialog, setDialog] = useState<{ source: string; relation: SourceCatalogRelation; privileges: SourcePrivilegeReport | null; declared: PageRowWrite | null } | null>(null);
  /** Per source, bumped when the sheet described it again: the panel reads its tables afresh. */
  const [epochs, setEpochs] = useState<Record<string, number>>({});
  /** The Grant button's catalog read: only the latest one opens the dialog; Close, another Grant, a new
   *  declaration or a source sheet opening cancels it. */
  const openGen = useRef(0);
  /** Per source, bumped when its grants are withdrawn (Allow writes off) or it is saved again: a grant
   *  answer that arrives after either is not recorded. */
  const revoked = useRef(new Map<string, number>());
  const bumpRevoked = (name: string): void => { revoked.current.set(name, (revoked.current.get(name) ?? 0) + 1); };

  /** Each list read's generation: an older answer never replaces a newer one (a save re-reads the list). */
  const listGen = useRef(0);
  /** (DES-KNOWLEDGE-DATA-001 §19 B5) Sources an agent-switch write settled on since the last list read landed: their
   *  shown switches are crew's again only once one does. */
  const toVerify = useRef(new Set<string>());
  /** Sources whose re-read after such a write failed: the box says its switches may be out of date, and holds them. */
  const [unverified, setUnverified] = useState<ReadonlySet<string>>(() => new Set());
  const refresh = useCallback(async (): Promise<void> => {
    const gen = ++listGen.current;
    try {
      const r = await sourcesApi.list();
      if (gen !== listGen.current) return;
      setSources(r.servers.filter(appReadable));
      setError(null);
      toVerify.current.clear();
      setUnverified((cur) => (cur.size === 0 ? cur : new Set()));
    } catch (e) {
      if (gen !== listGen.current) return;
      setError(e instanceof Error ? e.message : String(e));
      if (toVerify.current.size > 0) setUnverified(new Set(toVerify.current));
    } finally {
      if (gen === listGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  // (DES-KNOWLEDGE-DATA-001 §19 B5) Every agent-switch write that settles, from any sheet (or a page since unmounted),
  // reads crew's switches again: whatever order crew applied overlapping writes in, this page shows crew's.
  useEffect(() => agentSwitchWrites.subscribe((source) => { toVerify.current.add(source); void refresh(); }), [refresh]);

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

  const open = (name: string): void => { openGen.current++; navigate(sourcesPath(name)); };
  /** "Add a data source" (the page's button and the panel's ＋): a Grant still reading its table never opens over it. */
  const openAdd = (): void => { openGen.current++; setSheet({ mode: 'new' }); };
  const close = (): void => { setSheet(null); if (deep !== null) navigate(sourcesPath()); };
  const setWrites = (name: string, allowed: boolean): void => {
    setSources((list) => list.map((s) => (s.name === name ? { ...s, allowWrites: allowed } : s)));
    // Turning it off withdraws every row-write grant on the source (crew does; the list says so too).
    if (!allowed) {
      bumpRevoked(name);
      setActions((list) => list.map((a) => (a.source === name ? { ...a, grantedFor: null } : a)));
    }
    // A list read that was out before the switch changed is older than it: read again after it.
    void refresh();
  };
  const declare = (source: McpServer, relation: SourceCatalogRelation, c: SourceCatalogResponse): void => {
    openGen.current++;
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
      // The descriptor and withdrawal count the grant is asked under, read before the host answers.
      const descriptor = sources.find((s) => s.name === source)?.descriptorHash ?? null;
      const before = revoked.current.get(source) ?? 0;
      const why = await grants.grant(source, write, fingerprint);
      // Only the exact declaration the host granted is marked granted, only for that descriptor, and
      // never after its grants were withdrawn meanwhile (the host's late "yes" is older than that).
      const id = rowWriteKey(source, write);
      if (why === null && descriptor !== null && (revoked.current.get(source) ?? 0) === before) {
        setActions((list) => list.map((a) => (a.id === id ? { ...a, grantedFor: descriptor } : a)));
      }
      return why;
    },
  };

  const shownActions: PanelRowWrite[] = actions.map(({ grantedFor, ...a }) => {
    const src = sources.find((s) => s.name === a.source);
    // Granted = for this descriptor, and Allow writes on (off withdrew it, and on again needs a new grant).
    return { ...a, granted: grantedFor !== null && src !== undefined && src.allowWrites === true && grantedFor === (src.descriptorHash ?? null) };
  });
  const count = sources.length;
  /** A crew with the agent switches (api-types 0.183.0) sends them on its SQL sources. */
  const anyAgentSwitches = sources.some((s) => s.kind === 'sql' && agentAccessOf(s as { agents?: unknown }) !== null);
  return (
    <CalmPage data-testid="sources-page" className="wk-src-page">
      <CalmHead
        title={PAGE_NAMES.sources}
        sentence={loading ? 'Reading sources…' : `${count === 0 ? 'No sources yet' : `${count} source${count === 1 ? '' : 's'}`} plus crew’s own API. Apps read them through queries crew checks; agents see ${anyAgentSwitches ? 'a source’s structure, and its rows only where you let them query it' : 'their structure, never their rows'}.`}
        action={<CalmAction label="Add a data source" onClick={openAdd} testId="sources-add" />}
      />
      <div className="wk-src-page-body">
        <DataPanel
          sources={sources}
          epochs={epochs}
          loading={loading}
          error={error}
          onAdd={openAdd}
          onOpen={open}
          onDeclare={declare}
          actions={shownActions}
          onGrantAction={(id) => void grantAction(id)}
        />
      </div>
      {sheet !== null && (
        <SourceSheet
          // A saved source's sheet is its connection's: saved again elsewhere (a new descriptor), it opens afresh.
          key={sheet.mode === 'saved' ? `saved:${sheet.server.name}:${sheet.server.descriptorHash ?? ''}` : sheet.mode}
          target={sheet}
          existing={sources.map((s) => s.name)}
          onSaved={(saved) => {
            // The saved record now, before the list re-read lands; a new descriptor withdraws old grants.
            const prior = sources.find((s) => s.name === saved.name);
            if (prior !== undefined && prior.descriptorHash !== saved.descriptorHash) bumpRevoked(saved.name);
            setSources((list) => (list.some((s) => s.name === saved.name) ? list.map((s) => (s.name === saved.name ? saved : s)) : appReadable(saved) ? [...list, saved] : list));
            void refresh();
          }}
          onAllowWrites={setWrites}
          servers={sources}
          agentsUnverified={unverified}
          onReread={() => void refresh()}
          // crew's answer now; the read below (every settled write) supersedes any list read that was out before it.
          onAgents={(name, agents) => setSources((list) => list.map((s) => (s.name === name ? ({ ...s, agents } as McpServer) : s)))}
          onDescribed={(name) => setEpochs((m) => ({ ...m, [name]: (Object.hasOwn(m, name) ? (m[name] ?? 0) : 0) + 1 }))}
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
