import { useRef } from 'react';

/** One-of-few choices, every option boxed, the selected one filled (design/UI-CONTRACT.md §4.2; audit rows 53, 58). */
export function Segmented<T extends string>({ label, value, options, onChange, 'data-testid': testId }: {
  label: string; value: T; options: readonly { value: T; label: string; testId?: string; disabled?: boolean }[]; onChange: (v: T) => void; 'data-testid'?: string;
}): React.ReactElement {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // A disabled option is skipped by the arrows and never holds the tab stop (codex r1 on studio#725).
  const move = (from: number, step: number): void => {
    const n = options.length;
    for (let k = 1; k <= n; k += 1) {
      const to = (from + step * k + n * n) % n;
      if (options[to]?.disabled === true) continue;
      if (to === from) return;
      onChange(options[to]!.value); refs.current[to]?.focus(); return;
    }
  };
  const selected = options.findIndex((o) => o.value === value && o.disabled !== true);
  const tabStop = selected >= 0 ? selected : options.findIndex((o) => o.disabled !== true);
  return (
    <div role="radiogroup" aria-label={label} className="wk-segmented" {...(testId !== undefined ? { 'data-testid': testId } : {})}>
      {options.map((o, i) => (
        <button
          key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o.value === value}
          tabIndex={i === tabStop ? 0 : -1} data-value={o.value} className="wk-segmented-option"
          {...(o.testId !== undefined ? { 'data-testid': o.testId } : {})} disabled={o.disabled === true}
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
