import { useRef } from 'react';
import { usePhone } from '../../hooks/usePhone.js';
import { OverflowMenu } from './OverflowMenu.js';

export interface TabDef { id: string; label: string; count?: number }

/**
 * Tabs that never wrap (design/UI-CONTRACT.md §4.4; audit row 28): up to `maxVisible` tabs in one row
 * (5 desktop, 3 phone), the rest behind a separate "More" menu button. Picking an overflow tab
 * activates it and swaps it into the last visible slot, so the active tab is always in the tablist. Manual activation (click/Enter);
 * arrows/Home/End move focus. Tab id `${idBase}-tab-${id}`, the panel is `${idBase}-panel`.
 */
export function Tabs({ tabs, active, onChange, maxVisible, 'aria-label': ariaLabel, idBase, 'data-testid': testId = 'tabs' }: {
  tabs: readonly TabDef[]; active: string; onChange: (id: string) => void; maxVisible?: number;
  'aria-label': string; idBase: string; 'data-testid'?: string;
}): React.ReactElement {
  const phone = usePhone();
  const cap = Math.max(1, maxVisible ?? (phone ? 3 : 5));
  const fits = tabs.length <= cap;
  // The active tab is always IN the tablist (its id and aria-selected stay in the DOM): an active
  // overflow tab takes the last visible slot, and the tab it displaced goes behind More.
  const head = fits ? [...tabs] : tabs.slice(0, cap);
  const activeIdx = tabs.findIndex((t) => t.id === active);
  const swapped = !fits && activeIdx >= cap;
  const shown = swapped ? [...head.slice(0, cap - 1), tabs[activeIdx]!] : head;
  const rest = fits ? [] : tabs.filter((t) => !shown.includes(t));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusAt = (i: number): void => { const n = shown.length; refs.current[((i % n) + n) % n]?.focus(); };
  const word = (t: TabDef): string => (t.count !== undefined ? `${t.label} (${t.count})` : t.label);
  return (
    <div className="wk-tabs" data-testid={testId}>
      <div role="tablist" aria-label={ariaLabel} className="wk-tabs-list">
        {shown.map((t, i) => (
          <button key={t.id} ref={(el) => { refs.current[i] = el; }} id={`${idBase}-tab-${t.id}`} type="button" role="tab"
            aria-selected={t.id === active} aria-controls={`${idBase}-panel`} tabIndex={t.id === active ? 0 : -1}
            data-tab={t.id} className="wk-tab" onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') { e.preventDefault(); focusAt(i + 1); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); focusAt(i - 1); }
              if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
              if (e.key === 'End') { e.preventDefault(); focusAt(shown.length - 1); }
            }}
          >{word(t)}</button>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="wk-tabs-more">
          <OverflowMenu data-testid={`${testId}-more`} label="More tabs" text="More"
            items={rest.map((t) => ({ id: t.id, label: word(t), onSelect: () => onChange(t.id) }))} />
        </div>
      )}
    </div>
  );
}
