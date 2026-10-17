import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PageFrame } from '../src/components/ui/PageFrame.js';

// The page measure (operator 2026-10-16): every routed page is centred at one of three widths.
describe('PageFrame width', () => {
  it('is the wide measure by default', () => {
    render(<PageFrame title="Skills">body</PageFrame>);
    const frame = screen.getByTestId('page-frame');
    expect(frame).toHaveAttribute('data-width', 'wide');
    expect(frame.className).toBe('wk-page');
  });

  it('names the narrow and full measures as modifiers', () => {
    render(<><PageFrame title="General" width="narrow" data-testid="a">x</PageFrame><PageFrame title="Tool" width="full" data-testid="b">y</PageFrame></>);
    expect(screen.getByTestId('a').className).toBe('wk-page wk-page--narrow');
    expect(screen.getByTestId('b').className).toBe('wk-page wk-page--full');
  });

  it('centres every measure from the one layout section, reading the tokens', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/sections/layout.css'), 'utf8');
    expect(css).toMatch(/\.wk-page \{[^}]*margin-inline: auto;[^}]*max-width: var\(--page-max\)/);
    expect(css).toMatch(/\.wk-measure \{[^}]*padding-inline: max\(var\(--page-pad\), calc\(\(100% - var\(--measure-max\)\) \/ 2 \+ var\(--page-pad\)\)\)/);
    const tokens = readFileSync(resolve(__dirname, '../src/styles/tokens.css'), 'utf8');
    for (const t of ['--page-max:', '--page-max-narrow:', '--thread-max:', '--page-pad:']) expect(tokens).toContain(t);
    // No routed page keeps a width of its own on the frame (the old 1200 px left-aligned box).
    const components = readFileSync(resolve(__dirname, '../src/styles/components.css'), 'utf8');
    expect(components).not.toMatch(/\.wk-page \{[^}]*max-width/);
  });
});
