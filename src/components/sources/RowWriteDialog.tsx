import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { sourcesApi, type McpServer, type SourceCatalogRelation, type SourcePrivilegeReport, type SourceRowWrite } from '../../api/sources.js';
import { useModalEscape } from '../Modal.js';
import { AllowWritesSwitch } from './AllowWritesSwitch.js';
import { CodeWords } from './CodeWords.js';
import { declareRowWrite, grantGate, relationName, rowWriteLine, type GrantGate, type RowWriteOp } from './sourceModel.js';
import { focusRadio, radioKey } from './radioKeys.js';
import { useDialogFocus } from './useDialogFocus.js';

/**
 * Where a checked row write is granted. A grant is an app's (DES §9.4: keyed by app and action, bound to
 * the action hash, the contract hash with the safety fingerprint, and the source descriptor), so the
 * host that knows the app supplies it: K5's Apps section with crew's `POST /apps/:app/actions/:id/grant`.
 * Answers `null` when granted, or the words saying why not.
 */
export interface RowWriteGrantPort {
  grant(source: string, write: SourceRowWrite, fingerprint: string): Promise<string | null>;
}

/** The Sources page has no app: the checks run, and the words say where the grant is made. */
export const NO_APP_GRANTS: RowWriteGrantPort = {
  grant: async () => 'The checks passed. Nothing was granted: a grant belongs to an app’s action, so it is made in the app that uses this row write (Apps).',
};

const OPS: ReadonlyArray<{ op: RowWriteOp; label: string; note: string }> = [
  { op: 'update', label: 'Update', note: 'Sets the columns you pick on the one row whose key matches.' },
  { op: 'insert', label: 'Insert', note: 'Supplies every column, the key included; refused when the table has a foreign key.' },
  { op: 'delete', label: 'Delete', note: 'Removes the one row whose key matches; refused when another table references this one.' },
];

/**
 * DECLARE A ROW WRITE FROM A TABLE'S MENU, THEN GRANT IT (DES-APPS-001 §7.4, §9.4). The grant is checked
 * in crew's order and stops at the first refusal, each shown with its reason:
 *  1. Allow writes is off: refused before anything is asked of the source, and the switch is offered here;
 *  2. the table safety check fails: every reason, in crew's words naming the object (a trigger, a rule …);
 *  3. the login lacks a privilege: the exact GRANT statements still missing;
 *  4. otherwise the host's grant (`RowWriteGrantPort`).
 */
