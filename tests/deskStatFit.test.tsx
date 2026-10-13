import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Wallet } from 'lucide-react';
import { DeskStat } from '../src/components/desk/DeskParts.js';

// jsdom has no layout: the tile's widths are stubbed per test.
function stubWidths(client: number, scroll: number, fontPx = 48): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(client);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scroll);
  const real = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, p) => {
    const cs = real(el, p);
    return new Proxy(cs, { get: (t, k) => (k === 'fontSize' ? ((el as HTMLElement).style.fontSize || `${fontPx}px`) : Reflect.get(t, k)) });
  });
}
const valueOf = (): HTMLElement => screen.getByTestId('t').querySelector('.wk-stat-value') as HTMLElement;

describe('Desk stat tile: the number fits its tile (shots r10: Report Spend read "$1.…")', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('shrinks a number wider than its tile just enough to show it whole', () => {
    stubWidths(115, 130);
    render(<DeskStat icon={Wallet} tone="accent" label="Spend" value="$1.39" note="last 30 days" testId="t" />);
    expect(valueOf().style.fontSize).toBe('42.4px'); // 48 * 115/130, rounded down
  });

  it('leaves a number that fits at the stylesheet size', () => {
    stubWidths(115, 100);
    render(<DeskStat icon={Wallet} tone="accent" label="Jobs" value="3" note="n" testId="t" />);
    expect(valueOf().style.fontSize).toBe('');
  });

  it('never shrinks below the floor (the ellipsis is the last resort)', () => {
    stubWidths(100, 900);
    render(<DeskStat icon={Wallet} tone="accent" label="Spend" value="at least $12,345.67" note="n" testId="t" />);
    expect(valueOf().style.fontSize).toBe('18px');
  });

  it('a value still being read is not measured', () => {
    stubWidths(115, 130);
    render(<DeskStat icon={Wallet} tone="accent" label="Spend" value={null} note="n" testId="t" />);
    expect(valueOf().style.fontSize).toBe('');
  });
});
