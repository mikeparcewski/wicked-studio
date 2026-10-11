import { useId } from 'react';

/** On/off with its label beside it (design/UI-CONTRACT.md §4.2; audit rows 31, 54). role="switch"; Space toggles. */
export function Switch({ label, checked, onChange, disabled = null, hint, 'data-testid': testId }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: string | null; hint?: string; 'data-testid'?: string;
}): React.ReactElement {
  const id = useId();
  return (
    <div className="wk-switch-field">
      <button
        id={id} type="button" role="switch" aria-checked={checked} disabled={disabled !== null}
        {...(testId !== undefined ? { 'data-testid': testId } : {})}
        {...(hint !== undefined || disabled !== null ? { 'aria-describedby': `${id}-note` } : {})}
        className="wk-switch" onClick={() => onChange(!checked)}
      >
        <span aria-hidden className="wk-switch-track"><span className="wk-switch-thumb" /></span>
        <span className="wk-switch-label">{label}</span>
      </button>
      {(disabled !== null || hint !== undefined) && <p id={`${id}-note`} className="wk-field-note">{disabled ?? hint}</p>}
    </div>
  );
}
