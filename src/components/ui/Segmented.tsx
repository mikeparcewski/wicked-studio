import { useRef } from 'react';

/** One-of-few choices, every option boxed, the selected one filled (design/UI-CONTRACT.md §4.2; audit rows 53, 58). */
export function Segmented<T extends string>({ label, value, options, onChange, 'data-testid': testId }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; 'data-testid'?: string;
}): React.ReactElement {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, step: number): void => {
    const n = options.length; const to = (from + step + n) % n;
    onChange(options[to]!.value); refs.current[to]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="wk-segmented" {...(testId !== undefined ? { 'data-testid': testId } : {})}>
      {options.map((o, i) => (
        <button
          key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1} data-value={o.value} className="wk-segmented-option"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}
