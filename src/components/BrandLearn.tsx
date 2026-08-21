import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BridgeUnavailableError,
  getTheme,
  interactiveUrl,
  learnTheme,
  listThemes,
  type LearnKind,
} from '../api/interactive.js';
import { interactiveRootOf } from '../hooks/useBoardModel.js';
import { useProjectsStore } from '../store/projects.js';
import { applyAppearance, useAppearanceStore } from '../theming/appearance.js';
import { isUnsatisfiable, mapBrandTheme, type BrandTokenOverrides } from '../theming/brandMapper.js';

/**
 * The "Learn from brand source" row of the Appearance section
 * (DES-VISION-001 §4.3) — the studio-direct invocation path of the
 * `wicked-studio:theming:learn-brand` garden skill (§4.2): the UI calls the
 * API itself and runs the §4.5 mapper in the client; no agent is spawned.
 *
 * The §4.1 loop, end to end: source in → `learnTheme` THROUGH THE EXISTING
 * PROXY (§4.4 — the SSRF guard is server-side; the SPA never fetches the
 * brand source itself) → the bridge's queue `message` shown VERBATIM (§3.3:
 * show it, never paraphrase) → `listThemes` polled every 3s until the theme
 * lands with `learned_at` set → `getTheme` → `mapBrandTheme` (§4.5's four
 * guarantees) → preview via the slice-7 live-preview machinery
 * (`applyAppearance` writes the mapped primitives inline on `<html>`, no
 * persist — the whole page is the preview, §3.4) → Apply persists through the
 * appearance store's debounced PUT; Discard restores the stored appearance.
 *
 * Mapper adjustments are DISCLOSED under the preview (§4.3 step 7), and an
 * `unsatisfiable` mapping disables Apply entirely (§4.5: never silent).
 *
 * Logo (§4.5): a bridge-relative `logo_url` is resolved through
 * `interactiveUrl` and the RESOLVED URL is what persists — the logo must
 * survive the bridge being unavailable.
 */

const POLL_MS = 3000; /* §4.3 step 4: poll listThemes every 3s */

type Phase = 'idle' | 'queued' | 'ready' | 'applied' | 'error';

const KINDS: { kind: LearnKind; label: string; placeholder: string }[] = [
  { kind: 'url', label: 'URL', placeholder: 'https://brand.example.com…' },
  { kind: 'pdf', label: 'Local PDF', placeholder: '/absolute/path/to/brand.pdf' },
  { kind: 'image', label: 'Image file', placeholder: '/absolute/path/to/logo.png' },
];

