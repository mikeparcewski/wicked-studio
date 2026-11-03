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
 * set, never the secret.
 */
export const SecretField = forwardRef<SecretHandle, {
  label: string;
  note: string;
  onEdit: (hasValue: boolean) => void;
  disabled?: boolean;
  /** Saved mode: crew's `authState` (`set` / `missing` / `none`) instead of a field. */
  savedState?: 'set' | 'missing' | 'none' | null;
  'data-testid'?: string;
}>(function SecretField({ label, note, onEdit, disabled = false, savedState = null, 'data-testid': testId = 'source-secret' }, ref) {
  const input = useRef<HTMLInputElement | null>(null);
  const id = useId();
  useImperativeHandle(ref, () => ({
    read: () => input.current?.value ?? '',
    has: () => (input.current?.value ?? '') !== '',
    clear: () => { if (input.current !== null) input.current.value = ''; },
  }), []);
  if (savedState !== null) {
    const words = savedState === 'set' ? 'Set · kept in your keychain' : savedState === 'missing' ? 'Missing: the keychain has no entry for it' : 'None';
    return (
      <div className="wk-src-field">
        <span className="wk-src-label">{label}</span>
        <span data-testid={`${testId}-state`} data-state={savedState} className={`wk-src-input wk-src-input--static${savedState === 'missing' ? ' wk-src-tone-warn' : ''}`}>{words}</span>
        <span className="wk-src-note">{note}</span>
      </div>
    );
  }
  return (
    <div className="wk-src-field">
      <label htmlFor={id} className="wk-src-label">{label}</label>
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
      <span className="wk-src-note">{note}</span>
    </div>
  );
});
