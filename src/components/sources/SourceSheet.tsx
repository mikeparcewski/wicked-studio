import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Braces, Check, Database, Eye, FileUp, Globe, Network, Plug, Table2, Workflow, X, type LucideIcon } from 'lucide-react';
import { ApiError } from '../../api/errors.js';
import {
  CREW_SOURCE,
  sourcesApi,
  type CrewSourceCatalog,
  type McpPreviewResponse,
  type McpServer,
  type SourceCatalog,
  type SourceCatalogResponse,
  type SourcePrivilegeReport,
  type SourceUploadResponse,
} from '../../api/sources.js';
import { useModalEscape } from '../Modal.js';
import { AllowWritesSwitch } from './AllowWritesSwitch.js';
import { SecretField, type SecretHandle } from './SecretField.js';
import {
  agentsSeeWords,
  configBody,
  confirmedAddress,
  defaultPort,
  describedLine,
  EMPTY_FORM,
  formBlocker,
  isApiKind,
  isSqlCatalog,
  isSqlKind,
  operationsByClass,
  previewKey,
  privilegeLine,
  relationName,
  rowsLine,
  SHEET_KINDS,
  sheetKindOf,
  targetKey,
  unconfirmedAddress,
  type SheetKind,
  type SourceForm,
  type UnconfirmedAddress,
  withRange,
} from './sourceModel.js';
import { TestCall } from './TestCall.js';

const KIND_ICON: Record<SheetKind, LucideIcon> = {
  postgres: Database, mysql: Database, rest: Braces, graphql: Network, mcp: Plug, upload: FileUp, crew: Workflow,
};

/** What the sheet opens on: a new source, a saved one, or the built-in crew source. */
export type SheetTarget = { mode: 'new' } | { mode: 'saved'; server: McpServer } | { mode: 'crew' };

