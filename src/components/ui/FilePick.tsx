import { useEffect, useId, useRef } from 'react';

/** A styled file input: a secondary button plus the chosen name (design/UI-CONTRACT.md §4.2; audit row 52). */
export function FilePick({ label, accept, file, onChange, 'data-testid': testId = 'file-pick' }: {
  label: string; accept?: string; file: File | null; onChange: (f: File | null) => void; 'data-testid'?: string;
}): React.ReactElement {
  const id = useId(); const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (file === null && input.current !== null) input.current.value = ''; }, [file]);
  return (
    <div className="wk-filepick" data-testid={testId}>
      <input id={id} ref={input} type="file" tabIndex={-1} aria-label={label} className="wk-visually-hidden" {...(accept !== undefined ? { accept } : {})}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)} data-testid={`${testId}-input`} />
      <button type="button" className="wk-btn wk-btn--secondary" onClick={() => input.current?.click()}>{label}</button>
      <span className="wk-filepick-name" aria-live="polite">{file !== null ? file.name : 'No file chosen yet'}</span>
    </div>
  );
}
