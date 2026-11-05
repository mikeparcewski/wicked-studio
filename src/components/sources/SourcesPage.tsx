import { useCallback, useEffect, useRef, useState } from 'react';
import { agentSwitchWrites } from '../../api/sourceAgents.js';
import { CREW_SOURCE, readSourceDeepLink, sourcesApi, sourcesPath, type McpServer, type SourceCatalogRelation, type SourceCatalogResponse, type SourcePrivilegeReport, type SourceRowWrite } from '../../api/sources.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { useCapabilities } from '../../store/capabilities.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmAction, CalmHead, CalmPage } from '../calm/Calm.js';
import { DataPanel, type PanelRowWrite } from './DataPanel.js';
import { NO_APP_GRANTS, RowWriteDialog, type RowWriteGrantPort } from './RowWriteDialog.js';
import { SourceSheet, type SheetTarget } from './SourceSheet.js';
import { relationName, rowWriteKey } from './sourceModel.js';
import { PmSourceSheet, type PmSheetTarget } from './PmSourceSheet.js';
import { hasPmMarker, pmSystemOf, systemName, trackerLinksListOf, useTrackerLinksSupported } from '../../api/trackers.js';
import { agentAccessOf } from '../../api/sourceAgents.js';
import { TrackerBadge } from '../trackers/TrackerParts.js';

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
  /** (DES-PM-001) The project-management sources (Jira, GitHub Issues): their own list and sheet, never an app's data. */
  const pmOn = useTrackerLinksSupported();
  const [pmSources, setPmSources] = useState<McpServer[]>([]);
  const [pmSheet, setPmSheet] = useState<PmSheetTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  /** What the sheet of ONE source opens on, from the data panel's menu (test at once, or the question):
   *  used once, and forgotten when that sheet closes (Back, then Forward, does not test again). */
  const [sheetFocus, setSheetFocus] = useState<{ name: string; focus: 'test' | 'ask' } | null>(null);
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
      // A PM entry is not an app's data source (crew gives Apps no PM entry in PM-1): it is listed on its own.
      // A record with a PM marker this studio can't read is quarantined with them, never shown as app data.
      setSources(r.servers.filter((x) => appReadable(x) && !hasPmMarker(x as { pm?: unknown })));
      setPmSources(r.servers.filter((x) => hasPmMarker(x as { pm?: unknown })));
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
    if (deep === null) { setSheet((s) => (s !== null && s.mode !== 'new' ? null : s)); setPmSheet((s) => (s !== null && s.mode !== 'new' ? null : s)); return; }
    // One sheet at a time: the address that opens one closes the other kind's.
    if (deep === CREW_SOURCE) { setPmSheet(null); setSheet({ mode: 'crew' }); return; }
    const s = sources.find((x) => x.name === deep);
    if (s !== undefined) { setPmSheet(null); setSheet({ mode: 'saved', server: s }); return; }
    const pm = pmOn ? pmSources.find((x) => x.name === deep && pmSystemOf(x as { pm?: unknown }) !== null) : undefined;
    if (pm !== undefined) { setSheet(null); setPmSheet((cur) => (cur !== null && cur.mode === 'new' ? cur : { mode: 'saved', server: pm })); return; }
    if (pmSources.some((x) => x.name === deep)) { setSheet(null); setPmSheet(null); setError(`${deep} is a project-management tool this studio can’t read: update studio.`); return; }
    if (!loading) { setSheet((cur) => (cur !== null && cur.mode !== 'new' ? null : cur)); setPmSheet((cur) => (cur !== null && cur.mode !== 'new' ? null : cur)); setError(`No source named ${deep}.`); }
  }, [deep, sources, pmSources, pmOn, loading]);

  const open = (name: string, focus: 'test' | 'ask' | null = null): void => { openGen.current++; setSheetFocus(focus === null ? null : { name, focus }); navigate(sourcesPath(name)); };
  // A sheet closed by the address (Back) forgets what it was opened for.
  useEffect(() => { if (sheet === null) setSheetFocus(null); }, [sheet]);
  /** "Add a data source" (the page's button and the panel's ＋): a Grant still reading its table never opens over it. */
  const openAdd = (): void => { openGen.current++; setPmSheet(null); setSheet({ mode: 'new' }); };
  const close = (): void => { setSheet(null); setSheetFocus(null); if (deep !== null) navigate(sourcesPath()); };
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
  /** A crew with the agent switches (api-types 0.183.0) sends them on its SQL sources; one studio can't read still
   *  means rows may reach agents, so only a crew that sends none keeps "never their rows". */
  const anyAgentSwitches = sources.some((s) => s.kind === 'sql' && (s as { agents?: unknown }).agents !== undefined);
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
          onOpen={(name) => open(name)}
          onTest={(name) => open(name, 'test')}
          onAsk={(name) => open(name, 'ask')}
          onDeclare={declare}
          actions={shownActions}
          onGrantAction={(id) => void grantAction(id)}
        />
        {pmOn && <PmSourcesList sources={pmSources} onOpen={(name) => open(name)} onAdd={(system) => { openGen.current++; setSheet(null); setPmSheet({ mode: 'new', system }); }} />}
      </div>
      {sheet !== null && (
        <SourceSheet
          // A saved source's sheet is its connection's: saved again elsewhere (a new descriptor), it opens afresh.
          key={sheet.mode === 'saved' ? `saved:${sheet.server.name}:${sheet.server.descriptorHash ?? ''}` : sheet.mode}
          target={sheet}
          focus={sheet.mode === 'saved' && sheetFocus !== null && sheetFocus.name === sheet.server.name ? sheetFocus.focus : null}
          onFocusUsed={() => setSheetFocus(null)}
          existing={sources.map((s) => s.name)}
          onSaved={(saved) => {
            // The saved record now, before the list re-read lands; a new descriptor withdraws old grants.
            const prior = sources.find((s) => s.name === saved.name);
            if (prior !== undefined && prior.descriptorHash !== saved.descriptorHash) bumpRevoked(saved.name);
            setSources((list) => (list.some((s) => s.name === saved.name) ? list.map((s) => (s.name === saved.name ? saved : s)) : appReadable(saved) ? [...list, saved] : list));
            void refresh();
          }}
          // Only the secret's state changed: merged into the latest record, then crew's list read confirms it.
          onRekeyed={(name) => { setSources((list) => list.map((s) => (s.name === name ? ({ ...s, authState: 'set' } as McpServer) : s))); void refresh(); }}
          onAllowWrites={setWrites}
          servers={sources}
          agentsUnverified={unverified}
          onReread={() => void refresh()}
          // crew's answer now; the read below (every settled write) supersedes any list read that was out before it.
          onAgents={(name, agents) => setSources((list) => list.map((s) => (s.name === name ? ({ ...s, agents } as McpServer) : s)))}
          onDescribed={(name) => setEpochs((m) => ({ ...m, [name]: (Object.hasOwn(m, name) ? (m[name] ?? 0) : 0) + 1 }))}
          onClose={close}
          {...(pmOn ? { onPickPm: (system: 'jira' | 'github') => { setSheet(null); setPmSheet({ mode: 'new', system }); } } : {})}
        />
      )}
      {pmOn && pmSheet !== null && (
        <PmSourceSheet
          key={pmSheet.mode === 'saved' ? `saved:${pmSheet.server.name}:${pmSheet.server.descriptorHash ?? ''}` : `new:${pmSheet.system}`}
          target={pmSheet}
          existing={[...sources, ...pmSources].map((s) => s.name)}
          servers={pmSources}
          agentsUnverified={unverified}
          onReread={() => void refresh()}
          onSaved={(saved) => {
            setPmSources((list) => (list.some((s) => s.name === saved.name) ? list.map((s) => (s.name === saved.name ? saved : s)) : [...list, saved]));
            void refresh();
          }}
          onRekeyed={(name) => { setPmSources((list) => list.map((s) => (s.name === name ? ({ ...s, authState: 'set' } as McpServer) : s))); void refresh(); }}
          onAgents={(name, agents) => setPmSources((list) => list.map((s) => (s.name === name ? ({ ...s, agents } as McpServer) : s)))}
          onClose={() => { setPmSheet(null); if (deep !== null) navigate(sourcesPath()); }}
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

/**
 * (DES-PM-001) PROJECT MANAGEMENT on the Data sources page: each registered Jira or GitHub Issues source, how many
 * trackers are linked, and whether agents may use it; each opens its sheet. Shown only on a crew with tracker links.
 */
function PmSourcesList({ sources, onOpen, onAdd }: { sources: readonly McpServer[]; onOpen: (name: string) => void; onAdd: (system: 'jira' | 'github') => void }): React.ReactElement {
  return (
    <section className="wk-src-box wk-pm-list" aria-labelledby="wk-pm-list-title" data-testid="pm-sources">
      <div className="wk-src-box-head">
        <h2 id="wk-pm-list-title" className="wk-src-strong wk-pm-list-title">Project management</h2>
        <span className="wk-src-sp" />
        <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="pm-add-jira" onClick={() => onAdd('jira')}>Add Jira</button>
        <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="pm-add-github" onClick={() => onAdd('github')}>Add GitHub Issues</button>
      </div>
      {sources.length === 0 ? (
        <p className="wk-src-note" data-testid="pm-sources-empty">No tracker tool yet. Add Jira or GitHub Issues, then link its projects to your projects and repositories: agents read issues only from what you link.</p>
      ) : (
        <ul className="wk-src-list">
          {sources.map((s) => {
            const system = pmSystemOf(s as { pm?: unknown });
            if (system === null) {
              return <li key={s.name} className="wk-src-note" data-testid="pm-source-unreadable"><b>{s.name}</b>: a project-management tool this studio can’t read. Update studio; it is not offered to apps meanwhile.</li>;
            }
            const trackers = trackerLinksListOf((s as unknown as { trackers?: unknown }).trackers);
            const linked = trackers === null ? null : new Set(trackers.map((l) => l.trackerId)).size;
            const a = agentAccessOf(s as { agents?: unknown });
            const agents = a === null ? null : !a.see || (!a.everyProject && a.projects.length === 0) ? 'agents can’t use it yet' : a.query ? 'agents can read issues' : 'agents see its structure';
            return (
              <li key={s.name}>
                <button type="button" className="wk-src-row wk-src-row-main wk-pm-row" data-testid="pm-source" data-name={s.name} onClick={() => onOpen(s.name)}>
                  <TrackerBadge system={system} small />
                  <span className="wk-src-row-name"><b>{s.name}</b> <span className="wk-src-cap">{systemName(system)} · {linked === null ? 'its links can’t be read' : linked === 1 ? '1 tracker linked' : `${linked} trackers linked`}{agents !== null ? ` · ${agents}` : ''}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
