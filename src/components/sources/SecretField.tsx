import { forwardRef, useId, useImperativeHandle, useRef } from 'react';

/** What the sheet may do with the secret: read it at the send, ask whether one is typed, clear it. */
export interface SecretHandle {
  /** The typed value, for the one request that carries it (the preview). */
  read(): string;
  has(): boolean;
  clear(): void;
}

/**
 * THE SECRET FIELD (DES-APPS-001 §5.2: "The person types a password once into studio's own sheet, which
 * sends it to crew's keychain write and keeps nothing").
 *
 * Deliberately UNCONTROLLED: a controlled React input copies its value into the `value` ATTRIBUTE, so the
 * secret would sit in the DOM (`outerHTML`, a DOM snapshot, an extension reading attributes). Here it
 * lives only in the input node's own value. It never enters React state, a key, a URL, storage or a log:
 * the parent learns only THAT it changed (`onEdit(hasValue)`), reads it at the send through the handle,
 * and clears it once the save has written it to the keychain. A saved source shows whether a secret is
 * set, never the secret; with `rekey`, the same uncontrolled field comes back (at once when it is missing, behind
 * "Replace" when it is set) so the person can type it again, and the parent clears it once crew wrote it.
 */
export const SecretField = forwardRef<SecretHandle, {
  label: string;
  note: string;
  onEdit: (hasValue: boolean) => void;
  disabled?: boolean;
  /** Saved mode: crew's `authState` (`set` / `missing` / `none`) instead of a field. */
  savedState?: 'set' | 'missing' | 'none' | null;
  /**
   * Saved mode, RE-KEY: the field comes back so the person can type the secret again (crew's
   * `PUT /mcp/servers/:name/secret`, which the parent sends with the value read through the handle). A MISSING secret
   * shows the field at once; a SET one offers `replace` (its button's words), and `open`/`onOpen` say whether the
   * person opened it. Without it the saved field only says the state (a source with no secret has nothing to re-key).
   */
  rekey?: { open: boolean; onOpen: (open: boolean) => void; replace: string; note: string } | null;
  'data-testid'?: string;
}>(function SecretField({ label, note, onEdit, disabled = false, savedState = null, rekey = null, 'data-testid': testId = 'source-secret' }, ref) {
  const input = useRef<HTMLInputElement | null>(null);
  const id = useId();
  useImperativeHandle(ref, () => ({
    read: () => input.current?.value ?? '',
    has: () => (input.current?.value ?? '') !== '',
    clear: () => { if (input.current !== null) input.current.value = ''; },
  }), []);
  const field = (
    <input
      ref={input}
      id={id}
      data-testid={testId}
      type="password"
      // `new-password`: the browser offers none of the person's saved passwords for this field and
      // does not autofill one into it.
      autoComplete="new-password"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      disabled={disabled}
      className="wk-field wk-src-input wk-src-secret"
      onInput={(e) => onEdit((e.currentTarget.value ?? '') !== '')}
    />
  );
  if (savedState !== null) {
    const words = savedState === 'set' ? 'Set · kept in your keychain' : savedState === 'missing' ? 'Missing: the keychain has no entry for it' : 'None';
    // Only a secret crew references can be written again: `none` has no keychain entry to re-key.
    const canRekey = rekey !== null && savedState !== 'none';
    const open = canRekey && (savedState === 'missing' || rekey.open);
    const close = (): void => {
      // The node goes with the field; the parent learns that nothing is typed any more.
      if (input.current !== null) input.current.value = '';
      onEdit(false);
      rekey?.onOpen(false);
    };
    return (
      <div className="wk-src-field" data-testid={`${testId}-saved`} data-rekey={open ? 'open' : canRekey ? 'offered' : 'none'}>
        {open ? <label htmlFor={id} className="wk-src-label">{label}</label> : <span className="wk-src-label">{label}</span>}
        <span className="wk-src-rekey-row">
          <span data-testid={`${testId}-state`} data-state={savedState} className={`wk-src-input wk-src-input--static${savedState === 'missing' ? ' wk-src-tone-warn' : ''}`}>{words}</span>
          {canRekey && savedState === 'set' && !open && (
            <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid={`${testId}-replace`} disabled={disabled} onClick={() => rekey.onOpen(true)}>{rekey.replace}</button>
          )}
          {canRekey && savedState === 'set' && open && (
            <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid={`${testId}-replace-cancel`} disabled={disabled} onClick={close}>Keep the saved one</button>
          )}
        </span>
        {open && field}
        <span className="wk-src-note">{open ? rekey.note : note}</span>
      </div>
    );
  }
  return (
    <div className="wk-src-field">
      <label htmlFor={id} className="wk-src-label">{label}</label>
      {field}
      <span className="wk-src-note">{note}</span>
    </div>
  );
});