function errorText(e: unknown): string {
  if (e instanceof BridgeUnavailableError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export function BrandLearn(): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const [kind, setKind] = useState<LearnKind>('url');
  const [source, setSource] = useState('');
  const [projectId, setProjectId] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const [mapping, setMapping] = useState<BrandTokenOverrides | null>(null);
  const [resolvedLogo, setResolvedLogo] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The proxy path encodes the project (§4.4); brand-learn for non-crew
  // projects is out of scope (§7). Default to the first project already bound
  // to an interactive root, else the first real project.
  useEffect(() => {
    if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load();
  }, []);
  const selectable = projects.filter((p) => p.id !== 'default');
  const effectiveProject = projectId !== '' ? projectId
    : (selectable.find((p) => interactiveRootOf(p) !== null) ?? selectable[0])?.id ?? '';

  const stopPolling = useCallback((): void => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  /** One poll tick (§4.3 step 4): learned when the id is listed WITH learned_at. */
  const pollOnce = useCallback(async (pid: string, themeId: string): Promise<void> => {
    let learned = false;
    try {
      const themes = await listThemes(pid);
      learned = themes.some((t) => t.name === themeId
        && typeof t.learned_at === 'string' && t.learned_at !== '');
    } catch {
      return; // a flaky poll is not a failed learn — keep polling
    }
    if (!learned) return;
    stopPolling();
    try {
      const detail = await getTheme(pid, themeId); // §4.4's one new wrapper
      const mapped = mapBrandTheme(detail);        // §4.5, pure, client-side
      const logo = mapped.logo_url !== null ? interactiveUrl(pid, mapped.logo_url) : null;
      setMapping(mapped);
      setResolvedLogo(logo);
      if (isUnsatisfiable(mapped)) {
        // §4.5: never applied silently — disclose, and offer no Apply.
        setPhase('error');
        setStatus('The extracted palette cannot satisfy the contrast and distinctness guarantees — see the adjustments below.');
      } else {
        // Preview IS the page (§3.4): mapped primitives land inline on <html>,
        // NOT through the store — nothing persists until Apply.
        const current = useAppearanceStore.getState().appearance;
        applyAppearance({
          ...current,
          accent_h: mapped.accent_h,
          accent_s: mapped.accent_s,
          accent_l: mapped.accent_l,
          logo_url: logo ?? current.logo_url,
        });
        setPhase('ready');
        setStatus('Ready — preview below');
      }
    } catch (e: unknown) {
      setPhase('error');
      setStatus(errorText(e));
    }
  }, [stopPolling]);

  async function onLearn(): Promise<void> {
    const src = source.trim();
    if (src === '' || effectiveProject === '' || phase === 'queued') return;
    setMapping(null);
    setResolvedLogo(null);
    setPhase('queued');
    setStatus(null);
    try {
      const body = kind === 'url' ? { kind, url: src } : { kind, path: src };
      const res = await learnTheme(effectiveProject, body);
      // §4.3 step 3: the bridge's message VERBATIM — shown, never paraphrased.
      setStatus(res.message ?? 'Queued');
      const themeId = res.theme_id;
      stopPolling();
      pollRef.current = setInterval(() => { void pollOnce(effectiveProject, themeId); }, POLL_MS);
      void pollOnce(effectiveProject, themeId);
    } catch (e: unknown) {
      stopPolling();
      setPhase('error');
      setStatus(errorText(e)); // the bridge's refusal (SSRF guard 400/503) verbatim
    }
  }

  function onApply(): void {
    if (mapping === null || isUnsatisfiable(mapping)) return;
    // Persistence is the appearance store's job (§3.3): optimistic inline
    // apply + the debounced PUT. The RESOLVED logo URL is what persists (§4.5).
    useAppearanceStore.getState().update({
      accent_h: mapping.accent_h,
      accent_s: mapping.accent_s,
      accent_l: mapping.accent_l,
      ...(resolvedLogo !== null ? { logo_url: resolvedLogo } : {}),
    });
    setPhase('applied');
    setStatus('Applied — persisted as the per-install appearance.');
  }

  function onDiscard(): void {
    stopPolling();
    // Revert the un-persisted preview: the stored appearance is the truth.
    applyAppearance(useAppearanceStore.getState().appearance);
    setMapping(null);
    setResolvedLogo(null);
    setPhase('idle');
    setStatus(null);
  }

  const placeholder = KINDS.find((k) => k.kind === kind)?.placeholder ?? '';
  const applicable = mapping !== null && !isUnsatisfiable(mapping) && phase === 'ready';

  return (
    <div
      data-testid="brand-learn"
      className="py-4 border-t"
      style={{ borderColor: 'var(--surface-raised)' }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--ink-high)' }}>
        Learn from brand source
      </p>
      <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--ink-muted)' }}>
        Point at a brand — a live URL, a local PDF, or an image — and the interactive
        bridge extracts its identity. The mapper keeps the accent readable and distinct
        from the fixed status colors; nothing applies until you confirm.
      </p>

      <div className="flex items-center gap-4 flex-wrap mb-2">
        {KINDS.map((k) => (
          <label key={k.kind} className="flex items-center gap-1.5 text-xs cursor-pointer"
            style={{ color: kind === k.kind ? 'var(--ink-body)' : 'var(--ink-muted)' }}>
            <input
              type="radio"
              name="brand-learn-kind"
              data-testid={`learn-source-${k.kind}`}
              checked={kind === k.kind}
              onChange={() => setKind(k.kind)}
              style={{ accentColor: 'var(--accent)' }}
            />
            {k.label}
          </label>
        ))}
        {selectable.length > 1 && (
          <select
            data-testid="learn-project"
            aria-label="Project"
            value={effectiveProject}
            onChange={(e) => setProjectId(e.target.value)}
            className="text-xs rounded px-1.5 py-1 ml-auto"
            style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
          >
            {selectable.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          data-testid="learn-input"
          aria-label="Brand source"
          placeholder={placeholder}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void onLearn(); }}
          className="flex-1 min-w-0 rounded px-2 py-1 text-xs font-mono focus:outline-none"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
        />
        <button
          type="button"
          data-testid="learn-submit"
          disabled={phase === 'queued'}
          onClick={() => void onLearn()}
          className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          Learn
        </button>
      </div>

      {status !== null && (
        <p
          data-testid="learn-status"
          className="text-xs mt-2 font-mono"
          style={{ color: phase === 'error' ? 'var(--status-fail)' : 'var(--ink-body)' }}
        >
          {status}
        </p>
      )}

      {mapping !== null && (
        <div className="mt-3">
          {applicable && (
            <div className="flex items-center gap-3 flex-wrap">
              <span
                data-testid="learn-preview-chip"
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                learned accent {mapping.accent_h}° {mapping.accent_s}% {mapping.accent_l}%
              </span>
              <span className="text-xs" style={{ color: 'var(--ink-dim)' }}>
                The whole page — and the preview strip above — is wearing it now.
              </span>
            </div>
          )}
          {mapping.adjustments.length > 0 && (
            <ul data-testid="mapper-adjustments" className="mt-2 flex flex-col gap-1">
              {mapping.adjustments.map((a, i) => (
                <li key={i} className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                  <span style={{ color: a.constraint === 'unsatisfiable' ? 'var(--status-fail)' : 'var(--ink-dim)' }}>
                    {a.constraint}
                  </span>{' '}
                  {a.original} → {a.adjusted} — <span style={{ color: 'var(--ink-body)' }}>{a.reason}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              data-testid="learn-apply"
              disabled={!applicable}
              onClick={onApply}
              className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              Apply
            </button>
            <button
              type="button"
              data-testid="learn-discard"
              onClick={onDiscard}
              className="px-3 py-1 rounded-lg text-xs font-medium"
              style={{ background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {(phase === 'queued') && mapping === null && (
        <div className="mt-2">
          <button
            type="button"
            data-testid="learn-discard"
            onClick={onDiscard}
            className="px-2.5 py-1 rounded-lg text-xs font-medium"
            style={{ background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
