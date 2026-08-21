import { useEffect, useRef, useState } from 'react';
import { useAppearanceStore } from '../theming/appearance.js';
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
 * Theme (§2.14): dark is tokens.css itself; light is the one theme instance,
 * applied as `data-theme="light"` on <html> and persisted with the rest.
 *
 * Status colors are FIXED semantic signals (§2.6) — deliberately absent here.
 */

const WHEEL = 240;   /* §3.2: 240px diameter */
const RING = 24;     /* ring thickness */
const HANDLE = 16;

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

  const rad = (hue * Math.PI) / 180;
  const hr = WHEEL / 2 - RING / 2 - 1;

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
      style={{
        position: 'relative', width: `${WHEEL}px`, height: `${WHEEL}px`,
        flexShrink: 0, cursor: 'crosshair', touchAction: 'none',
        borderRadius: 'var(--radius-full)',
      }}
    >
      <canvas ref={canvasRef} width={WHEEL} height={WHEEL} style={{ display: 'block' }} />
      <div
        data-testid="hue-handle"
        style={{
          position: 'absolute', width: `${HANDLE}px`, height: `${HANDLE}px`,
          left: `${WHEEL / 2 + hr * Math.cos(rad) - HANDLE / 2}px`,
          top: `${WHEEL / 2 + hr * Math.sin(rad) - HANDLE / 2}px`,
          borderRadius: 'var(--radius-full)', pointerEvents: 'none',
          background: 'hsl(var(--_accent-h) 100% 50%)',
          border: '2px solid var(--ink-high)', boxShadow: 'var(--shadow-card)',
        }}
      />
    </div>
  );
}

function SliderRow({ label, testId, value, track, onChange }: {
  label: string; testId: string; value: number; track: string; onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-20 shrink-0" style={{ color: 'var(--ink-muted)' }}>{label}</span>
      <input
        type="range" min={0} max={100} value={value}
        aria-label={label} data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ background: track, accentColor: 'var(--accent)' }}
      />
      <span
        className="text-xs w-10 text-right tabular-nums font-mono"
        style={{ color: 'var(--ink-dim)' }}
      >
        {value}%
      </span>
    </div>
  );
}

