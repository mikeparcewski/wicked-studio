import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModalEscape } from '../src/components/Modal.js';
import { Sheet } from '../src/components/sheets/Sheet.js';

/**
 * S12 (desk_rules step 7 → 8): "look underneath" from a rule's drawer opens a sheet OVER the drawer.
 * Esc is one step at a time (DESIGN-interaction rule 9, DES-STUDIO-REBUILD-001 §5.5): the sheet —
 * the later layer — closes, and the drawer under it stays. Before this, the drawer's modal claimed the
 * press in the capture phase and closed itself (navigating off the rule) while the sheet stayed open.
 */

function Drawer({ onClose }: { onClose: () => void }): React.ReactElement {
  useModalEscape(onClose);
  return <aside data-testid="drawer">a rule</aside>;
}

describe('Esc over a drawer with a sheet open', () => {
  afterEach(cleanup);
  it('closes the sheet (the later layer) and leaves the drawer', () => {
    const drawerClose = vi.fn();
    const sheetClose = vi.fn();
    render(
      <>
        <Drawer onClose={drawerClose} />
        <Sheet title="Build" objectAttr="step:r1:1" tabs={[]} tab="" onTab={() => {}} primary={null} onClose={sheetClose}>
          the step
        </Sheet>
      </>,
    );
    fireEvent.keyDown(screen.getByTestId('sheet'), { key: 'Escape' });
    expect(sheetClose).toHaveBeenCalledTimes(1);
    expect(drawerClose).not.toHaveBeenCalled();
  });
  it('with no sheet, Esc reaches the drawer', () => {
    const drawerClose = vi.fn();
    render(<Drawer onClose={drawerClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(drawerClose).toHaveBeenCalledTimes(1);
  });
});
