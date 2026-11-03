import { useEffect, useMemo, useRef, useState } from 'react';
import { sourcesApi, SOURCES_PATH, type McpServer, type SourceCatalogRelation } from '../../api/sources.js';
import type { AppCheckFinding, AppDetail, AppQuery, AppSpec, SourceCheckResponse } from '../../api/types.js';
import type { AppSession } from '../../editors/apps/appSession.js';
import {
  addTableFor, askSource, badOutputNames, bindTo, checkText, columnsGone, freshQueryId, outputOf, queryRows, starterSql, withQuery,
  type AskAnswer, type ColumnUse, type QueryRow,
} from '../../editors/apps/appQueries.js';
import { isSqlCatalog, relationName, rowsLine } from '../sources/sourceModel.js';

/**
 * THE DATA PANEL IN EDIT (DES-APPS-001 §6.1; operator 2026-11-04: "How do I edit the data sources for an app?"). Drawn by
 * the HOST over the frame's right edge: the app's queries (source, kind, text, parameters, output, which components
 * read them), editing one, and adding data from a source's table. These are the person's direct edits in studio's own
 * UI: no job runs. The host never mounts it in a framed studio. Every save is ONE version through crew's staged check
 * (`AppSession.landDirect`): the spec stage, then the source stage (crew's read policy and the per-kind check) for the
 * queries that changed. A refusal is crew's codes and words, shown as text, and nothing lands.
 *
 * Before a SQL save, crew's `/sources/:name/check` describes the text (it never runs it) and its columns become the
 * query's declared output. A GraphQL text is checked against the schema and keeps its declared output (the check
 * validates the document; the rows are the declared projection). REST, MCP and crew queries have no pre-check here:
 * crew's staged check is theirs. A save is made on the query as it was when the person began: if the query changed in
 * the meantime (an undo, another tab), nothing lands and the panel says so (codex r13).
 *
 * On the sample store (a daemon without crew's app store) query texts save in this browser only, unchecked, labelled.
 */

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; columns: Array<{ name: string; type: string }> }
  | { kind: 'refused'; code: string; detail: string };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; version: number; words: string }
  | { kind: 'refused'; message: string; findings: AppCheckFinding[] };

const bindable = (spec: AppSpec): Array<{ id: string; words: string }> =>
  spec.pages.flatMap((p) => p.components).filter((c) => c.type === 'table' || c.type === 'chart' || c.type === 'kpi')
    .map((c) => ({ id: c.id, words: `${c.type} “${(c.title ?? c.id).slice(0, 60)}”` }));

/** The registry kinds a query of `kind` may read (crew's `queryKindFits`, apps/exec/sources.ts); `crew` is built in. */
const registryKindsOf = (kind: AppQuery['kind']): readonly string[] =>
  kind === 'sql' ? ['sql'] : kind === 'graphql' ? ['graphql'] : kind === 'rest' ? ['rest'] : kind === 'mcp' ? ['mcp-http', 'mcp-stdio'] : [];
/** Whether crew's `/sources/:name/check` can check a query of `kind` before it is saved (SQL and GraphQL only). */
const preCheckable = (kind: AppQuery['kind']): boolean => kind === 'sql' || kind === 'graphql';
const driverOf = (s: McpServer | undefined): string | null => s?.sql?.driver ?? null;
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** The query as the panel began editing it: a save lands only if the head still has exactly this. */
const snapshotOf = (spec: AppSpec, queryText: Readonly<Record<string, string>>, id: string): string =>
  JSON.stringify([spec.queries.find((q) => q.id === id) ?? null, Object.hasOwn(queryText, id) ? queryText[id] : null]);

function CheckLine({ state }: { state: CheckState }): React.ReactElement | null {
  if (state.kind === 'idle') return null;
  if (state.kind === 'checking') return <p className="wk-apps-data-note" data-testid="apps-data-checking">Checking with the source (nothing runs)…</p>;
  if (state.kind === 'refused') {
    return (
      <p className="wk-apps-data-note wk-apps-data-note--fail" role="alert" data-testid="apps-data-refused">
        <code data-testid="apps-data-refused-code">{state.code}</code> {state.detail}
      </p>
    );
  }
  return (
    <p className="wk-apps-data-note" data-testid="apps-data-columns">
      Returns {state.columns.map((c) => `${c.name} (${c.type})`).join(', ') || 'no columns'}
    </p>
  );
}

