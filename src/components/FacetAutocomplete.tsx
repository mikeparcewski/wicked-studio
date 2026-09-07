import { useMemo, useRef, useState } from 'react';

/**
 * A reusable facet FILTER as a text input with `key=value` autocomplete (the user's ask:
 * "tags filter to textbox autocomplete"). The chip-strip facet filters it replaces grew a chip per
 * distinct pair — unbounded and unscannable once a store carries dozens of facets; a typeahead
 * stays one line and narrows as you type.
 *
 * There is NO facet-vocabulary endpoint: the caller derives the `options` (`key=value` strings)
 * from the loaded rows and passes them in (exactly the `facetPairs` derivation MemoriesPanel
 * already did client-side). This component owns only the typeahead UX — the applied facet is
 * lifted state (`value` / `onChange`), so a page keeps filtering its own rows unchanged.
 *
 * Single-select: picking an option REPLACES the applied facet; the × (or picking nothing) clears
 * it. `value === null` is the unfiltered "all" view.
 */

export function FacetAutocomplete({
  testId,
  options,
  value,
  onChange,
  placeholder = 'Filter by facet (key=value)…',
  label = 'Filter by facet',
}: {
  /** The wrapper's data-testid; the input/options/clear derive theirs from it. */
  testId: string;
  /** The facet vocabulary — `key=value` pairs the loaded rows carry (caller-derived). */
  options: readonly string[];
  /** The applied facet (`key=value`), or null for the unfiltered view. */
  value: string | null;
  /** Apply a facet (a pair) or clear it (null). */
  onChange: (facet: string | null) => void;
  placeholder?: string;
  label?: string;
}): React.ReactElement {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The options that match the typed text (case-insensitive substring); empty text shows all. */
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const pool = q === '' ? options : options.filter((o) => o.toLowerCase().includes(q));
    // Cap the rendered list so a huge vocabulary never blows out the dropdown.
    return pool.slice(0, 50);
  }, [options, text]);

  const apply = (pair: string): void => {
    onChange(pair);
    setText('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[highlight] ?? matches[0];
      if (pick !== undefined) apply(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div
      data-testid={testId}
      data-facet-active={value ?? ''}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label={label}
      className="relative flex flex-wrap items-center gap-1.5"
    >
      {value !== null && (
        <span
          data-testid={`${testId}-active`}
          data-facet={value}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-mono"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)', border: '1px solid var(--surface-raised)' }}
        >
          {value}
          <button
            type="button"
            data-testid={`${testId}-clear`}
            aria-label={`Clear facet ${value}`}
            onClick={() => onChange(null)}
            className="rounded px-1 leading-none hover:opacity-70 focus:outline-none focus-visible:ring-1"
            style={{ color: 'var(--ink-dim)' }}
          >
            ×
          </button>
        </span>
      )}
      <input
        data-testid={`${testId}-input`}
        type="text"
        role="searchbox"
        spellCheck={false}
        value={text}
        placeholder={value === null ? placeholder : 'Change facet…'}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { if (blurTimer.current !== null) clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={onKeyDown}
        className="min-w-[12rem] flex-1 rounded px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-1"
        style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
      />
      {open && matches.length > 0 && (
        <ul
          data-testid={`${testId}-options`}
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full min-w-[14rem] overflow-y-auto rounded py-1 shadow-lg"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
        >
          {matches.map((pair, i) => (
            <li key={pair} role="option" aria-selected={value === pair}>
              <button
                type="button"
                data-testid={`${testId}-option`}
                data-facet={pair}
                data-active={value === pair}
                // onMouseDown (not onClick) so the pick lands before the input's blur closes the list.
                onMouseDown={(e) => { e.preventDefault(); apply(pair); }}
                onMouseEnter={() => setHighlight(i)}
                className="w-full px-2 py-1 text-left text-[11px] font-mono transition-colors"
                style={{
                  background: i === highlight ? 'var(--surface-raised)' : 'transparent',
                  color: value === pair ? 'var(--ink-high)' : 'var(--ink-muted)',
                }}
              >
                {pair}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
