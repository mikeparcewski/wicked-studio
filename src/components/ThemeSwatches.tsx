import type { ThemeColors } from '../theming/themeContrast.js';

/** A theme's ground, cards, action colour and body text as four swatches (DES-CHAT-ARTIFACTS-001 §9, mockup e). The
 *  colours are the ones the contrast probe computed from the theme's own tokens. */
export function ThemeSwatches({ colors }: { colors: ThemeColors }): React.ReactElement {
  const named: Array<[string, string]> = [['ground', colors.ground], ['cards', colors.card], ['action colour', colors.action], ['body text', colors.body]];
  return (
    <span className="wk-proposal-swatches" data-testid="theme-swatches" role="img" aria-label={`Swatches: ${named.map(([n]) => n).join(', ')}`}>
      {named.map(([n, c]) => <span key={n} title={n} className="wk-proposal-swatch" style={{ background: c }} />)}
    </span>
  );
}
