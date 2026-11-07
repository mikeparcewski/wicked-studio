import { useEffect, useRef, useState } from 'react';
import { readEditorGrants, setEditorGrant, type EditorGrantsResponse, type EditorView } from '../../api/editors.js';
import { ApiError } from '../../api/errors.js';
import { PERMISSION_WORDS } from '../../editors/model.js';
import type { PermissionId } from '../../editors/protocol.js';

/**
 * WHAT AN INSTALLED EDITOR MAY DO, AS SWITCHES (F37; DES-artifact-editor-plugins §6.2, §6.4).
 *
 * A third-party editor's permissions beyond reading start off: crew's engine answers "ask" for them until the person
 * allows them. Each one it asks for gets a switch here; "on" writes this build's allow into crew's approvals ledger
 * (human-only), "off" withdraws it. A new version of the editor asks again. A permission a steering rule denies shows
 * the rule and has no switch; one allowed by default (a built-in editor's) needs none and is not listed. The install
 * consent's own grant (`mcp.session`) is not switched here: installing it again grants it.
 */

/** The switch's label: "Can change documents (you can undo)" for a write, else "Can <what it does>". */
export function grantLabel(permission: string): string {
  if (permission === 'artifact.write') return 'Can change documents (you can undo)';
  const words = PERMISSION_WORDS[permission as PermissionId];
  return words !== undefined ? `Can ${words}` : permission;
}

export type GrantRow =
  | { permission: string; state: 'on' | 'off' }
  | { permission: string; state: 'denied'; rules: string[] };

/** The rows a decided set gives: every permission the person can switch (asked, or allowed by their own switch) and
 *  every one a rule denies. `artifact.write` first: it is the one a person most often needs. */
export function grantRows(decided: Pick<EditorGrantsResponse, 'grants'>): GrantRow[] {
  const rows: GrantRow[] = [];
  for (const g of decided.grants) {
    if (g.permission === 'mcp.session') continue;
    if (g.decision === 'deny') rows.push({ permission: g.permission, state: 'denied', rules: g.ruleIds ?? [] });
    else if (g.decision === 'ask') rows.push({ permission: g.permission, state: 'off' });
    // Allowed by the person's own switch (the approvals ledger), never by a default: only those can be switched off.
    else if ((g.ruleIds ?? []).includes('EDITOR-GRANTS')) rows.push({ permission: g.permission, state: 'on' });
  }
  return rows.sort((a, b) => Number(b.permission === 'artifact.write') - Number(a.permission === 'artifact.write'));
}

/**
 * What "May do" may claim (codex r1): the permissions crew decided `allow`. Until crew's answer is read, a built-in
 * editor claims its manifest (it ships with studio, with its default set) and an installed one claims nothing: `null`
 * = not known yet. An older service with no grants route grants an installed editor nothing.
 */
export function allowedOf(e: Pick<EditorView, 'first_party' | 'permissions'>, load: Load | { state: 'changed' }): ReadonlySet<string> | null {
  if (load.state === 'ready') return new Set(load.decided.grants.filter((g) => g.decision === 'allow').map((g) => g.permission));
  // Only an older service with no grants route falls back, as the host does: a built-in editor its manifest, an
  // installed one nothing. Loading, a failed read or a changed build is not known (codex r2).
  if (load.state === 'none') return e.first_party ? new Set(e.permissions.map((p) => p.id)) : new Set();
  return null;
}

export type Load = { state: 'loading' } | { state: 'ready'; decided: EditorGrantsResponse } | { state: 'none' } | { state: 'error'; error: string };

type Shown = Pick<EditorView, 'id' | 'version' | 'sha256'>;
type ShownEditor = Shown & Pick<EditorView, 'first_party'>;
const keyOf = (e: Pick<EditorView, 'id' | 'version' | 'sha256'>): string => `${e.id}@${e.version}#${e.sha256}`;

