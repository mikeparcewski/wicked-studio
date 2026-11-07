import { useEffect, useRef, useState } from 'react';
import { readEditorGrants, setEditorGrant, type EditorGrantsResponse, type EditorView } from '../../api/editors.js';
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

/** The permissions still waiting for the person (asked, not allowed): the "May do" line leaves them out. */
export function askingOf(decided: Pick<EditorGrantsResponse, 'grants'> | null): ReadonlySet<string> {
  return new Set((decided?.grants ?? []).filter((g) => g.decision !== 'allow').map((g) => g.permission));
}

type Load = { state: 'loading' } | { state: 'ready'; decided: EditorGrantsResponse } | { state: 'none' } | { state: 'error'; error: string };

/** The editor's decided set, re-read when the editor (or its build) changes. No editor (a run plugin's card) = none. */
export function useEditorGrants(e: Pick<EditorView, 'id' | 'sha256'> | undefined): { load: Load; set: (d: EditorGrantsResponse) => void } {
  const id = e?.id ?? null;
  const sha = e?.sha256 ?? null;
  const [load, setLoad] = useState<Load>(id === null ? { state: 'none' } : { state: 'loading' });
  useEffect(() => {
    if (id === null) { setLoad({ state: 'none' }); return undefined; }
    let live = true;
    setLoad({ state: 'loading' });
    readEditorGrants(id)
      .then((d) => { if (live) setLoad(d === null || !Array.isArray(d.grants) ? { state: 'none' } : { state: 'ready', decided: d }); })
      .catch((err: unknown) => { if (live) setLoad({ state: 'error', error: err instanceof Error ? err.message : String(err) }); });
    return () => { live = false; };
  }, [id, sha]);
  return { load, set: (d) => setLoad({ state: 'ready', decided: d }) };
}

export function EditorGrantSwitches({ editor, title, grants, focus }: {
  editor: Pick<EditorView, 'id' | 'sha256'>;
  title: string;
  grants: ReturnType<typeof useEditorGrants>;
  /** The permission a host note's "Allow it" link pointed at: its switch takes the keyboard once it shows. */
  focus: string | null;
}): React.ReactElement | null {
  const { load, set } = grants;
  // A press belongs to the editor it was made on: switching to another card drops the old one's state.
  const [busy, setBusy] = useState<{ id: string; permission: string } | null>(null);
  const [error, setError] = useState<{ id: string; permission: string; text: string } | null>(null);
  const focused = useRef<string | null>(null);
  const rows = load.state === 'ready' ? grantRows(load.decided) : [];
  useEffect(() => {
    if (focus === null || load.state !== 'ready') return;
    const key = `${editor.id}:${focus}`;
    if (focused.current === key) return;
    const el = document.querySelector<HTMLElement>(`[data-testid="plugin-grant-switch"][data-permission="${CSS.escape(focus)}"]`);
    if (el === null) return;
    focused.current = key;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }, [focus, load.state, editor.id]);
  if (load.state === 'none') return null;
  if (load.state === 'ready' && rows.length === 0) return null;
  const press = (permission: string, allow: boolean): void => {
    if (load.state !== 'ready') return;
    const id = editor.id;
    const shown = { version: load.decided.version, sha256: load.decided.sha256 };
    setBusy({ id, permission });
    setError(null);
    setEditorGrant(id, permission, allow, shown)
      .then((d) => { if (d.editorId === id) set(d); })
      .catch((err: unknown) => setError({ id, permission, text: err instanceof Error ? err.message : String(err) }))
      .finally(() => setBusy((b) => (b?.id === id && b.permission === permission ? null : b)));
  };
  return (
    <section className="wk-plugdetail-sec" data-testid="plugin-details-grants" data-editor={editor.id}>
      <h3>Asks for</h3>
      {load.state === 'loading' && <p className="wk-plugdetail-muted" data-testid="plugin-grants-loading">Reading what it may do…</p>}
      {load.state === 'error' && <p role="alert" className="wk-plugdetail-bad" data-testid="plugin-grants-error">Could not read what it may do: {load.error}</p>}
      {rows.map((r) => {
        const label = grantLabel(r.permission);
        const mine = error !== null && error.id === editor.id && error.permission === r.permission ? error.text : null;
        if (r.state === 'denied') {
          return (
            <div key={r.permission} className="wk-plugdetail-switch" data-testid="plugin-grant-row" data-permission={r.permission} data-state="denied">
              <span><b>{label}</b><br /><span className="wk-plugdetail-muted">Not allowed{r.rules.length > 0 ? ` by the ${r.rules.join(', ')} rule` : ''}. A rule decides this, not this switch.</span></span>
            </div>
          );
        }
        const on = r.state === 'on';
        const pressing = busy !== null && busy.id === editor.id && busy.permission === r.permission;
        return (
          <div key={r.permission} style={{ marginBottom: 6 }}>
            <div className="wk-plugdetail-switch" data-testid="plugin-grant-row" data-permission={r.permission} data-state={r.state}>
              <span>
                <b>{label}</b><br />
                <span className="wk-plugdetail-muted">{on ? 'Allowed by you for this version. ' : 'Off: it asks. '}Takes effect where it opens next. Only you can change this.</span>
              </span>
              <button type="button" role="switch" aria-checked={on} data-testid="plugin-grant-switch" data-permission={r.permission} disabled={pressing}
                aria-label={`${title}: ${label.toLowerCase()}, ${on ? 'allowed' : 'off'}`} className="wk-switch" onClick={() => press(r.permission, !on)}>
                <span aria-hidden className="wk-switch-track"><span className="wk-switch-thumb" /></span>
              </button>
            </div>
            {mine !== null && <p role="alert" data-testid="plugin-grant-error" className="wk-plugdetail-bad">Not changed: {mine}</p>}
          </div>
        );
      })}
    </section>
  );
}
