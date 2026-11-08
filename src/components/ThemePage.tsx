import { useMemo } from 'react';
import { AppearanceSettings } from './AppearanceSettings.js';
import { THEME_LIMITS, themeChangeWords, themeDisclosure } from '../board/artifactProposal.js';
import { canonicalDelta, effectiveAppearance, useAppearanceStore } from '../theming/appearance.js';
import { contrastWords, measureTheme } from '../theming/themeContrast.js';
import { ThemeSwatches } from './ThemeSwatches.js';

/**
 * The Theme tab of the Settings page (`SettingsPage`, `/system?tab=theme`; `/theme` redirects there) —
 * the appearance customization surface (DES-VISION-001 §3). Its frame and title are the page's.
 *
 * Two sections, two authorities:
 *   - AppearanceSettings: the manual accent/logo/theme controls (untouched —
 *     crew-persisted, the appearance store's wires).
 *   - A link to Learn → Brand (program DES-LEARN §3.4), where "Learn from a
 *     brand" (BrandLearn, on the theme.requested + interactive#181 readback
 *     wires) now lives.
 */
export function ThemeSettings({ navigate }: { navigate?: (path: string) => void } = {}): React.ReactElement {
  return (
    <div className="wk-pg-set-content">
      <ThemeProposalPanel />
      <AppearanceSettings />
      {/* DES-LEARN §3.4: learning colours from a brand moved to Learn → Brand; the manual controls stay here. */}
      <p className="wk-field-note" data-testid="theme-brand-link">
        Want studio in your brand’s colours? <a className="wk-link" href="/learn?tab=brand" data-testid="theme-learn-brand"
          onClick={(e) => { if (navigate !== undefined) { e.preventDefault(); navigate('/learn?tab=brand'); } }}>Learn → Brand</a> reads them from your website, a PDF or an image.
      </p>
    </div>
  );
}

/**
 * "Proposed in chat: Calm night" (DES-CHAT-ARTIFACTS-001 §9, slice A7; mockup e): the theme this tab is previewing,
 * beside yours. The same preview state as the bar and the card: Discard is Back to mine, Apply saves only the delta's
 * keys. Both sides are measured on a rendered probe; Apply re-measures the exact result first.
 */
export function ThemeProposalPanel(): React.ReactElement | null {
  const stored = useAppearanceStore((s) => s.appearance);
  const preview = useAppearanceStore((s) => s.preview);
  const save = useAppearanceStore((s) => s.save);
  const facts = useMemo(() => {
    if (preview === null) return null;
    const proposed = effectiveAppearance({ appearance: stored, preview });
    return { yours: measureTheme(stored), proposed: measureTheme(proposed), changes: themeChangeWords(stored, canonicalDelta(stored, preview.delta)) };
  }, [stored, preview]);
  if (preview === null || facts === null) return null;
  const st = useAppearanceStore.getState;
  return (
    <section data-testid="theme-proposal-panel" className="wk-card wk-pg-set-stack wk-theme-proposal" aria-label={`Proposed in chat: ${preview.name}`}>
      <div className="wk-theme-proposal-head">
        <h3 className="wk-theme-proposal-title">Proposed in chat: {preview.name}</h3>
        <span className="wk-tag">from {preview.seat}</span>
        <span className="wk-theme-proposal-sp" />
        <button type="button" data-testid="theme-proposal-discard" className="wk-btn wk-btn--secondary wk-btn--sm"
          disabled={save.state === 'saving'} onClick={() => { st().endPreview(); document.getElementById('main')?.focus(); }}>Discard</button>
        <button type="button" data-testid="theme-proposal-apply" className="wk-btn wk-btn--primary wk-btn--sm"
          disabled={save.state === 'saving' || !facts.proposed.ok} onClick={() => void st().applyPreview()}>
          {save.state === 'saving' ? 'Saving…' : save.state === 'failed' ? 'Retry' : 'Apply'}
        </button>
      </div>
      <div className="wk-theme-proposal-twins">
        <div data-testid="theme-proposal-yours"><p className="wk-field-note">Yours now</p>{facts.yours.colors !== null ? <ThemeSwatches colors={facts.yours.colors} /> : <p className="wk-field-note">Not measured here</p>}</div>
        <div data-testid="theme-proposal-theirs"><p className="wk-field-note">{preview.name}</p>{facts.proposed.colors !== null ? <ThemeSwatches colors={facts.proposed.colors} /> : <p className="wk-field-note">Not measured here</p>}</div>
      </div>
      <p data-testid="theme-proposal-contrast" data-ok={facts.proposed.ok ? 'true' : 'false'} className={facts.proposed.ok ? 'wk-field-note' : 'wk-proposal-error'}>
        {contrastWords(facts.proposed)}{facts.proposed.ok || facts.proposed.ratios === null ? '' : ` · too low: ${facts.proposed.failing.join('; ')}`}
      </p>
      <p data-testid="theme-proposal-changes" className="wk-field-note">Changes: {facts.changes.length > 0 ? facts.changes.join(' · ') : 'nothing yet'}. {THEME_LIMITS}</p>
      <p className="wk-field-note">{themeDisclosure(preview.seat)}. Nothing is saved until you apply it; a reload drops the preview.</p>
      {save.state === 'failed' && <p data-testid="theme-proposal-error" role="alert" className="wk-proposal-error">Couldn’t save it: {save.error}</p>}
    </section>
  );
}