const codeOf = (e: unknown): string | null => {
  const c = e instanceof ApiError ? (e.body as { code?: unknown } | undefined)?.code : undefined;
  return typeof c === 'string' ? c : null;
};
const words = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * "ADD A DATA SOURCE" (DES-APPS-001 §5, mockup state A): the kinds, the connection, the secret, TLS, the
 * address confirmation, the Test (crew's describe), the privilege report, what agents see, and the Allow
 * writes switch, off by default. Save registers exactly the preview the person saw and keeps the sheet
 * open on the SAVED source, where the switch and the test call are live (both act on a saved source).
 */
export function SourceSheet({ target, existing, onSaved, onAllowWrites, onClose }: {
  target: SheetTarget;
  /** Names already registered (a new source of the same name replaces it; the sheet says so). */
  existing: readonly string[];
  onSaved: (server: McpServer) => void;
  onAllowWrites: (name: string, allowed: boolean) => void;
  onClose: () => void;
}): React.ReactElement {
  const titleId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  useModalEscape(onClose);
  useEffect(() => { box.current?.focus(); }, []);

  const [form, setForm] = useState<SourceForm>(() =>
    target.mode === 'crew' ? { ...EMPTY_FORM, kind: 'crew' } : target.mode === 'saved' ? { ...EMPTY_FORM, kind: sheetKindOf(target.server), name: target.server.name } : EMPTY_FORM,
  );
  const [saved, setSaved] = useState<McpServer | null>(target.mode === 'saved' ? target.server : null);
  const secret = useRef<SecretHandle | null>(null);
  /** THAT the secret changed, and whether one is typed: never its value. */
  const [secretEdits, setSecretEdits] = useState(0);
  const [hasSecret, setHasSecret] = useState(false);
  const [held, setHeld] = useState<{ key: string; preview: McpPreviewResponse; ms: number } | null>(null);
  /** Every loopback/private address crew named for a connection (a name can resolve to several). */
  const [asks, setAsks] = useState<Array<UnconfirmedAddress & { forTarget: string }>>([]);
  const [busy, setBusy] = useState<null | 'test' | 'save' | 'describe' | 'upload'>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptReads, setAcceptReads] = useState(false);
  const [catalog, setCatalog] = useState<SourceCatalogResponse | null>(null);
  const [crewCatalog, setCrewCatalog] = useState<CrewSourceCatalog | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headerChoice, setHeaderChoice] = useState<'detect' | 'yes' | 'no'>('detect');
  const [upload, setUpload] = useState<SourceUploadResponse | null>(null);

  const key = previewKey(form, hasSecret, secretEdits);
  const keyRef = useRef(key);
  keyRef.current = key;
  const seq = useRef(0);
  const preview = held !== null && held.key === key ? held.preview : null;
  const asksNow = asks.filter((a) => a.forTarget === targetKey(form));
  const confirmed = confirmedAddress(form);
  const unticked = asksNow.filter((a) => !(confirmed?.allow.includes(a.range) ?? false));
  const askNow = unticked[0] ?? null;

  // A saved source's catalog and privileges (structure only), and the built-in crew source's routes.
  useEffect(() => {
    let live = true;
    const name = target.mode === 'crew' ? CREW_SOURCE : saved !== null && (saved.kind === 'sql' || saved.kind === 'graphql') ? saved.name : null;
    if (name === null || upload !== null) return () => { live = false; };
    sourcesApi.catalog(name).then(
      (c) => { if (!live) return; if (c.kind === 'crew') setCrewCatalog(c.catalog as CrewSourceCatalog); else setCatalog(c); },
      (e: unknown) => { if (live && codeOf(e) !== 'not_described') setError(words(e)); },
    );
    return () => { live = false; };
  }, [target.mode, saved, upload]);

  const edit = (patch: Partial<SourceForm>): void => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };

  const test = async (f: SourceForm = form): Promise<void> => {
    const body = configBody(f, secret.current?.has() ?? false);
    if (body === null) return;
    const asked = previewKey(f, secret.current?.has() ?? false, secretEdits);
    const mine = ++seq.current;
    const still = (): boolean => mine === seq.current && keyRef.current === asked;
    setBusy('test');
    setError(null);
    setHeld(null);
    const t0 = performance.now();
    try {
      const has = secret.current?.has() ?? false;
      const p = await sourcesApi.preview(body, has ? (secret.current?.read() ?? null) : null);
      if (still()) setHeld({ key: asked, preview: p, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      if (!still()) return;
      const code = codeOf(e);
      const wire = e instanceof ApiError ? e.wire : words(e);
      const u = code === 'address_unconfirmed' ? unconfirmedAddress(wire) : null;
      if (u !== null) {
        const forTarget = targetKey(f);
        setAsks((list) => (list.some((a) => a.forTarget === forTarget && a.range === u.range) ? list : [...list, { ...u, forTarget }]));
        return;
      }
      setError(code === 'plaintext_refused'
        ? `${wire} Use TLS, or (on a private range you confirm) tick “without TLS”.`
        : words(e));
    } finally {
      if (mine === seq.current) setBusy(null);
    }
  };

  /** One asked range ticked or unticked. A tick is the person's confirmation: test again under it at once. */
  const confirmRange = (range: string, on: boolean): void => {
    const next = withRange(form, range, on, form.confirm?.plaintext ?? false);
    setForm(next);
    setError(null);
    if (on) void test(next);
  };
  const confirmPlaintext = (on: boolean): void => {
    if (form.confirm === null) return;
    const next: SourceForm = { ...form, confirm: { ...form.confirm, plaintext: on } };
    setForm(next);
    setError(null);
    if (on) void test(next);
  };

  const save = async (): Promise<void> => {
    if (preview === null) return;
    setBusy('save');
    setError(null);
    try {
      const s = await sourcesApi.save(preview.previewHash);
      // crew wrote the secret to the keychain with the save: the field lets go of it now.
      secret.current?.clear();
      setHasSecret(false);
      setSaved(s);
      onSaved(s);
    } catch (e) {
      setError(words(e));
    } finally {
      setBusy(null);
    }
  };

  const describeAgain = async (): Promise<void> => {
    if (saved === null) return;
    setBusy('describe');
    setError(null);
    const t0 = performance.now();
    try {
      setCatalog(await sourcesApi.describe(saved.name));
      setHeld((h) => (h === null ? h : { ...h, ms: Math.round(performance.now() - t0) }));
    } catch (e) {
      setError(words(e));
    } finally {
      setBusy(null);
    }
  };

  const doUpload = async (): Promise<void> => {
    if (file === null) return;
    setBusy('upload');
    setError(null);
    try {
      const r = await sourcesApi.upload(form.name.trim(), file, headerChoice === 'detect' ? null : headerChoice);
      setUpload(r);
      setSaved(r.source);
      onSaved(r.source);
    } catch (e) {
      setError(words(e));
    } finally {
      setBusy(null);
    }
  };

  const kind = form.kind;
  const isNew = saved === null && target.mode === 'new';
  const sql = saved?.sql ?? null;
  // What the right column shows: the held preview's describe (new), or the saved source's catalog.
  const shownCatalog: SourceCatalog | null = upload?.catalog ?? catalog?.catalog as SourceCatalog | undefined ?? preview?.source?.catalog ?? null;
  const shownPrivileges: SourcePrivilegeReport | null = catalog?.privileges ?? preview?.source?.privileges ?? null;
  const blocker = isNew ? formBlocker(form) : null;
  const ops = preview !== null && (kind === 'rest' || kind === 'mcp') ? operationsByClass(preview) : null;
  const replaces = isNew && existing.includes(form.name.trim());
  const saveBlocker = !isNew ? null
    : kind === 'upload' ? (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(form.name.trim()) ? 'Name it first' : file === null ? 'Pick a file' : null)
    : blocker ?? (preview === null ? (askNow !== null ? 'Confirm the address, then test' : 'Test it first: Save registers exactly what the test saw') : ops !== null && ops.reads.length > 0 && !acceptReads ? 'Accept the reads first' : null);
  const title = isNew ? 'Add a data source' : target.mode === 'crew' ? 'crew (built in)' : saved?.name ?? 'Data source';

  return (
    <div className="wk-src-scrim" data-testid="source-sheet-scrim">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="wk-src-sheet" data-testid="source-sheet" data-kind={kind} data-mode={isNew ? 'new' : 'saved'}>
        <header className="wk-src-sheet-head">
          <Database size={18} aria-hidden className="wk-src-ico" />
          <h2 id={titleId} className="wk-src-title" data-testid="source-sheet-title">{title}</h2>
          <span className="wk-src-sp" />
          <span className="wk-src-cap wk-src-head-cap">Reads are on. Writes stay off until you grant one.</span>
          <button type="button" aria-label="Close" className="wk-btn wk-btn--quiet wk-btn--icon" data-testid="source-sheet-close" onClick={onClose}><X size={16} aria-hidden /></button>
        </header>
        <div className="wk-src-sheet-main">
          {isNew && (
            <div className="wk-src-kinds" role="radiogroup" aria-label="Kind of source" data-testid="source-kinds">
              {SHEET_KINDS.map((k) => {
                const I = KIND_ICON[k.kind];
                return (
                  <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} data-testid={`source-kind-${k.kind}`}
                    className={`wk-src-kind${kind === k.kind ? ' wk-src-kind--on' : ''}`}
                    onClick={() => { setForm({ ...EMPTY_FORM, kind: k.kind, name: form.name }); setHeld(null); setAsks([]); setError(null); setAcceptReads(false); }}>
                    <I size={16} aria-hidden className="wk-src-ico" /><span>{k.label}</span>{k.meta !== undefined && <span className="wk-src-meta">{k.meta}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="wk-src-grid">
            <div className="wk-src-col" data-testid="source-form">
              {kind === 'crew' ? (
                <div className="wk-src-box">
                  <p className="wk-src-strong">Nothing to add</p>
                  <p className="wk-src-note">crew’s own API is always on. Apps read its allowlisted routes in crew, as the person viewing; it has no writes.</p>
                </div>
              ) : (
                <label className="wk-src-field">
                  <span className="wk-src-label">Name</span>
                  <input data-testid="source-name" className="wk-field wk-src-input" spellCheck={false} disabled={!isNew} value={form.name} placeholder="support-pg"
                    onChange={(e) => edit({ name: e.target.value })} />
                  {replaces && <span className="wk-src-note wk-src-tone-warn" data-testid="source-replaces">A source named {form.name.trim()} exists: saving replaces it.</span>}
                </label>
              )}

              {isSqlKind(kind) && (
                <>
                  <div className="wk-src-pair wk-src-pair--port">
                    <label className="wk-src-field"><span className="wk-src-label">Host</span>
                      <input data-testid="source-host" className="wk-field wk-src-input" spellCheck={false} disabled={!isNew} value={isNew ? form.host : (sql?.host ?? '')} placeholder="db.support.internal" onChange={(e) => edit({ host: e.target.value })} /></label>
                    <label className="wk-src-field"><span className="wk-src-label">Port</span>
                      <input data-testid="source-port" className="wk-field wk-src-input wk-src-num" inputMode="numeric" disabled={!isNew} value={isNew ? form.port : String(sql?.port ?? '')} placeholder={String(defaultPort(kind))} onChange={(e) => edit({ port: e.target.value })} /></label>
                  </div>
                  <div className="wk-src-pair">
                    <label className="wk-src-field"><span className="wk-src-label">Database</span>
                      <input data-testid="source-database" className="wk-field wk-src-input" spellCheck={false} disabled={!isNew} value={isNew ? form.database : (sql?.database ?? '')} placeholder="support" onChange={(e) => edit({ database: e.target.value })} /></label>
                    <label className="wk-src-field"><span className="wk-src-label">Login</span>
                      <input data-testid="source-user" className="wk-field wk-src-input" spellCheck={false} autoComplete="off" disabled={!isNew} value={isNew ? form.user : (sql?.user ?? '')} placeholder="reader" onChange={(e) => edit({ user: e.target.value })} /></label>
                  </div>
                </>
              )}
              {isApiKind(kind) && (
                <>
                  <label className="wk-src-field"><span className="wk-src-label">{kind === 'rest' ? 'Base URL (every call is pinned to it)' : kind === 'graphql' ? 'Endpoint' : 'Server URL'}</span>
                    <input data-testid="source-url" className="wk-field wk-src-input" spellCheck={false} disabled={!isNew} value={isNew ? form.url : (saved?.url ?? '')} placeholder={kind === 'rest' ? 'https://api.example.com/v1' : kind === 'graphql' ? 'https://api.example.com/graphql' : 'https://mcp.example.com/mcp'} onChange={(e) => edit({ url: e.target.value })} /></label>
                  {kind === 'rest' && (
                    <label className="wk-src-field"><span className="wk-src-label">OpenAPI document URL</span>
                      <input data-testid="source-openapi" className="wk-field wk-src-input" spellCheck={false} disabled={!isNew} value={isNew ? form.openapiUrl : (saved?.openapiUrl ?? '')} placeholder="https://api.example.com/openapi.json" onChange={(e) => edit({ openapiUrl: e.target.value })} /></label>
                  )}
                  {isNew && (
                    <div className="wk-src-pair">
                      <label className="wk-src-field"><span className="wk-src-label">Secret header</span>
                        <input data-testid="source-auth-header" className="wk-field wk-src-input" spellCheck={false} value={form.authHeader} placeholder="Authorization" onChange={(e) => edit({ authHeader: e.target.value })} /></label>
                      <label className="wk-src-field"><span className="wk-src-label">Scheme</span>
                        <input data-testid="source-auth-scheme" className="wk-field wk-src-input" spellCheck={false} value={form.authScheme} placeholder="Bearer" onChange={(e) => edit({ authScheme: e.target.value })} /></label>
                    </div>
                  )}
                </>
              )}
              {(isSqlKind(kind) || isApiKind(kind)) && (
                <SecretField
                  ref={secret}
                  label={isSqlKind(kind) ? 'Password' : 'Secret (token or key)'}
                  note="Kept in your keychain; never in the app, an export or an agent."
                  savedState={isNew ? null : (saved?.authState ?? 'none')}
                  disabled={busy !== null}
                  onEdit={(has) => { setHasSecret(has); setSecretEdits((n) => n + 1); setError(null); }}
                />
              )}
              {isSqlKind(kind) && isNew && (
                <label className="wk-src-field"><span className="wk-src-label">TLS</span>
                  <select data-testid="source-tls" className="wk-field wk-src-input" value={form.tls} onChange={(e) => edit({ tls: e.target.value as SourceForm['tls'] })}>
                    <option value="verify-full">Verify the certificate and host (verify-full)</option>
                    <option value="disable">Off (loopback, or a private range you confirm)</option>
                  </select></label>
              )}
              {isSqlKind(kind) && !isNew && sql !== null && <p className="wk-src-note">TLS: {sql.tls === 'verify-full' ? 'verify-full (certificate and host verified)' : 'off'}{sql.ca ? ' · with your CA' : ''}</p>}

              {(isSqlKind(kind) || isApiKind(kind)) && (
                <div className="wk-src-box wk-src-address" data-testid="source-address">
                  <p className="wk-src-okline wk-src-strong"><Globe size={16} aria-hidden className="wk-src-ico" />
                    {connectsTo(kind, isNew ? form.host : sql?.host ?? '', isNew ? form.port : String(sql?.port ?? ''), isNew ? form.url : saved?.url ?? '')}
                  </p>
                  {isNew && asksNow.map((a) => (
                    <label key={a.range} className="wk-src-check-row" data-testid="source-address-confirm" data-range={a.range}>
                      <input type="checkbox" checked={confirmed?.allow.includes(a.range) ?? false} data-testid="source-address-tick" disabled={busy !== null}
                        onChange={(e) => confirmRange(a.range, e.target.checked)} />
                      <span className="wk-src-note">{a.cls === 'loopback' ? 'Loopback' : 'Private'} address <code className="wk-src-mono">{a.address}</code>: allow this host at <code className="wk-src-mono">{a.range}</code> only.</span>
                    </label>
                  ))}
                  {isNew && form.tls === 'disable' && asksNow.some((a) => a.cls === 'private') && (
                    <label className="wk-src-check-row" data-testid="source-address-plaintext">
                      <input type="checkbox" checked={confirmed?.plaintext === true} disabled={confirmed === null || busy !== null} onChange={(e) => confirmPlaintext(e.target.checked)} />
                      <span className="wk-src-note">Without TLS on these private ranges: the password and every row cross the network unencrypted.</span>
                    </label>
                  )}
                  {isNew && asksNow.length === 0 && <p className="wk-src-note">A public address needs nothing more. A loopback or private one is asked here, for this source only.</p>}
                  {!isNew && saved?.address !== undefined && saved.address.allow.length > 0 && (
                    <p className="wk-src-note" data-testid="source-address-saved">Confirmed for this source: {saved.address.allow.join(', ')}{saved.address.plaintext === true ? ' (without TLS)' : ''}</p>
                  )}
                </div>
              )}

              {kind === 'postgres' && (
                <AllowWritesSwitch
                  source={saved?.name ?? (form.name.trim() || 'this source')}
                  login={saved?.sql?.user ?? (form.user.trim() || null)}
                  allowWrites={saved?.allowWrites === true}
                  saved={saved !== null}
                  privileges={shownPrivileges}
                  onChanged={(allowed) => { if (saved !== null) { setSaved({ ...saved, allowWrites: allowed }); onAllowWrites(saved.name, allowed); } }}
                />
              )}
              {kind === 'mysql' && <div className="wk-src-box"><p className="wk-src-strong">Writes</p><p className="wk-src-note">MySQL sources get no writes in v1: reads only.</p></div>}

              {kind === 'upload' && (
                <>
                  <label className="wk-src-field"><span className="wk-src-label">File (CSV, XLSX first sheet, or .sqlite)</span>
                    <input data-testid="source-file" type="file" accept=".csv,.xlsx,.sqlite,.db,text/csv" className="wk-src-file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} /></label>
                  <label className="wk-src-field"><span className="wk-src-label">First row</span>
                    <select data-testid="source-header" className="wk-field wk-src-input" value={headerChoice} onChange={(e) => setHeaderChoice(e.target.value as 'detect' | 'yes' | 'no')}>
                      <option value="detect">Detect the header</option>
                      <option value="yes">The first row is the header</option>
                      <option value="no">The first row is data (columns col_1…)</option>
                    </select></label>
                  <p className="wk-src-note">crew keeps a copy (a snapshot) and reads only that. An upload is a copy, so it has no writes. Uploading again under the same name replaces it.</p>
                </>
              )}
            </div>

            <div className="wk-src-col" data-testid="source-results">
              {(isSqlKind(kind) || isApiKind(kind)) && (
                <div className="wk-src-box" data-testid="source-test">
                  <div className="wk-src-box-head">
                    <span className="wk-src-strong">Test</span>
                    <span className="wk-src-sp" />
                    {isNew ? (
                      <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="source-test-run" disabled={blocker !== null || busy !== null} title={blocker ?? undefined} onClick={() => void test()}>
                        {busy === 'test' ? 'Testing…' : held !== null ? 'Test again' : 'Test'}
                      </button>
                    ) : (saved?.kind === 'sql' || saved?.kind === 'graphql') && (
                      <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="source-describe" disabled={busy !== null} onClick={() => void describeAgain()}>{busy === 'describe' ? 'Describing…' : 'Describe again'}</button>
                    )}
                  </div>
                  {isNew && preview === null && askNow === null && busy !== 'test' && <p className="wk-src-note">{blocker ?? 'Test connects, describes the structure and reads no rows.'}</p>}
                  {isNew && askNow !== null && <p className="wk-src-note wk-src-tone-warn" data-testid="source-test-unconfirmed">Not connected: {askNow.address} is a {askNow.cls} address. Confirm the range on the left to connect.</p>}
                  {(preview !== null || (!isNew && shownCatalog !== null)) && (
                    <div className="wk-src-lines" data-testid="source-test-ok">
                      <p className="wk-src-okline"><Check size={16} aria-hidden className="wk-src-ico wk-src-tone-ok" />{preview !== null ? `Connected and described in ${held?.ms ?? 0} ms` : 'Described'} · {kindName(kind)}</p>
                      {isSqlKind(kind) && <p className="wk-src-okline"><Check size={16} aria-hidden className="wk-src-ico wk-src-tone-ok" />{(saved?.sql?.tls ?? form.tls) === 'verify-full' ? 'TLS verified (verify-full)' : 'No TLS (allowed on this address)'}</p>}
                      {isSqlKind(kind) && <p className="wk-src-okline"><Check size={16} aria-hidden className="wk-src-ico wk-src-tone-ok" />Reads: read policy, then a read-only transaction</p>}
                      {shownPrivileges !== null && <PrivilegeLine report={shownPrivileges} />}
                    </div>
                  )}
                  {ops !== null && (
                    <div className="wk-src-ops" data-testid="source-operations">
                      <p className="wk-src-note">{ops.reads.length} read{ops.reads.length === 1 ? '' : 's'}: {ops.reads.join(', ') || 'none'}</p>
                      <p className="wk-src-note">{ops.writes.length} write{ops.writes.length === 1 ? '' : 's'} (each becomes an action an app may ask for, after a grant): {ops.writes.join(', ') || 'none'}</p>
                      {ops.reads.length > 0 && (
                        <label className="wk-src-check-row" data-testid="source-accept-reads">
                          <input type="checkbox" checked={acceptReads} onChange={(e) => setAcceptReads(e.target.checked)} />
                          <span className="wk-src-note">Accept these as reads. crew can’t stop an API that changes data on a GET or a read-only tool: accept only what you trust to read.</span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )}
              {kind === 'upload' && upload !== null && (
                <div className="wk-src-box" data-testid="source-upload-result">
                  <div className="wk-src-box-head"><span className="wk-src-strong">Uploaded</span><span className="wk-src-cap">{upload.snapshot.kind} · {(upload.snapshot.bytes / 1024).toFixed(1)} KB</span></div>
                  {upload.header !== null && (
                    <p className="wk-src-note" data-testid="source-upload-header">{upload.header.detected ? 'The first row is the header' : 'No header: the columns are'}: {upload.header.columns.join(', ')}</p>
                  )}
                  {upload.sample.length > 0 && (
                    <div className="wk-src-scroll">
                      <table className="wk-src-table" data-testid="source-upload-sample">
                        <caption className="wk-src-cap">The first {upload.sample.length} rows, shown to you only (agents never get values)</caption>
                        {upload.header !== null && <thead><tr>{upload.header.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>}
                        <tbody>{upload.sample.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {kind === 'crew' && crewCatalog !== null && (
                <div className="wk-src-box wk-src-grow" data-testid="source-crew-routes">
                  <div className="wk-src-box-head"><span className="wk-src-strong">Routes</span><span className="wk-src-cap">{crewCatalog.routes.length} allowlisted reads</span></div>
                  <ul className="wk-src-scroll wk-src-plain">{crewCatalog.routes.map((r) => <li key={r.path}><code className="wk-src-mono">GET {r.path}</code> <span className="wk-src-cap">{r.responseType}</span></li>)}</ul>
                </div>
              )}
              {shownCatalog !== null && isSqlCatalog(shownCatalog) && (
                <div className="wk-src-box wk-src-grow" data-testid="source-described">
                  <div className="wk-src-box-head"><span className="wk-src-strong">Described</span><span className="wk-src-cap">{describedLine(shownCatalog)}</span></div>
                  <div className="wk-src-scroll">
                    <table className="wk-src-table"><tbody>
                      {shownCatalog.relations.map((r) => (
                        <tr key={relationName(r)} data-testid="source-described-row">
                          <td><span className="wk-src-cell-name"><Table2 size={12} aria-hidden className="wk-src-ico" />{relationName(r)}{r.kind !== 'table' ? <span className="wk-src-cap">· {r.kind}</span> : null}</span></td>
                          <td className="wk-src-cap">{r.columns.length} column{r.columns.length === 1 ? '' : 's'}</td>
                          <td className="wk-src-n">{rowsLine(r, shownCatalog.dialect === 'sqlite')}</td>
                        </tr>
                      ))}
                    </tbody></table>
                  </div>
                </div>
              )}
              {shownCatalog !== null && !isSqlCatalog(shownCatalog) && 'queries' in shownCatalog && (
                <div className="wk-src-box" data-testid="source-described">
                  <div className="wk-src-box-head"><span className="wk-src-strong">Described</span><span className="wk-src-cap">{shownCatalog.queries.length} queries · {shownCatalog.mutations.length} mutations</span></div>
                  <p className="wk-src-note">{shownCatalog.queries.map((q) => q.name).join(', ')}</p>
                </div>
              )}
              {!isNew && saved !== null && (saved.kind === 'rest' || saved.kind === 'graphql' || saved.kind === 'mcp-http' || saved.kind === 'mcp-stdio') && (
                <TestCall
                  source={saved.name}
                  kind={saved.kind === 'graphql' ? 'graphql' : saved.kind === 'rest' ? 'rest' : 'mcp'}
                  reads={saved.tools.filter((t) => t.status === 'registered' && t.class === 'read' && (saved.kind !== 'rest' || t.rest?.method === 'GET' || t.rest?.method === 'HEAD')).map((t) => t.name)}
                />
              )}
              {kind !== 'upload' || upload !== null ? (
                <div className="wk-src-box" data-testid="source-agents-see">
                  <p className="wk-src-okline wk-src-strong"><Eye size={16} aria-hidden className="wk-src-ico" />What agents see</p>
                  <p className="wk-src-note">{agentsSeeWords(kind === 'upload' ? 'sqlite' : kind, shownCatalog)}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <footer className="wk-src-sheet-foot">
          {error !== null ? <p role="alert" className="wk-src-note wk-src-tone-fail wk-src-foot-msg" data-testid="source-sheet-error">{error}</p>
            : <span className="wk-src-cap wk-src-foot-msg" data-testid="source-sheet-foot">{isNew ? (saveBlocker ?? 'Saved sources appear in every app in this project.') : 'Saved. It appears in every app in this project.'}</span>}
          {isNew ? (
            <>
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="source-cancel" onClick={onClose}>Cancel</button>
              {kind === 'upload' ? (
                <button type="button" className="wk-btn wk-btn--primary" data-testid="source-upload" disabled={saveBlocker !== null || busy !== null} onClick={() => void doUpload()}>{busy === 'upload' ? 'Uploading…' : 'Upload source'}</button>
              ) : kind === 'crew' ? null : (
                <button type="button" className="wk-btn wk-btn--primary" data-testid="source-save" disabled={saveBlocker !== null || busy !== null} title={saveBlocker ?? undefined} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save source'}</button>
              )}
            </>
          ) : (
            <>
              {kind === 'upload' && file !== null && <button type="button" className="wk-btn wk-btn--secondary" data-testid="source-upload-again" disabled={busy !== null} onClick={() => void doUpload()}>Upload again</button>}
              <button type="button" className="wk-btn wk-btn--primary" data-testid="source-done" onClick={onClose}>Done</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function PrivilegeLine({ report }: { report: SourcePrivilegeReport }): React.ReactElement {
  const p = privilegeLine(report);
  return p.tone === 'ok'
    ? <p className="wk-src-okline" data-testid="source-privileges" data-read-only="yes"><Check size={16} aria-hidden className="wk-src-ico wk-src-tone-ok" />{p.text}</p>
    : <p className="wk-src-warnbox" data-testid="source-privileges" data-read-only="no"><AlertTriangle size={16} aria-hidden className="wk-src-ico wk-src-tone-warn" /><span>{p.text}</span></p>;
}

function kindName(k: SheetKind): string {
  return SHEET_KINDS.find((x) => x.kind === k)?.label ?? k;
}

/** "Connects only to db.support.internal:5432" (or what the person still has to name). */
function connectsTo(kind: SheetKind, host: string, port: string, url: string): string {
  if (isSqlKind(kind)) {
    const h = host.trim();
    return h === '' ? 'Connects only to the host you name' : `Connects only to ${h}:${port.trim() || String(defaultPort(kind))}`;
  }
  const u = hostOf(url);
  return u === null ? 'Connects only to the host of the URL you name' : `Connects only to ${u}`;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}