function SaveLine({ state }: { state: SaveState }): React.ReactElement | null {
  if (state.kind === 'idle') return null;
  if (state.kind === 'saving') return <p className="wk-apps-data-note" data-testid="apps-data-saving">Saving through crew’s check…</p>;
  if (state.kind === 'saved') return <p className="wk-apps-data-note wk-apps-data-note--ok" role="status" data-testid="apps-data-saved">{state.words}</p>;
  return (
    <div className="wk-apps-data-note wk-apps-data-note--fail" role="alert" data-testid="apps-data-save-refused">
      <p>{state.message}</p>
      {state.findings.length > 0 && (
        <ul className="wk-apps-data-findings" data-testid="apps-data-findings">
          {state.findings.map((f, i) => <li key={i}><code>{f.code}</code> {f.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function GoneList({ gone }: { gone: readonly ColumnUse[] }): React.ReactElement | null {
  if (gone.length === 0) return null;
  return (
    <div className="wk-apps-data-note wk-apps-data-note--fail" role="alert" data-testid="apps-data-gone">
      <p>Column gone: these components read columns the query would no longer return. Rebind them in Properties, or keep those columns.</p>
      <ul>{gone.map((g, i) => <li key={i}>{g.words}: <code>{g.column}</code></li>)}</ul>
    </div>
  );
}

/** crew's check of `text` turned into the output to declare, or why not (SQL: the described columns; never a run). */
function outputFromCheck(r: SourceCheckResponse): { ok: true; columns: Array<{ name: string; type: string }> } | { ok: false; state: CheckState } {
  if (!r.ok) return { ok: false, state: { kind: 'refused', code: r.code, detail: r.detail } };
  const bad = badOutputNames(r.columns);
  if (bad.length > 0) {
    return { ok: false, state: { kind: 'refused', code: 'output_name', detail: `alias ${bad.map((b) => JSON.stringify(b)).join(', ')} (AS a_name): an app's column names are letters, digits, _ and -, starting with a letter or _` } };
  }
  return { ok: true, columns: r.columns };
}

/** One query, opened: its text, source, parameters, output and readers; Check, and Check & save. */
function QueryEditor({ session, detail, sample, sources, row, onDone }: {
  session: AppSession; detail: AppDetail; sample: boolean; sources: readonly McpServer[] | null; row: QueryRow; onDone: (words: string) => void;
}): React.ReactElement {
  const [text, setText] = useState(row.text ?? '');
  const [source, setSource] = useState(row.source);
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [gone, setGone] = useState<ColumnUse[]>([]);
  const alive = useRef(false);
  // Set on setup and cleared on cleanup: Strict Mode replays effects (setup, cleanup, setup) (codex r14).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const busy = check.kind === 'checking' || save.kind === 'saving';
  const kinds = registryKindsOf(row.kind);
  const current = sources?.find((s) => s.name === row.source);
  // The source can change to another the query's kind may read (and, for SQL, of the same dialect); a source gone from
  // crew's registry can be replaced by any of those. crew's staged check judges the text against the one chosen.
  const compatible = (sources ?? []).filter((s) => kinds.includes(s.kind) && (current === undefined || row.kind !== 'sql' || driverOf(s) === driverOf(current)));
  const choices = current === undefined && kinds.length > 0 ? [{ name: row.source, missing: true }, ...compatible.map((s) => ({ name: s.name, missing: false }))] : compatible.map((s) => ({ name: s.name, missing: false }));
  const changed = text !== (row.text ?? '') || source !== row.source;
  const checkable = !sample && preCheckable(row.kind);

  const runCheck = async (): Promise<SourceCheckResponse | null> => {
    setCheck({ kind: 'checking' });
    try {
      const r = await checkText(source, text);
      if (!alive.current) return null;
      setCheck(r.ok ? { kind: 'ok', columns: r.columns } : { kind: 'refused', code: r.code, detail: r.detail });
      return r;
    } catch (e) {
      if (alive.current) setCheck({ kind: 'refused', code: 'unavailable', detail: errText(e) });
      return null;
    }
  };

  const checkAndSave = async (): Promise<void> => {
    const began = snapshotOf(detail.spec, detail.queryText ?? {}, row.id);
    const sentText = text;
    const sentSource = source;
    setSave({ kind: 'idle' });
    setGone([]);
    let output = row.output;
    if (checkable) {
      const r = await runCheck();
      if (r === null || !alive.current) return;
      const out = outputFromCheck(r);
      if (!out.ok) { setCheck(out.state); return; }
      if (row.kind === 'sql') {
        output = outputOf(out.columns);
        const lost = columnsGone(detail.spec, row.id, output);
        if (lost.length > 0) { setGone(lost); return; }
      }
    }
    setSave({ kind: 'saving' });
    const r = await session.landDirect((head) => {
      // landDirect lands the canvas burst first: an editor closed meanwhile sends nothing (codex r14).
      if (!alive.current) return 'Not saved: the query was closed before it was saved';
      if (snapshotOf(head.spec, head.queryText ?? {}, row.id) !== began) return 'Not saved: this query changed meanwhile (an undo, or another tab). Look at it again, then save.';
      const q = head.spec.queries.find((x) => x.id === row.id);
      if (q === undefined) return `Not saved: the query ${row.id} is no longer in the app`;
      return { spec: withQuery(head.spec, { ...q, source: sentSource, output }), texts: { [row.id]: sentText }, summary: `Changed query ${row.id}` };
    });
    const words = r.ok ? `Saved as v${r.version}${sample ? ' (sample: not checked against a source)' : row.kind === 'sql' && checkable ? `: ${output.length} column${output.length === 1 ? '' : 's'}, re-read from the check` : ': checked by crew'}` : '';
    if (r.ok) onDone(words);
    if (!alive.current) return;
    setSave(r.ok ? { kind: 'saved', version: r.version, words } : { kind: 'refused', message: r.message, findings: r.findings });
  };

  return (
    <div className="wk-apps-data-editor" data-testid="apps-data-editor" data-query={row.id}>
      <label className="wk-apps-data-k" htmlFor={`wk-q-${row.id}`}>{row.kind === 'sql' ? 'SQL' : row.kind === 'graphql' ? 'GraphQL' : 'Request'}</label>
      <textarea id={`wk-q-${row.id}`} className="wk-apps-data-text" data-testid="apps-data-text" spellCheck={false} rows={8} readOnly={busy}
        value={text} onChange={(e) => { setText(e.currentTarget.value); setCheck({ kind: 'idle' }); setSave({ kind: 'idle' }); setGone([]); }} />
      <div className="wk-apps-data-row">
        <label className="wk-apps-data-k" htmlFor={`wk-qs-${row.id}`}>Source</label>
        {sample || choices.length <= 1
          ? <span data-testid="apps-data-source">{row.source}{current === undefined && !sample && kinds.length > 0 ? ' (not in crew’s registry)' : ''}</span>
          : (
            <select id={`wk-qs-${row.id}`} className="wk-apps-data-select" data-testid="apps-data-source-select" value={source} disabled={busy} onChange={(e) => { setSource(e.currentTarget.value); setCheck({ kind: 'idle' }); }}>
              {choices.map((c) => <option key={c.name} value={c.name}>{c.missing ? `${c.name} (not in crew’s registry)` : c.name}</option>)}
            </select>
          )}
      </div>
      {row.params.length > 0 && (
        <p className="wk-apps-data-meta" data-testid="apps-data-params">Parameters: {row.params.map((p) => `${p.name} (${p.type}${p.required ? ', required' : ''})`).join(', ')}</p>
      )}
      <p className="wk-apps-data-meta" data-testid="apps-data-output">Returns: {row.output.map((o) => `${o.name} (${o.type})`).join(', ')}</p>
      <p className="wk-apps-data-meta" data-testid="apps-data-usedby">{row.usedBy.length === 0 ? 'No component reads it.' : `Read by ${row.usedBy.map((u) => u.words).join(', ')}`}</p>
      <div className="wk-apps-data-actions">
        {checkable && <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-data-check" disabled={text.trim() === '' || busy} onClick={() => { void runCheck(); }}>Check</button>}
        <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="apps-data-save" disabled={!changed || text.trim() === '' || busy} onClick={() => { void checkAndSave(); }}>
          {sample ? 'Save (sample)' : checkable ? 'Check & save' : 'Save'}
        </button>
      </div>
      <CheckLine state={check} />
      <GoneList gone={gone} />
      <SaveLine state={save} />
    </div>
  );
}

/** Add data: a source, a table, the starter read (or one drafted in words), checked; then a new table or a binding. */
function AddData({ session, detail, sources, selectedId, page, navigate, onDone }: {
  session: AppSession; detail: AppDetail; sources: readonly McpServer[]; selectedId: string | null; page: string;
  navigate?: ((path: string) => void) | undefined; onDone: (words: string) => void;
}): React.ReactElement {
  const sql = sources.filter((s) => s.kind === 'sql');
  const [source, setSource] = useState<string>(sql[0]?.name ?? '');
  const [tables, setTables] = useState<{ source: string; dialect: 'postgres' | 'mysql' | 'sqlite'; relations: SourceCatalogRelation[] } | string | null>(null);
  const [table, setTable] = useState<SourceCatalogRelation | null>(null);
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<AskAnswer | 'asking' | string | null>(null);
  const targets = bindable(detail.spec);
  const [target, setTarget] = useState<string>(selectedId !== null && targets.some((t) => t.id === selectedId) ? selectedId : 'new-table');
  const pages = detail.spec.pages;
  const [onPage, setOnPage] = useState<string>(pages.some((p) => p.id === page) ? page : pages[0]?.id ?? '');
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  /** Bumped when the source changes: an answer (catalog, draft, check) for another source is never shown or used. */
  const gen = useRef(0);
  const alive = useRef(false);
  // Set on setup and cleared on cleanup: Strict Mode replays effects (setup, cleanup, setup) (codex r14).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const busy = check.kind === 'checking' || save.kind === 'saving' || asked === 'asking';

  useEffect(() => {
    if (source === '') return;
    const mine = (gen.current += 1);
    setTables(null); setTable(null); setText(''); setAsked(null); setCheck({ kind: 'idle' }); setSave({ kind: 'idle' });
    void sourcesApi.catalog(source).then((c) => {
      if (gen.current !== mine) return;
      const cat = c.catalog as never;
      setTables(isSqlCatalog(cat) ? { source, dialect: (cat as { dialect: 'postgres' | 'mysql' | 'sqlite' }).dialect, relations: (cat as { relations: SourceCatalogRelation[] }).relations } : `${source} has no tables to read`);
    }, (e: unknown) => { if (gen.current === mine) setTables(errText(e)); });
  }, [source]);
  useEffect(() => {
    if (selectedId !== null && targets.some((t) => t.id === selectedId)) setTarget(selectedId);
    if (pages.some((p) => p.id === page)) setOnPage(page);
  }, [selectedId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (r: SourceCatalogRelation): void => {
    if (tables === null || typeof tables === 'string') return;
    setTable(r);
    setText(starterSql(r, tables.dialect));
    setCheck({ kind: 'idle' });
    setSave({ kind: 'idle' });
  };
  const ask = async (): Promise<void> => {
    const mine = gen.current;
    setAsked('asking');
    try {
      const a = await askSource(source, question);
      if (alive.current && gen.current === mine) setAsked(a);
    } catch (e) { if (alive.current && gen.current === mine) setAsked(errText(e)); }
  };
  const add = async (): Promise<void> => {
    const mine = gen.current;
    const sentSource = source;
    const sentText = text;
    const fromTable = table;
    setSave({ kind: 'idle' });
    setCheck({ kind: 'checking' });
    let r: SourceCheckResponse;
    try { r = await checkText(sentSource, sentText); } catch (e) { if (alive.current && gen.current === mine) setCheck({ kind: 'refused', code: 'unavailable', detail: errText(e) }); return; }
    if (!alive.current || gen.current !== mine) return;
    const out = outputFromCheck(r);
    if (!out.ok) { setCheck(out.state); return; }
    setCheck({ kind: 'ok', columns: out.columns });
    const output = outputOf(out.columns);
    setSave({ kind: 'saving' });
    const landed = await session.landDirect((head) => {
      if (!alive.current || gen.current !== mine) return 'Not added: the panel or its source changed before it was saved';
      const id = freshQueryId(head.spec, fromTable?.name ?? 'query');
      const q: AppQuery = { id, source: sentSource, kind: 'sql', output };
      const withQ = withQuery(head.spec, q);
      const placed = target === 'new-table' ? addTableFor(withQ, onPage, id) : bindTo(withQ, target, id);
      if (!placed.ok) return `Not added: ${placed.message}`;
      return { spec: placed.spec, texts: { [id]: sentText }, summary: `Added query ${id}${fromTable !== null ? ` from ${relationName(fromTable)}` : ''}` };
    });
    const words = landed.ok ? `Added as v${landed.version}: ${target === 'new-table' ? 'a new table reads it' : 'bound to the component you picked'}` : '';
    if (landed.ok) onDone(words);
    if (!alive.current) return;
    setSave(landed.ok ? { kind: 'saved', version: landed.version, words } : { kind: 'refused', message: landed.message, findings: landed.findings });
  };
  const toSources = (e: React.MouseEvent): void => { if (navigate !== undefined) { e.preventDefault(); navigate(SOURCES_PATH); } };

  if (sql.length === 0) {
    return (
      <p className="wk-apps-data-note" data-testid="apps-data-nosource">
        No data source to read from yet. <a href={SOURCES_PATH} className="wk-link" data-testid="apps-data-sources-link" onClick={toSources}>Add one on Data sources</a>, then come back here.
      </p>
    );
  }
  return (
    <div className="wk-apps-data-add" data-testid="apps-data-add">
      <div className="wk-apps-data-row">
        <label className="wk-apps-data-k" htmlFor="wk-add-source">Source</label>
        <select id="wk-add-source" className="wk-apps-data-select" data-testid="apps-data-add-source" value={source} disabled={busy} onChange={(e) => setSource(e.currentTarget.value)}>
          {sql.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <a href={SOURCES_PATH} className="wk-link wk-apps-data-more" onClick={toSources}>Data sources</a>
      </div>
      {tables === null && <p className="wk-apps-data-note">Reading its tables…</p>}
      {typeof tables === 'string' && <p className="wk-apps-data-note wk-apps-data-note--fail" role="alert">{tables}</p>}
      {tables !== null && typeof tables !== 'string' && (
        <ul className="wk-apps-data-tables" aria-label="Tables">
          {tables.relations.map((r) => (
            <li key={relationName(r)}>
              <button type="button" className="wk-apps-data-table" data-testid="apps-data-table" data-table={relationName(r)} aria-pressed={table === r} disabled={busy} onClick={() => pick(r)}>
                <span className="wk-apps-data-name">{relationName(r)}</span> <span className="wk-apps-data-meta">{rowsLine(r, tables.dialect === 'sqlite')}</span>
              </button>
            </li>
          ))}
          {tables.relations.length === 0 && <li className="wk-apps-data-note">No tables this login can see.</li>}
        </ul>
      )}
      <div className="wk-apps-data-row">
        <label className="wk-apps-data-k" htmlFor="wk-add-ask">Or ask in words</label>
        <input id="wk-add-ask" className="wk-apps-data-input" data-testid="apps-data-ask" value={question} maxLength={1000} placeholder="How many tickets are open per region?" onChange={(e) => setQuestion(e.currentTarget.value)} />
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-data-ask-go" disabled={question.trim() === '' || busy} onClick={() => { void ask(); }}>Draft</button>
      </div>
      {asked === 'asking' && <p className="wk-apps-data-note">A seat is drafting a read from the structure (nothing runs)…</p>}
      {typeof asked === 'string' && asked !== 'asking' && <p className="wk-apps-data-note wk-apps-data-note--fail" role="alert" data-testid="apps-data-ask-failed">{asked}</p>}
      {asked !== null && typeof asked === 'object' && (
        <div className="wk-apps-data-draft" data-testid="apps-data-draft">
          <p className="wk-apps-data-note">Drafted for {source}: {asked.explanation}</p>
          {asked.sql !== '' && <pre className="wk-apps-data-sql" data-testid="apps-data-draft-sql">{asked.sql}</pre>}
          {asked.check !== null && <CheckLine state={asked.check.ok ? { kind: 'ok', columns: asked.check.columns } : { kind: 'refused', code: asked.check.code, detail: asked.check.detail }} />}
          {asked.sql !== '' && <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-data-use-draft" disabled={busy} onClick={() => { setText(asked.sql); setTable(null); setCheck({ kind: 'idle' }); }}>Use this SQL</button>}
        </div>
      )}
      {text !== '' && (
        <>
          <label className="wk-apps-data-k" htmlFor="wk-add-text">The new query</label>
          <textarea id="wk-add-text" className="wk-apps-data-text" data-testid="apps-data-add-text" spellCheck={false} rows={6} readOnly={busy} value={text} onChange={(e) => { setText(e.currentTarget.value); setCheck({ kind: 'idle' }); }} />
          <div className="wk-apps-data-row">
            <label className="wk-apps-data-k" htmlFor="wk-add-target">Then</label>
            <select id="wk-add-target" className="wk-apps-data-select" data-testid="apps-data-target" value={target} disabled={busy} onChange={(e) => setTarget(e.currentTarget.value)}>
              <option value="new-table">Add a table that reads it</option>
              {targets.map((t) => <option key={t.id} value={t.id}>Bind {t.words} to it</option>)}
            </select>
          </div>
          {target === 'new-table' && pages.length > 1 && (
            <div className="wk-apps-data-row">
              <label className="wk-apps-data-k" htmlFor="wk-add-page">On page</label>
              <select id="wk-add-page" className="wk-apps-data-select" data-testid="apps-data-page" value={onPage} disabled={busy} onChange={(e) => setOnPage(e.currentTarget.value)}>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.title.slice(0, 60)}</option>)}
              </select>
            </div>
          )}
          <div className="wk-apps-data-actions">
            <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="apps-data-add-save" disabled={text.trim() === '' || busy} onClick={() => { void add(); }}>Check & add</button>
          </div>
          <CheckLine state={check} />
          <SaveLine state={save} />
        </>
      )}
    </div>
  );
}

export function AppDataPanel({ session, detail, sample, selectedId, page, navigate, onClose }: {
  session: AppSession; detail: AppDetail; sample: boolean; selectedId: string | null; page: string;
  navigate?: ((path: string) => void) | undefined; onClose: () => void;
}): React.ReactElement {
  const rows = useMemo(() => queryRows(detail.spec, detail.queryText ?? {}), [detail]);
  const [open, setOpen] = useState<string | null>(null);
  const [sources, setSources] = useState<McpServer[] | string | null>(sample ? [] : null);
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    if (sample) return undefined;
    let cancelled = false;
    void sourcesApi.list().then((r) => { if (!cancelled) setSources(r.servers ?? []); }, (e: unknown) => { if (!cancelled) setSources(errText(e)); });
    return () => { cancelled = true; };
  }, [sample]);
  const list = Array.isArray(sources) ? sources : null;
  const toSources = (e: React.MouseEvent): void => { if (navigate !== undefined) { e.preventDefault(); navigate(SOURCES_PATH); } };
  return (
    <aside className="wk-apps-data" aria-label="Data" data-testid="apps-data">
      <header className="wk-apps-data-head">
        <h2 className="wk-apps-data-title">Data</h2>
        <button type="button" className="wk-btn wk-btn--link" data-testid="apps-data-close" onClick={onClose}>Close</button>
      </header>
      {sample && <p className="wk-apps-data-note" data-testid="apps-data-sample">Sample app: a query’s text saves in this browser only. It is not checked against a source, and its rows stay made up.</p>}
      {last !== null && <p className="wk-apps-data-note wk-apps-data-note--ok" role="status" data-testid="apps-data-last">{last}</p>}
      <section aria-label="Queries">
        <h3 className="wk-apps-data-sec">Queries <span className="wk-apps-data-meta">{rows.length}</span></h3>
        <ul className="wk-apps-data-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="wk-apps-data-q" data-testid="apps-data-query" data-query={r.id} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="wk-apps-data-name">{r.id}</span>
                <span className="wk-apps-data-meta">{r.source} · {r.kind} · {r.usedBy.length === 0 ? 'unused' : `${r.usedBy.length} reader${r.usedBy.length === 1 ? '' : 's'}`}</span>
              </button>
              {/* Keyed by the query itself: an unrelated landing (a move on the canvas) keeps the draft and any refusal;
                  a change to THIS query (its own save, an undo, another tab) opens it afresh (codex r13). */}
              {open === r.id && (
                <QueryEditor key={`${r.id}:${snapshotOf(detail.spec, detail.queryText ?? {}, r.id)}`} session={session} detail={detail} sample={sample} sources={list} row={r} onDone={setLast} />
              )}
            </li>
          ))}
          {rows.length === 0 && <li className="wk-apps-data-note">This app reads no data yet.</li>}
        </ul>
      </section>
      <section aria-label="Add data">
        <h3 className="wk-apps-data-sec">Add data</h3>
        {sample && (
          <p className="wk-apps-data-note" data-testid="apps-data-nosource">
            A sample app reads no real source. <a href={SOURCES_PATH} className="wk-link" data-testid="apps-data-sources-link" onClick={toSources}>Data sources</a> is where crew’s sources are added.
          </p>
        )}
        {!sample && sources === null && <p className="wk-apps-data-note">Reading crew’s sources…</p>}
        {!sample && typeof sources === 'string' && <p className="wk-apps-data-note wk-apps-data-note--fail" role="alert">The sources could not be read: {sources}</p>}
        {!sample && list !== null && <AddData session={session} detail={detail} sources={list} selectedId={selectedId} page={page} navigate={navigate} onDone={setLast} />}
      </section>
    </aside>
  );
}
