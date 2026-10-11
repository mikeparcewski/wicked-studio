import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SITE_NAME, THEMES, useAppearanceStore } from '../theming/appearance.js';
import { SectionTitle } from './ui/PageFrame.js';
import { Segmented } from './ui/Segmented.js';
import { FilePick } from './ui/FilePick.js';
import { WickedLogo } from './WickedLogo.js';

/**
 * The Appearance section of Settings (DES-VISION-001 §3.2) — a SECTION within
 * the existing `/system` surface, not a new page (single-surface philosophy).
 *
 * Logo (§3.1): upload or URL into the 32×32 chrome slot via `--logo-url`;
 * contain-fit (letterboxed, never stretched or cropped), `--space-2`
 * clearspace, monochrome recommended. Remove reverts to the default mark.
 *
 * Accent (§3.2): a canvas hue wheel (240px — §7 sanctions a canvas wheel
 * within budget; no library taken) drives `--_accent-h`; the two sliders
 * fine-tune `--_accent-s` / `--_accent-l`. Every move applies as an inline
 * override on <html> — the WHOLE PAGE is the live preview (§3.4); the strip
 * below is just a convenient nearby example showing accent beside a gate chip
 * (EC12: accent vs status, side by side). Reset restores 258/72/62 (§3.5) and
 * persists; the logo is independent of the accent reset.
 *
 * Theme (§2.14): dark is tokens.css itself; light, wicked-light and wicked-dark are theme
 * instances, applied as `data-theme` on <html> and persisted with the rest. A wicked theme
 * writes the harbor accent preset (DES-STUDIO-REBUILD-001 S1); the wheel owns it after.
 *
 * Status colors are FIXED semantic signals (§2.6) — deliberately absent here.
 */

const WHEEL = 240;   /* §3.2: 240px diameter */
const RING = 24;     /* ring thickness */

/** Angle → hue: canvas convention (0° at +x, clockwise), matching the wedges. */
function hueAtPointer(e: { clientX: number; clientY: number }, el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left - rect.width / 2;
  const y = e.clientY - rect.top - rect.height / 2;
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360) % 360;
}

function HueWheel({ hue, onHue }: { hue: number; onHue: (h: number) => void }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return; // jsdom has no 2d context; the wheel is e2e-proven
    const c = WHEEL / 2;
    const r = c - RING / 2 - 1;
    ctx.clearRect(0, 0, WHEEL, WHEEL);
    ctx.lineWidth = RING;
    for (let d = 0; d < 360; d++) {
      ctx.beginPath();
      ctx.arc(c, c, r, ((d - 1) * Math.PI) / 180, ((d + 1.5) * Math.PI) / 180);
      ctx.strokeStyle = `hsl(${d} 100% 50%)`;
      ctx.stroke();
    }
  }, []);


  return (
    <div
      data-testid="hue-wheel"
      role="slider"
      aria-label="Accent hue"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={hue}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onHue(hueAtPointer(e, e.currentTarget));
      }}
      onPointerMove={(e) => { if (dragging) onHue(hueAtPointer(e, e.currentTarget)); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onHue((hue + 1) % 360);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onHue((hue + 359) % 360);
      }}
      className="wk-pg-set-wheel"
    >
      <canvas ref={canvasRef} width={WHEEL} height={WHEEL} />
      <div className="wk-pg-set-wheel-orbit" style={{ transform: `rotate(${hue}deg)` }}>
        <div data-testid="hue-handle" className="wk-pg-set-wheel-handle" />
      </div>
    </div>
  );
}

function SliderRow({ label, testId, value, track, onChange }: {
  label: string; testId: string; value: number; track: string; onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <label className="wk-pg-set-slider">
      <span>{label}</span>
      <input type="range" min={0} max={100} value={value} aria-label={label} data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))} style={{ background: track }} />
      <span className="tabular-nums">{value}%</span>
    </label>
  );
}

/** §3.2's preview band: accent-consuming elements beside a FIXED gate chip. */
function PreviewStrip(): React.ReactElement {
  return (
    <div data-testid="appearance-preview" className="wk-pg-set-preview">
      <span data-testid="preview-mode-active" className="wk-tag">Selected accent</span>
      <span data-testid="preview-gate-chip" className="wk-tag wk-pg-set-gate">Waiting on you</span>
      <span data-testid="preview-primary" className="wk-btn wk-btn--primary">Primary action</span>
    </div>
  );
}

const MAX_UPLOAD_BYTES = 256 * 1024;

