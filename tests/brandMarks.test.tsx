/**
 * fonts-v3 (the operator's pick 2026-11-02): the shell's brand is the Shoreline mark beside the Wave W lettering,
 * drawn from the vendored design package, the favicon is the Shoreline mark, and the text face is Wicked Sans A.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { BRAND_BOX, BRAND_CAP_PX, ShorelineMark, StudioLettering, StudioLockup } from '../src/components/ui/BrandMarks.js';
import { TopBar } from '../src/components/ui/TopBar.js';

const BRAND = join(process.cwd(), 'src', 'vendor', 'wicked-design', 'brand');
const viewBox = (f: string) => /viewBox="([^"]+)"/u.exec(readFileSync(join(BRAND, f), 'utf8'))![1]!.split(' ').map(Number);

describe('the brand marks', () => {
  it('the boxes match the vendored artwork (cap 100 units in a 200-unit box)', () => {
    expect(viewBox('wicked-studio-wordmark-small.svg').slice(2)).toEqual([BRAND_BOX.lockup, BRAND_BOX.height]);
    expect(viewBox('wicked-studio-lettering-small.svg').slice(2)).toEqual([BRAND_BOX.lettering, BRAND_BOX.height]);
    expect(viewBox('shoreline.svg')).toEqual([0, 0, 32, 32]);
    // the lockup is drawn in currentColor, so the mask takes the ink: no fixed colour in the artwork
    expect(readFileSync(join(BRAND, 'wicked-studio-wordmark-small.svg'), 'utf8')).not.toMatch(/#[0-9a-f]{3,6}\b/iu);
  });

  it('the lockup and the lettering are named images at the sidebar size; the mark alone is decoration', () => {
    render(<><StudioLockup /><StudioLettering /><ShorelineMark /></>);
    const lockup = screen.getByTestId('brand-lockup');
    expect(lockup).toHaveAttribute('role', 'img');
    expect(lockup).toHaveAccessibleName('Wicked Studio');
    expect(lockup.style.height).toBe(`${Math.round(BRAND_BOX.height * BRAND_CAP_PX / 10) / 10}px`);
    expect(lockup.style.width).toBe(`${Math.round(BRAND_BOX.lockup * BRAND_CAP_PX / 10) / 10}px`);
    expect(lockup.className).toBe('wk-brand-svg');
    expect(lockup.style.maskImage).toContain('wicked-studio-wordmark-small.svg');
    expect(screen.getByTestId('brand-lettering')).toHaveAccessibleName('Wicked Studio');
    expect(screen.getByTestId('brand-mark')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the phone top bar carries the lockup in place of the dot and the serif name', () => {
    render(<TopBar onMenu={() => {}} menuOpen={false} badge={null} />);
    const bar = screen.getByTestId('phone-topbar');
    expect(bar).toContainElement(screen.getByTestId('topbar-lockup'));
    expect(bar.querySelector('.wk-desk-dot, .wk-wordmark')).toBeNull();
  });

  it('the favicon is the vendored Shoreline mark', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/src/vendor/wicked-design/brand/favicon.svg" />');
    expect(readFileSync(join(BRAND, 'favicon.svg'), 'utf8')).toMatch(/prefers-color-scheme:dark/u);
  });
});