/**
 * The editor's decided set for the build this page SHOWS, re-read when the editor (or its build) changes. Every answer
 * is kept only for the build it is about (codex r1): an answer for another build (an update landed between the list
 * and this read) is "changed", and a late answer for a card no longer open is dropped. No editor = none.
 */
export function useEditorGrants(e: Shown | undefined): { load: Load | { state: 'changed' }; set: (d: EditorGrantsResponse) => void; reload: () => void } {
  const want = e !== undefined ? keyOf(e) : null;
  const wantRef = useRef(want);
  wantRef.current = want;
  const [got, setGot] = useState<{ key: string | null; load: Load | { state: 'changed' } }>({ key: want, load: want === null ? { state: 'none' } : { state: 'loading' } });
  const [attempt, setAttempt] = useState(0);
  const id = e?.id ?? null;
  useEffect(() => {
    if (id === null || want === null) { setGot({ key: want, load: { state: 'none' } }); return undefined; }
    let live = true;
    setGot({ key: want, load: { state: 'loading' } });
    readEditorGrants(id)
      .then((d) => {
        if (!live) return;
        if (d === null || !Array.isArray(d.grants)) setGot({ key: want, load: { state: 'none' } });
        else setGot({ key: want, load: keyOf({ id: d.editorId, version: d.version, sha256: d.sha256 }) === want ? { state: 'ready', decided: d } : { state: 'changed' } });
      })
      .catch((err: unknown) => { if (live) setGot({ key: want, load: { state: 'error', error: err instanceof Error ? err.message : String(err) } }); });
    return () => { live = false; };
  }, [id, want, attempt]);
  const set = (d: EditorGrantsResponse): void => {
    const k = keyOf({ id: d.editorId, version: d.version, sha256: d.sha256 });
    if (k === wantRef.current) setGot({ key: k, load: { state: 'ready', decided: d } });
  };
  // A load kept for another build than the one shown now is still loading for this one.
  return { load: got.key === want ? got.load : { state: 'loading' }, set, reload: () => setAttempt((n) => n + 1) };
}

/**
 * Presses per editor, across remounts of its details (codex r2): one in flight at a time, and only the newest press's
 * answer is shown. A late answer from an earlier visit to the same card never overwrites a newer decision.
 */
const pressing = new Map<string, { seq: number; done: Promise<unknown> }>();
let pressSeq = 0;

/** Whether a failed press is a definite refusal (crew answered and wrote nothing) or an unknown outcome. */
function refused(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500;
}

