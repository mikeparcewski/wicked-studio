import { useId, useMemo, useRef, useState } from 'react';

export interface ComboOption<T> { value: T; label: string; detail?: string }

/**
 * A searchable single-choice picker (design/UI-CONTRACT.md §4.2): an ARIA combobox — type to filter,
 * arrows move, Enter picks, Escape restores the chosen label; focus stays in the input. For 2-12
 * fixed options use a styled `<select className="wk-field">` instead. `disabled` and `invalid` are
 * reasons, shown under the field and wired with aria-describedby.
 */
export function Combobox<T>({ label, value, options, onChange, placeholder, disabled = null, invalid = null, 'data-testid': testId = 'combobox' }: {
  label: string; value: T | null; options: readonly ComboOption<T>[]; onChange: (v: T) => void;
  placeholder?: string; disabled?: string | null; invalid?: string | null; 'data-testid'?: string;
}): React.ReactElement {
  const id = useId();
  const chosen = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const shown = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    return q === '' ? options : options.filter((o) => o.label.toLowerCase().includes(q) || (o.detail ?? '').toLowerCase().includes(q));
  }, [options, query]);
  const pick = (o: ComboOption<T>): void => { onChange(o.value); setQuery(null); setOpen(false); };
  const note = disabled ?? invalid;
  return (
    <div className="wk-combo" data-testid={testId}>
      <label htmlFor={id} className="wk-field-label">{label}</label>
      <input
        id={id} ref={input} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        {...(open && shown[cursor] !== undefined ? { 'aria-activedescendant': `${id}-opt-${cursor}` } : {})}
        {...(note !== null ? { 'aria-describedby': `${id}-note` } : {})}
        aria-invalid={invalid !== null} disabled={disabled !== null}
        className="wk-field wk-combo-input" placeholder={placeholder ?? 'Type to search'}
        value={query ?? chosen?.label ?? ''}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => { setOpen(false); setQuery(null); }, 120); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setCursor(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          if (e.key === 'Enter' && open && shown[cursor] !== undefined) { e.preventDefault(); pick(shown[cursor]!); }
          if (e.key === 'Escape') { setQuery(null); setOpen(false); }
        }}
        data-testid={`${testId}-input`}
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="wk-menu wk-combo-list">
          {shown.length === 0 && <li className="wk-menu-item-note" role="presentation">No match</li>}
          {shown.map((o, i) => (
            <li key={`${o.label}-${i}`} id={`${id}-opt-${i}`} role="option" aria-selected={o.value === value}
              className={`wk-menu-item${i === cursor ? ' wk-menu-item--active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              <span>{o.label}</span>{o.detail !== undefined && <span className="wk-menu-item-note">{o.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {note !== null && <p id={`${id}-note`} className={`wk-field-note${invalid !== null ? ' wk-field-note--bad' : ''}`}>{note}</p>}
    </div>
  );
}