/** §3.2's preview band: accent-consuming elements beside a FIXED gate chip. */
function PreviewStrip(): React.ReactElement {
  return (
    <div
      data-testid="appearance-preview"
      className="flex items-center gap-4 rounded-lg px-4 py-3 flex-wrap"
      style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)' }}
    >
      <div
        className="flex items-center gap-0.5 rounded-lg p-0.5"
        style={{ background: 'var(--surface-rail)' }}
      >
        {(['Chat', 'Build', 'Document', 'Video'] as const).map((m) => (
          <span
            key={m}
            data-testid={m === 'Build' ? 'preview-mode-active' : undefined}
            className="text-xs px-2.5 py-1 rounded-md font-medium"
            style={m === 'Build'
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { color: 'var(--ink-muted)' }}
          >
            {m}
          </span>
        ))}
      </div>
      <span
        data-testid="preview-gate-chip"
        className="text-xs px-2.5 py-1 rounded-full font-mono"
        style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}
      >
        waiting on you
      </span>
      <span
        data-testid="preview-primary"
        className="text-xs px-3 py-1.5 rounded-lg font-medium"
        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
      >
        + Build
      </span>
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
  const fileRef = useRef<HTMLInputElement>(null);

  function applyLogoUrl(): void {
    const url = logoDraft.trim();
    if (url === '') return;
    setLogoError(null);
    update({ logo_url: url });
    setLogoDraft('');
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setLogoError('Logo file too large — keep it under 256 KB, or host it and enter a URL.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoError(null);
      update({ logo_url: String(reader.result) });
    };
    reader.readAsDataURL(file);
  }

  const themeButton = (theme: 'dark' | 'light', label: string): React.ReactElement => {
    const active = appearance.theme === theme;
    return (
      <button
        type="button"
        data-testid={`theme-${theme}`}
        aria-pressed={active}
        onClick={() => update({ theme })}
        className="px-3 py-1 rounded-md text-xs font-medium"
        style={active
          ? { background: 'var(--accent)', color: 'var(--accent-fg)', border: '1px solid var(--accent)' }
          : { background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
      >
        {label}
      </button>
    );
  };

  return (
    <section
      data-testid="appearance-settings"
      className="rounded-xl px-5 mb-6"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
    >
      <h2
        className="text-xs font-semibold uppercase tracking-wide pt-4 pb-2 font-mono"
        style={{ color: 'var(--ink-dim)' }}
      >
        Appearance
      </h2>

      {/* ── Logo (§3.1): the 32×32 chrome slot, contain-fit, --space-2 clearspace ── */}
      <div className="flex items-start gap-4 py-4 border-b" style={{ borderColor: 'var(--surface-raised)' }}>
        <div
          data-testid="logo-thumb"
          className="flex items-center justify-center shrink-0 rounded-lg"
          style={{
            width: '48px', height: '48px',
            backgroundColor: 'var(--surface-rail)', border: '1px solid var(--surface-raised)',
            backgroundImage: 'var(--logo-url, none)',
            backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
          }}
        >
          {appearance.logo_url === null && <WickedLogo size={32} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--ink-high)' }}>Logo</p>
          <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--ink-muted)' }}>
            Shown in the 32×32 chrome slot — letterboxed to fit, never stretched or cropped.
            Monochrome marks work best on any surface.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} className="hidden" data-testid="logo-file-input" />
            <button
              type="button"
              data-testid="logo-upload"
              onClick={() => fileRef.current?.click()}
              className="px-2.5 py-1 rounded-lg text-xs font-medium"
              style={{ background: 'var(--surface-raised)', color: 'var(--ink-body)' }}
            >
              Upload…
            </button>
            <input
              type="text"
              data-testid="logo-url-input"
              aria-label="Logo URL"
              placeholder="https://…/logo.svg"
              value={logoDraft}
              onChange={(e) => setLogoDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyLogoUrl(); }}
              className="w-52 rounded px-2 py-1 text-xs font-mono focus:outline-none"
              style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            />
            <button
              type="button"
              data-testid="logo-url-apply"
              onClick={applyLogoUrl}
              className="px-2.5 py-1 rounded-lg text-xs font-medium"
              style={{ background: 'var(--surface-raised)', color: 'var(--ink-body)' }}
            >
              Use URL
            </button>
            {appearance.logo_url !== null && (
              <button
                type="button"
                data-testid="logo-remove"
                onClick={() => { setLogoError(null); removeLogo(); }}
                className="px-2.5 py-1 rounded-lg text-xs font-medium"
                style={{ background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
              >
                Remove
              </button>
            )}
          </div>
          {logoError !== null && (
            <p className="text-xs mt-1" style={{ color: 'var(--status-fail)' }} data-testid="logo-error">{logoError}</p>
          )}
        </div>
      </div>

      {/* ── Theme (§2.14): dark is the default instance; light is the override ── */}
      <div className="flex items-center justify-between gap-4 py-4 border-b" style={{ borderColor: 'var(--surface-raised)' }}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--ink-high)' }}>Theme</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            The surface and ink ramps. Accent and status colors carry across both.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {themeButton('dark', 'Dark')}
          {themeButton('light', 'Light')}
        </div>
      </div>

      {/* ── Accent (§3.2): the wheel + sliders ARE the live preview (§3.4) ── */}
      <div className="py-4">
        <p className="text-sm font-medium" style={{ color: 'var(--ink-high)' }}>Accent color</p>
        <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--ink-muted)' }}>
          Applies live to the whole page — what you see is the current state; it persists automatically.
        </p>
        <div className="flex items-start gap-6 flex-wrap">
          <HueWheel hue={appearance.accent_h} onHue={(h) => update({ accent_h: h })} />
          <div className="flex-1 min-w-64 flex flex-col gap-4">
            <SliderRow
              label="Saturation"
              testId="accent-sat"
              value={appearance.accent_s}
              track="linear-gradient(to right, hsl(var(--_accent-h) 0% 50%), hsl(var(--_accent-h) 100% 50%))"
              onChange={(v) => update({ accent_s: v })}
            />
            <SliderRow
              label="Lightness"
              testId="accent-lgt"
              value={appearance.accent_l}
              track="linear-gradient(to right, hsl(var(--_accent-h) var(--_accent-s) 0%), hsl(var(--_accent-h) var(--_accent-s) 50%), hsl(var(--_accent-h) var(--_accent-s) 100%))"
              onChange={(v) => update({ accent_l: v })}
            />
            <PreviewStrip />
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="accent-reset"
                onClick={resetAccent}
                className="px-2.5 py-1 rounded-lg text-xs font-medium"
                style={{ background: 'var(--surface-raised)', color: 'var(--ink-body)' }}
              >
                Reset to default
              </button>
              {/* §3.5: two independent resets — this one never touches the logo. */}
              <span className="text-xs" style={{ color: 'var(--ink-dim)' }}>
                Accent only — the logo is a separate choice.
              </span>
            </div>
          </div>
        </div>
        <p className="text-xs mt-3 pb-1" style={{ color: 'var(--ink-dim)' }}>
          Status colors — gate amber, failing red, running emerald — are fixed semantic signals
          and are not customizable.
        </p>
      </div>

      {/* NOTE: the "Learn from a brand" extraction leg lives in its OWN section
          (BrandLearn.tsx, rendered beside this one on /theme). Issue #65 removed
          it from here because its old loop rode invented routes; it returned on
          real wires once wicked-interactive#181 gave the doc-scoped learn a
          readback (GET /d/:docId/api/theme/learned). This section stays the
          MANUAL surface only — accent/logo/theme, crew-persisted — and the
          brand-learn Apply funnels into the same appearance store it uses.
      */}
    </section>
  );
}