export function EditorGrantSwitches({ editor, title, grants, focus }: {
  editor: ShownEditor;
  title: string;
  grants: ReturnType<typeof useEditorGrants>;
  /** The permission a host note's "Allow it" link pointed at: its switch takes the keyboard once it shows. */
  focus: string | null;
}): React.ReactElement | null {
  // Keyed by the build (the caller remounts it per editor build), so a press, its error and the focus request all
  // belong to the editor they were made on.
  const { load, set, reload } = grants;
  const [busy, setBusy] = useState<string | null>(() => (pressing.has(editor.id) ? '…' : null));
  const [error, setError] = useState<{ permission: string; text: string } | null>(null);
  // The focus request this mount has fulfilled: a new request (another permission, or the link again) is honoured.
  const focused = useRef<string | null>(null);
  useEffect(() => { if (focus === null) focused.current = null; }, [focus]);
  // A press from an earlier visit still in flight: this mount waits for it, then reads what crew says.
  useEffect(() => {
    const p = pressing.get(editor.id);
    if (p === undefined) return undefined;
    let live = true;
    void p.done.finally(() => { if (live) { setBusy(null); reload(); } });
    return () => { live = false; };
  }, [editor.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = load.state === 'ready' ? grantRows(load.decided) : [];
  useEffect(() => {
    if (focus === null || load.state !== 'ready' || focused.current === focus) return;
    const el = document.querySelector<HTMLElement>(`[data-testid="plugin-grant-switch"][data-editor="${CSS.escape(editor.id)}"][data-permission="${CSS.escape(focus)}"]`);
    if (el === null) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    if (document.activeElement === el) focused.current = focus;
  }, [focus, load.state, editor.id]);
  if (load.state === 'none') return null;
  if (load.state === 'ready' && rows.length === 0) return null;
  // A built-in editor is allowed its set by default: no "Asks for" flashes while its answer is read.
  if (load.state === 'loading' && editor.first_party) return null;
  const press = (permission: string, allow: boolean): void => {
    // One press at a time per editor (codex r1): each answer is the whole decided set, so two in flight could land
    // out of order and show an older one.
    if (load.state !== 'ready' || busy !== null || pressing.has(editor.id)) return;
    const shown = { version: load.decided.version, sha256: load.decided.sha256 };
    const seq = ++pressSeq;
    setBusy(permission);
    setError(null);
    const done = setEditorGrant(editor.id, permission, allow, shown)
      .then((d) => { if (pressing.get(editor.id)?.seq === seq) set(d); })
      .catch((err: unknown) => {
        // crew answered and refused: nothing changed. Anything else (the connection dropped): it may have landed, so
        // what crew decides now is read again rather than guessed (codex r1).
        if (refused(err)) setError({ permission, text: `Not changed: ${err instanceof Error ? err.message : String(err)}` });
        else { setError({ permission, text: 'Could not confirm the change; showing what studio’s service says now.' }); reload(); }
      })
      .finally(() => { if (pressing.get(editor.id)?.seq === seq) pressing.delete(editor.id); setBusy(null); });
    pressing.set(editor.id, { seq, done });
  };
  return (
    <section className="wk-plugdetail-sec" data-testid="plugin-details-grants" data-editor={editor.id}>
      <h3>Asks for</h3>
      {load.state === 'loading' && <p className="wk-plugdetail-muted" data-testid="plugin-grants-loading">Reading what it may do…</p>}
      {load.state === 'changed' && <p role="alert" className="wk-plugdetail-bad" data-testid="plugin-grants-changed">This editor was updated since this page was read. Reload the page to see what the new version asks for.</p>}
      {load.state === 'error' && <p role="alert" className="wk-plugdetail-bad" data-testid="plugin-grants-error">Could not read what it may do: {load.error}</p>}
      {rows.map((r) => {
        const label = grantLabel(r.permission);
        const mine = error !== null && error.permission === r.permission ? error.text : null;
        if (r.state === 'denied') {
          return (
            <div key={r.permission} className="wk-plugdetail-switch" data-testid="plugin-grant-row" data-permission={r.permission} data-state="denied">
              <span><b>{label}</b><br /><span className="wk-plugdetail-muted">Not allowed{r.rules.length > 0 ? ` by the ${r.rules.join(', ')} rule` : ''}. A rule decides this, not this switch.</span></span>
            </div>
          );
        }
        const on = r.state === 'on';
        // aria-disabled, not disabled, while a press is in flight (pi r1): a disabled button drops the keyboard focus.
        return (
          <div key={r.permission} style={{ marginBottom: 6 }}>
            <div className="wk-plugdetail-switch" data-testid="plugin-grant-row" data-permission={r.permission} data-state={r.state}>
              <span>
                <b>{label}</b><br />
                <span className="wk-plugdetail-muted">{on ? 'Allowed by you for this version. ' : 'Off: it asks. '}Takes effect where it opens next. Only you can change this.</span>
              </span>
              <button type="button" role="switch" aria-checked={on} data-testid="plugin-grant-switch" data-editor={editor.id} data-permission={r.permission} aria-disabled={busy !== null}
                aria-label={`${title}: ${label.toLowerCase()}, ${on ? 'allowed' : 'off'}`} className="wk-switch" onClick={() => press(r.permission, !on)}>
                <span aria-hidden className="wk-switch-track"><span className="wk-switch-thumb" /></span>
              </button>
            </div>
            {mine !== null && <p role="alert" data-testid="plugin-grant-error" className="wk-plugdetail-bad">{mine}</p>}
          </div>
        );
      })}
    </section>
  );
}
