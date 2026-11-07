import { useEffect, useMemo, useState } from 'react';
import { Palette } from 'lucide-react';
import { effectiveAppearance, THEME_UNDO_MS, useAppearanceStore } from '../theming/appearance.js';
import { measureTheme } from '../theming/themeContrast.js';

/**
 * THE THEME PREVIEW BAR (DES-CHAT-ARTIFACTS-001 §9, slice A7; mockup e): shown on every page while this tab previews a
 * theme proposal from a chat — "Previewing Calm night on this tab only · Apply · Back to mine" — then what Apply did:
 * "Saving…", "Saved · Undo" for 10 seconds (Undo restores only the patch keys that still hold what Apply set), or the
 * failure with Retry. Nothing here is persisted: a reload drops the preview.
 */
export function ThemePreviewBar(): React.ReactElement | null {
  const preview = useAppearanceStore((s) => s.preview);
  const save = useAppearanceStore((s) => s.save);
  const until = save.undo?.until ?? null;
  const stored = useAppearanceStore((s) => s.appearance);
  // The same gate as the Theme page: a preview whose merged result fails contrast offers no Apply.
  const refused = useMemo(() => {
    if (preview === null) return null;
    const c = measureTheme(effectiveAppearance({ appearance: stored, preview }));
    return c.ok ? null : `Contrast too low: ${c.failing.join('; ')}`;
  }, [stored, preview]);

  // "Saved" stands for the Undo window, then the bar goes; a recording error stays until dismissed, its Undo gone.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (save.state !== 'saved' || until === null) return;
    const t = setTimeout(() => {
      const now = useAppearanceStore.getState().save;
      if (now.undo?.until !== until) return;
      if (now.recordError === undefined) useAppearanceStore.getState().clearSave();
      else setTick((n) => n + 1);
    }, Math.max(0, until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [save.state, until, save.recordError]);

  if (preview === null && (save.state === 'idle' || save.state === 'saving')) return null;
  const st = useAppearanceStore.getState;
  const name = preview?.name ?? save.name ?? 'the theme';
  return (
    <div data-testid="theme-preview-bar" data-state={preview !== null ? (save.state === 'idle' ? 'previewing' : save.state) : save.state}
      role={save.state === 'failed' ? 'alert' : 'status'} className="wk-theme-bar">
      <Palette size={16} aria-hidden className="wk-theme-bar-icon" />
      {preview !== null ? (
        <>
          <span className="wk-theme-bar-words">
            {save.state === 'saving' ? <>Saving <b>{name}</b>…</>
              : save.state === 'failed' ? <>Couldn’t save <b>{name}</b>: {save.error}</>
              : <>Previewing <b>{name}</b> on this tab only{refused !== null ? `. ${refused}.` : ''}</>}
          </span>
          <button type="button" data-testid="theme-preview-apply" className="wk-btn wk-btn--primary wk-btn--sm"
            disabled={save.state === 'saving' || refused !== null} {...(refused !== null ? { title: refused } : {})} onClick={() => void st().applyPreview()}>
            {save.state === 'failed' ? 'Retry' : save.state === 'saving' ? 'Saving…' : 'Apply'}
          </button>
          <button type="button" data-testid="theme-preview-back" className="wk-btn wk-btn--quiet wk-btn--sm"
            disabled={save.state === 'saving'} onClick={() => st().endPreview()}>Back to mine</button>
        </>
      ) : save.state === 'saved' ? (
        <>
          <span className="wk-theme-bar-words">
            Saved <b>{name}</b> to your studio settings.{save.recordError !== undefined ? ` ${save.recordError}` : ''}
          </span>
          {until !== null && Date.now() <= until && (
            <button type="button" data-testid="theme-preview-undo" className="wk-btn wk-btn--quiet wk-btn--sm"
              aria-label={`Undo ${name} (${Math.round(THEME_UNDO_MS / 1000)} seconds)`} onClick={() => st().undoApply()}>Undo</button>
          )}
          <button type="button" data-testid="theme-preview-dismiss" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => st().clearSave()}>Dismiss</button>
        </>
      ) : (
        <>
          <span className="wk-theme-bar-words">Couldn’t save <b>{name}</b>: {save.error}</span>
          <button type="button" data-testid="theme-preview-dismiss" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => st().clearSave()}>Dismiss</button>
        </>
      )}
    </div>
  );
}