export function RowWriteDialog({ source, relation, privileges, declared, port, onDeclared, onAllowWrites, onClose }: {
  source: McpServer;
  relation: SourceCatalogRelation;
  privileges: SourcePrivilegeReport | null | undefined;
  /** An existing declaration (the Actions list's Grant): opens at the grant step. */
  declared: SourceRowWrite | null;
  port: RowWriteGrantPort;
  onDeclared: (write: SourceRowWrite) => void;
  onAllowWrites: (allowed: boolean) => void;
  onClose: () => void;
}): React.ReactElement {
  const titleId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  useModalEscape(onClose);
  useDialogFocus(box);
  const keyCols = relation.primaryKey;
  const [op, setOp] = useState<RowWriteOp>(declared?.op ?? 'update');
  const [picked, setPicked] = useState<string[]>(declared?.op === 'update' ? declared.set : []);
  const [write, setWrite] = useState<SourceRowWrite | null>(declared);
  const [gate, setGate] = useState<GrantGate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ granted: boolean; words: string } | null>(null);
  /** The grant pipeline's generation: an edit to the declaration (or a new Grant) stops the old one. */
  const gen = useRef(0);
  /** A grant check in flight (a second click in the same tick asks nothing). */
  const inFlight = useRef(false);
  /** The source's switch and descriptor as rendered now: a check started under others stops. */
  const live = useRef({ allowWrites: source.allowWrites === true, descriptor: source.descriptorHash ?? null, mounted: true });
  // Updated in place (one object for the dialog's life), so the unmount below marks the same one.
  live.current.allowWrites = source.allowWrites === true;
  live.current.descriptor = source.descriptorHash ?? null;
  useEffect(() => {
    const state = live.current;
    const generation = gen;
    state.mounted = true;
    return () => { state.mounted = false; generation.current++; };
  }, []);
  // Turning Allow writes off, or the source saved again, stops a check in flight.
  // The evidence shown (a refusal, the checks passed, "granted") was for the switch and descriptor of
  // then: once either changes it is cleared, and the next Grant checks again.
  useEffect(() => { gen.current++; inFlight.current = false; setBusy(false); setGate(null); setOutcome(null); setError(null); }, [source.allowWrites, source.descriptorHash]);
  const draft = declareRowWrite(relation, op, picked);
  /**
   * A declaration made before the table changed (a column added, the key changed) no longer says what
   * the table is: it is shown as declared, and must be declared again before it is checked or granted.
   */
  const fresh = write === null ? null : declareRowWrite(relation, write.op, write.set);
  const stale = write !== null && fresh !== null && (typeof fresh === 'string' || rowWriteLine(fresh) !== rowWriteLine(write) || fresh.key.join() !== write.key.join());

  const declare = (): void => {
    if (typeof draft === 'string') return;
    setWrite(draft);
    setGate(null);
    setOutcome(null);
    onDeclared(draft);
  };

  const grant = async (): Promise<void> => {
    if (write === null || inFlight.current || stale) return;
    const mine = ++gen.current;
    const startedFor = source.descriptorHash ?? null;
    // Every stage re-checks: this dialog is open, nothing was edited, Allow writes is still on, same source.
    const still = (): boolean => mine === gen.current && live.current.mounted && live.current.allowWrites && live.current.descriptor === startedFor;
    setError(null);
    setOutcome(null);
    // (1) Allow writes first: nothing is asked of the source while it is off.
    const off = grantGate(source.name, source.allowWrites === true, null, null);
    if (off !== null) { setGate(off); return; }
    inFlight.current = true;
    setBusy(true);
    try {
      // (2) The table safety check, with the declaration.
      const safety = await sourcesApi.safety(source.name, { schema: write.schema, table: write.table, write: { op: write.op, set: write.set, key: write.key } });
      if (!still()) return;
      const unsafe = grantGate(source.name, live.current.allowWrites, safety, null);
      if (unsafe !== null) { setGate(unsafe); return; }
      // (3) The privileges this login still needs for it.
      const report = await sourcesApi.privileges(source.name, [write]);
      if (!still()) return;
      const g = grantGate(source.name, live.current.allowWrites, safety, report.writes[0]?.missing ?? []);
      setGate(g);
      if (g?.step !== 'ready') return;
      // (4) The host's grant.
      const why = await port.grant(source.name, write, g.fingerprint);
      if (!still()) return;
      setOutcome(why === null ? { granted: true, words: `Granted: ${rowWriteLine(write)}. Every run still shows its card first.` } : { granted: false, words: why });
    } catch (e) {
      if (still()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      if (still()) setBusy(false);
    }
  };

  return (
    <div className="wk-src-scrim" data-testid="row-write-scrim">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="wk-src-dialog" data-testid="row-write-dialog">
        <header className="wk-src-sheet-head">
          <div className="wk-src-head-text">
            <h2 id={titleId} className="wk-src-title">Row write on {relationName(relation)}</h2>
            <span className="wk-src-cap">{source.name}</span>
          </div>
          <button type="button" aria-label="Close" className="wk-btn wk-btn--quiet wk-btn--icon" onClick={onClose} data-testid="row-write-close"><X size={16} aria-hidden /></button>
        </header>
        <div className="wk-src-dialog-body">
          <div className="wk-src-seg" role="radiogroup" aria-label="Operation">
            {OPS.map((o, i) => {
              const pick = (next: RowWriteOp): void => { if (next === op) return; gen.current++; setOp(next); setWrite(null); setGate(null); setOutcome(null); };
              return (
                <button key={o.op} type="button" role="radio" aria-checked={op === o.op} data-testid={`row-write-op-${o.op}`}
                  tabIndex={op === o.op ? 0 : -1}
                  className={`wk-src-seg-btn${op === o.op ? ' wk-src-seg-btn--on' : ''}`} disabled={busy}
                  onKeyDown={(e) => {
                    const j = radioKey(e.key, i, OPS.length);
                    if (j === null) return;
                    e.preventDefault();
                    pick(OPS[j]!.op);
                    focusRadio(e.currentTarget, j);
                  }}
                  onClick={() => pick(o.op)}>{o.label}</button>
              );
            })}
          </div>
          <p className="wk-src-note">{OPS.find((o) => o.op === op)?.note}</p>
          <p className="wk-src-note" data-testid="row-write-key">Key: {keyCols.length > 0 ? keyCols.join(', ') : 'none'} (the whole primary key, each from a parameter).</p>
          {op === 'update' && (
            <fieldset className="wk-src-cols" data-testid="row-write-columns">
              <legend className="wk-src-label">Columns it sets</legend>
              {relation.columns.filter((c) => !keyCols.includes(c.name)).map((c) => (
                <label key={c.name} className="wk-src-check-row">
                  <input type="checkbox" checked={picked.includes(c.name)} data-testid={`row-write-col-${c.name}`} disabled={busy}
                    onChange={(e) => { gen.current++; setPicked((p) => (e.target.checked ? [...p, c.name] : p.filter((x) => x !== c.name))); setWrite(null); setGate(null); setOutcome(null); }} />
                  <span>{c.name}</span><span className="wk-src-cap">{c.type}</span>
                </label>
              ))}
            </fieldset>
          )}
          {write !== null
            ? <code className="wk-src-code" data-testid="row-write-line">{rowWriteLine(write)}</code>
            : typeof draft === 'string'
              ? <p className="wk-src-note" data-testid="row-write-line">{draft}</p>
              : <code className="wk-src-code" data-testid="row-write-line">{rowWriteLine(draft)}</code>}
          {stale && (
            <p className="wk-src-note wk-src-tone-warn" role="status" data-testid="row-write-stale">
              {relationName(relation)} changed since this was declared{fresh === null || typeof fresh === 'string' ? '' : ` (it would now be ${rowWriteLine(fresh)}, keyed on ${fresh.key.join(', ')})`}. Declare it again to grant it.
            </p>
          )}
          {write === null ? (
            <div className="wk-src-row-btns">
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="row-write-declare" disabled={typeof draft === 'string'} onClick={declare}>Declare</button>
              <span className="wk-src-cap">Declaring grants nothing.</span>
            </div>
          ) : (
            <div className="wk-src-row-btns">
              {stale && <button type="button" className="wk-btn wk-btn--secondary" data-testid="row-write-redeclare" disabled={busy} onClick={() => { gen.current++; setWrite(null); setGate(null); setOutcome(null); setError(null); }}>Declare again</button>}
              <button type="button" className="wk-btn wk-btn--primary" data-testid="row-write-grant" disabled={busy || stale} onClick={() => void grant()}>{busy ? 'Checking…' : gate === null ? 'Grant' : 'Check again and grant'}</button>
              <span className="wk-src-cap">Declared. Granting checks Allow writes, the table and this login first.</span>
            </div>
          )}

          {gate?.step === 'writes-off' && (
            <div className="wk-src-refusal" role="alert" data-testid="row-write-refused" data-why="writes-off">
              <p className="wk-src-strong">Can’t grant: Allow writes is off for {gate.source}.</p>
              <p className="wk-src-note">While it is off, no row write on this source can be granted, prepared or run. Turn it on to grant this one; nothing changes until you do, and every run still asks.</p>
              <AllowWritesSwitch
                source={source.name}
                login={source.sql?.user ?? null}
                allowWrites={source.allowWrites === true}
                saved
                privileges={privileges}
                onChanged={(allowed) => { onAllowWrites(allowed); if (allowed) setGate(null); }}
                data-testid="row-write-allow-writes"
              />
            </div>
          )}
          {gate?.step === 'unsafe' && (
            <div className="wk-src-refusal" role="alert" data-testid="row-write-refused" data-why="unsafe">
              <p className="wk-src-strong">Can’t grant: {gate.table} doesn’t pass the table safety check.</p>
              <ul className="wk-src-reasons">
                {gate.reasons.map((r, i) => <li key={`${r.code}-${i}`} data-code={r.code} data-testid="row-write-reason"><CodeWords words={r.detail} /></li>)}
              </ul>
              <p className="wk-src-note">Nothing was granted. A v1 row write changes exactly one row of one plain table and nothing else.</p>
            </div>
          )}
          {gate?.step === 'missing-grants' && (
            <div className="wk-src-refusal" role="alert" data-testid="row-write-refused" data-why="missing-grants">
              <p className="wk-src-strong">Can’t grant yet: {source.sql?.user ?? 'this login'} needs these privileges for it.</p>
              <pre className="wk-src-pre" data-testid="row-write-missing">{gate.missing.join('\n')}</pre>
              <p className="wk-src-note">Run them as the table’s owner, then check again. Nothing was granted.</p>
            </div>
          )}
          {gate?.step === 'ready' && outcome !== null && (
            <div className={outcome.granted ? 'wk-src-okbox' : 'wk-src-box'} data-testid="row-write-outcome" data-granted={outcome.granted ? 'yes' : 'no'}>
              <p>{outcome.words}</p>
              <p className="wk-src-cap">Safety fingerprint <code className="wk-src-mono">{gate.fingerprint.slice(0, 12)}</code> · checked just now</p>
            </div>
          )}
          {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail" data-testid="row-write-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