export function AppearanceSettings(): React.ReactElement {
  const appearance = useAppearanceStore((s) => s.appearance);
  const update = useAppearanceStore((s) => s.update);
  const resetAccent = useAppearanceStore((s) => s.resetAccent);
  const removeLogo = useAppearanceStore((s) => s.removeLogo);
  const [logoDraft, setLogoDraft] = useState('');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  function applyLogoUrl(): void {
    const url = logoDraft.trim();
    if (url === '') return;
    setLogoError(null);
    update({ logo_url: url });
    setLogoDraft('');
  }

  function onUpload(file: File | null): void {
    setLogoFile(file);
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setLogoFile(null);
      setLogoError('Logo file too large — keep it under 256 KB, or host it and enter a URL.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoError(null);
      update({ logo_url: String(reader.result) });
      setLogoFile(null);
    };
    reader.readAsDataURL(file);
  }

  const chooseTheme = useAppearanceStore((s) => s.chooseTheme);

  return (
    <section data-testid="appearance-settings" className="wk-card wk-pg-set-stack" ref={(root) => {
      // Preserve hooks on the primitive's option and upload controls.
      for (const option of root?.querySelectorAll<HTMLButtonElement>('[data-value]') ?? []) {
        option.dataset.testid = `theme-${option.dataset.value}`;
      }
      const upload = root?.querySelector<HTMLButtonElement>('.wk-filepick button');
      if (upload) upload.dataset.testid = 'logo-upload';
    }}>
      <SectionTitle>Appearance</SectionTitle>

      {/* Logo section */}
      <div className="wk-pg-set-logo-row">
        <div data-testid="logo-thumb" className="wk-pg-set-logo-thumb">
          {appearance.logo_url === null && <WickedLogo size={32} />}
        </div>
        <div className="wk-pg-set-stack">
          <SectionTitle>Logo</SectionTitle>
          <p className="wk-field-note">Shown beside your workspace name, scaled to fit without cropping; a simple mark works best.</p>
          <FilePick label="Upload…" accept="image/*" file={logoFile} onChange={onUpload} data-testid="logo-file" />
          <div className="wk-pg-set-logo-url">
            <input type="text" data-testid="logo-url-input" aria-label="Logo URL" placeholder="Paste a logo image URL"
              value={logoDraft} onChange={(e) => setLogoDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyLogoUrl(); }} className="wk-field" />
            <button type="button" data-testid="logo-url-apply" onClick={applyLogoUrl} className="wk-btn wk-btn--secondary">Use URL</button>
            {appearance.logo_url !== null && <button type="button" data-testid="logo-remove" onClick={() => { setLogoError(null); setLogoFile(null); removeLogo(); }} className="wk-btn wk-btn--quiet">Remove</button>}
          </div>
          {logoError !== null && <p className="wk-field-note" role="alert" data-testid="logo-error">{logoError}</p>}
        </div>
      </div>

      {/* Workspace name section */}
      <div className="wk-pg-set-stack">
        <SectionTitle>Site name</SectionTitle>
        <p className="wk-field-note">The name shown beside your logo. Leave blank to use {DEFAULT_SITE_NAME}.</p>
        <input type="text" data-testid="site-name-input" aria-label="Site name" placeholder={DEFAULT_SITE_NAME}
          value={appearance.site_name ?? ''} onChange={(e) => update({ site_name: e.target.value.trim() === '' ? null : e.target.value })} className="wk-field" />
      </div>

      {/* Theme section */}
      <div className="wk-pg-set-stack">
        <SectionTitle>Theme</SectionTitle>
        <p className="wk-field-note">Choose a light or dark appearance; the Wicked themes also set the accent color.</p>
        <Segmented label="Theme" data-testid="theme-picker" value={appearance.theme} options={THEMES.map((t) => ({ value: t.id, label: t.label }))} onChange={chooseTheme} />
      </div>

      {/* Accent section */}
      <div className="wk-pg-set-stack">
        <SectionTitle>Accent color</SectionTitle>
        <p className="wk-field-note">Changes appear across your workspace and save automatically.</p>
        <div className="wk-pg-set-accent">
          <HueWheel hue={appearance.accent_h} onHue={(h) => update({ accent_h: h })} />
          <div className="wk-pg-set-stack">
            <SliderRow label="Saturation" testId="accent-sat" value={appearance.accent_s}
              track="linear-gradient(to right, hsl(var(--_accent-h) 0% 50%), hsl(var(--_accent-h) 100% 50%))" onChange={(v) => update({ accent_s: v })} />
            <SliderRow label="Lightness" testId="accent-lgt" value={appearance.accent_l}
              track="linear-gradient(to right, hsl(var(--_accent-h) var(--_accent-s) 0%), hsl(var(--_accent-h) var(--_accent-s) 50%), hsl(var(--_accent-h) var(--_accent-s) 100%))" onChange={(v) => update({ accent_l: v })} />
            <PreviewStrip />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" data-testid="accent-reset" onClick={resetAccent} className="wk-btn wk-btn--secondary">Reset to default</button>
              <p className="wk-field-note">Resets the accent color; your logo stays as you chose it.</p>
            </div>
          </div>
        </div>
        <p className="wk-field-note">Status colors are fixed semantic signals and cannot be customized.</p>
      </div>
    </section>
  );
}
