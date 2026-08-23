import { useMemo, useState } from 'react';
import {
  listShortcuts,
  useGlobalShortcuts,
  type ShortcutChord,
  type ShortcutEntry,
  type ShortcutGroup,
} from '../hooks/useGlobalShortcuts.js';
import { useLayerStore } from '../store/layers.js';

/**
 * The global '?' shortcut overlay (DES-UX-001 §7.7, EC42): '?' opens it on
 * every route, and its corpus is `listShortcuts()` — the slice-G registry's
 * OWN registrations at open time, grouped by each entry's declared section —
 * so it can never drift from what the keys actually do, and a key that only
 * exists on some surface (the triage cursor) is documented exactly where it
 * works. Escape closes it first in the §7.7 chain (every other Escape entry
 * yields while it is up, via `useLayerStore.shortcutOverlayOpen`).
 */

const GROUP_ORDER: readonly ShortcutGroup[] = ['triage', 'gates', 'palette', 'panels'];
const GROUP_LABEL: Record<ShortcutGroup, string> = {
  triage: 'Triage',
  gates: 'Gates',
  palette: 'Palette',
  panels: 'Panels & layers',
};

const KEY_LABEL: Record<string, string> = {
  ' ': 'Space',
  arrowdown: '↓',
  arrowup: '↑',
  escape: 'Esc',
  enter: 'Enter',
};

export function chordLabel(chord: ShortcutChord): string {
  const parts: string[] = [];
  if (chord.ctrlOrMeta) parts.push('Ctrl/⌘');
  if (chord.shift) parts.push('Shift');
  const base = KEY_LABEL[chord.key] ?? chord.key.toUpperCase();
  // '?' already spells its shift — "Shift+?" would document a chord nobody types.
  parts.push(base);
  return (chord.key === '?' ? [base] : parts).join('+');
}

interface Row {
  description: string;
  keys: string[];
}

/** Fold the registry snapshot into overlay rows: same group + description = one
 *  row listing every chord (j and ↓ are one action, not two). */
export function overlayRows(
  entries: readonly ShortcutEntry[],
): Array<{ group: ShortcutGroup; rows: Row[] }> {
  const byGroup = new Map<ShortcutGroup, Row[]>();
  for (const e of entries) {
    const group: ShortcutGroup = e.group ?? 'panels';
    const rows = byGroup.get(group) ?? [];
    if (rows.length === 0) byGroup.set(group, rows);
    const label = chordLabel(e.chord);
    const existing = rows.find((r) => r.description === e.description);
    if (existing) {
      if (!existing.keys.includes(label)) existing.keys.push(label);
    } else {
      rows.push({ description: e.description, keys: [label] });
    }
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, rows: byGroup.get(g)! }));
}

export function ShortcutOverlay(): React.ReactElement | null {
  const open = useLayerStore((s) => s.shortcutOverlayOpen);
  const setOpen = useLayerStore((s) => s.setShortcutOverlayOpen);
  // Snapshot the registry AT OPEN — the overlay documents what is registered
  // now, and its own entries below are part of that truth.
  const [snapshot, setSnapshot] = useState<readonly ShortcutEntry[]>([]);

  const entries = useMemo<ShortcutEntry[]>(() => {
    const toggle = (e: KeyboardEvent): void => {
      e.preventDefault();
      const next = !useLayerStore.getState().shortcutOverlayOpen;
      if (next) setSnapshot(listShortcuts());
      useLayerStore.getState().setShortcutOverlayOpen(next);
    };
    return [
      // Both spellings: layouts that report '?' with shiftKey and those that
      // don't each match exactly one entry (chordMatches is shift-strict).
      { id: 'help-overlay', chord: { key: '?', shift: true }, group: 'panels', description: 'Keyboard shortcuts (this overlay)', handler: toggle },
      { id: 'help-overlay-noshift', chord: { key: '?' }, group: 'panels', description: 'Keyboard shortcuts (this overlay)', handler: toggle },
      {
        id: 'help-overlay-close',
        chord: { key: 'escape' },
        group: 'panels',
        description: 'Close the topmost layer',
        // First rung of the §7.7 chain — no other guard: while open, the
        // overlay owns Escape (every later entry yields on this same store).
        guard: () => useLayerStore.getState().shortcutOverlayOpen,
        handler: () => useLayerStore.getState().setShortcutOverlayOpen(false),
      },
    ];
  }, []);
  useGlobalShortcuts(entries);

  if (!open) return null;
  const groups = overlayRows(snapshot);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'var(--scrim)', paddingTop: '10vh' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        data-testid="shortcut-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="flex flex-col overflow-y-auto"
        style={{
          width: 640,
          maxHeight: '75vh',
          background: 'var(--surface-overlay)',
          boxShadow: 'var(--shadow-overlay)',
          borderRadius: 'var(--radius-xl)',
          padding: '20px 24px',
        }}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold font-mono" style={{ color: 'var(--ink-high)' }}>
            Keyboard shortcuts
          </h2>
          <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
            what's registered on this surface · ? or Esc closes
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {groups.map(({ group, rows }) => (
            <section key={group} data-testid={`shortcut-group-${group}`}>
              <h3
                className="text-[10px] font-mono uppercase tracking-widest mb-1.5"
                style={{ color: 'var(--ink-dim)' }}
              >
                {GROUP_LABEL[group]}
              </h3>
              <ul className="flex flex-col gap-1 m-0 p-0" style={{ listStyle: 'none' }}>
                {rows.map((row) => (
                  <li key={row.description} className="flex items-center justify-between gap-3">
                    <span className="text-xs font-mono" style={{ color: 'var(--ink-body)' }}>
                      {row.description}
                    </span>
                    <span className="flex gap-1 shrink-0">
                      {row.keys.map((k) => (
                        <kbd
                          key={k}
                          className="text-[10px] font-mono rounded px-1.5 py-0.5"
                          style={{
                            background: 'var(--surface-raised)',
                            color: 'var(--ink-high)',
                            border: '1px solid var(--surface-raised)',
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
