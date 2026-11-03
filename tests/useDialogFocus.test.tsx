import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useDialogFocus } from '../src/components/sources/useDialogFocus.js';

/** The sources dialogs keep keyboard focus inside and give it back on close (review r1: codex C9, pi P3). */
afterEach(() => cleanup());

function Dialog(): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true">
      <button type="button">first</button>
      <button type="button" disabled>off</button>
      <button type="button">last</button>
    </div>
  );
}
function Host(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (<><button type="button" onClick={() => setOpen((o) => !o)}>opener</button><button type="button">behind</button>{open && <Dialog />}</>);
}

describe('useDialogFocus', () => {
  it('Tab from the last control wraps to the first, Shift+Tab from the first to the last; close restores the opener', () => {
    render(<Host />);
    const opener = screen.getByText('opener');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    screen.getByText('last').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('first'));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('last'));
    // Focus that got out (a click on the page behind) is brought back in by the next Tab.
    screen.getByText('behind').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('first'));
    fireEvent.click(opener);
    expect(document.activeElement).toBe(opener);
  });
});
