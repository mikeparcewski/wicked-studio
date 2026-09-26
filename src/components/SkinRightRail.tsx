import { useSkinSlots } from '../store/skinSlots.js';
import { RIGHT_RAIL_PX } from '../theming/skins.js';

/**
 * The shell's right rail (skin shell `right-rail`): a full-height column at the right edge
 * that surfaces dock into by variant — today the Needs-you queue (`needsQueue: 'rail'`), which
 * the shell mounts here on EVERY route (its rows come from the app-level fold, `useNeedsRows`).
 * It owns no behaviour; it is a region. It still registers itself in the skin-slot store, so a
 * surface that would otherwise render the same behaviour in place (Home's inline queue) stands
 * down while the region is mounted.
 */
export function SkinRightRail({ children }: { children?: React.ReactNode }): React.ReactElement {
  const setRightRail = useSkinSlots((s) => s.setRightRail);
  return (
    <aside
      ref={setRightRail}
      data-testid="skin-right-rail"
      aria-label="Right rail"
      style={{
        width: `${RIGHT_RAIL_PX}px`, flexShrink: 0, display: 'flex', flexDirection: 'column',
        minHeight: 0, overflow: 'hidden', padding: 'var(--space-3)',
        background: 'var(--surface-rail)', borderLeft: '1px solid var(--surface-raised)',
      }}
    >
      {children}
    </aside>
  );
}
