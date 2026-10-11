import { SectionTitle } from './ui/PageFrame.js';
import { StateBanner, Skeleton } from './ui/StateBanner.js';
import { TechDetails } from './ui/TechDetails.js';
import { readErrorKind } from '../api/errors.js';
import { useEffect, useRef, useState } from 'react';
import { getLearnedTheme, requestThemeLearn } from '../api/interactive.js';
import { interactiveRootOf } from '../hooks/useBoardModel.js';
import { learnBody, learnReady, LEARN_KINDS, LEARN_LABEL } from '../interactive/themeWire.js';
import { threadKey, useDocThreadStore } from '../store/docThread.js';
import { useProjectsStore } from '../store/projects.js';
import { applyAppearance, useAppearanceStore } from '../theming/appearance.js';
import { isUnsatisfiable, mapBrandTheme, type BrandTokenOverrides } from '../theming/brandMapper.js';
import { adaptLearnedTokens } from '../theming/learnedTheme.js';
import { pollLearnedTheme } from '../theming/learnPoll.js';
import { ensureScratchDoc } from '../theming/scratchDoc.js';
import type { LearnKind } from '../api/interactive.js';

/**
 * "Learn from a brand" on the /theme page — the operator-directed accent
 * extraction studio#73 retracted (its old loop rode invented routes), back on
 * REAL wires now that interactive#181 gave the learn a readback:
 *
 *   pick a source (the same url | pdf | image trio the bridge's materializer
 *   accepts) and a target project → ensure that project's studio-owned
 *   scratch doc exists (`ensureScratchDoc`, the real registry route) → fire
 *   `theme.requested` over POST /api/events (`requestThemeLearn`, the #73
 *   wire) → poll `GET /d/:docId/api/theme/learned` (bounded, cancellable —
 *   learnPoll.ts) until the 404 turns 200 or the bridge's own status error
 *   surfaces → adapt the nested tokens (learnedTheme.ts) → the resurrected
 *   §4.5 mapper → preview inline on <html> (the whole page IS the preview,
 *   §3.4; nothing persists) → Apply through the EXISTING appearance store,
 *   the same persistence as the manual wheel above. No new surface.
 *
 * Honesty notes carried into the copy:
 *   - the learned shape has NO logo — the logo slot above stays manual;
 *   - refusals (the server-side SSRF guard's included) are shown VERBATIM;
 *   - an unsatisfiable mapping discloses its adjustments and offers no Apply;
 *   - this section fires ZERO requests until the user acts, and the poll
 *     cannot outlive the flow (hard cap + abort on cancel/unmount).
 */

type Phase = 'idle' | 'preparing' | 'queued' | 'ready' | 'applied' | 'error';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function BrandLearn(): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const [kind, setKind] = useState<LearnKind>('url');
  const [source, setSource] = useState('');
  const [projectId, setProjectId] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<unknown>(null);
  const [mapping, setMapping] = useState<BrandTokenOverrides | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The project list is the page's ordinary context (same load the switcher
  // does); the LEARN wires — docs, events, readback — fire only on submit.
  useEffect(() => {
    if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load();
  }, []);
  useEffect(() => () => { abortRef.current?.abort(); }, []); // unmount ends any poll

  // The learn rides one project's bridge (the proxy path encodes it). Default
  // to the first project already bound to an interactive root, else the first
  // real project; 'default' (Unfiled) is synthesized and never offered.
  const selectable = projects.filter((p) => p.id !== 'default');
  const effectiveProject = projectId !== '' ? projectId
    : (selectable.find((p) => interactiveRootOf(p) !== null) ?? selectable[0])?.id ?? '';

  const busy = phase === 'preparing' || phase === 'queued';

  async function onLearn(): Promise<void> {
    const value = source.trim();
    if (!learnReady(kind, value) || effectiveProject === '' || busy) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setMapping(null);
    setErrorSource(null);
    setPhase('preparing');
    setStatus('Preparing a document for learning your brand…');
    try {
      // studio#518: the signal rides the preparation too — a Cancel while the project's document
      // list is in flight stops the create that would follow (and the drafting run it launches).
      let docId: string;
      try {
        docId = await ensureScratchDoc(effectiveProject, undefined, ctl.signal);
      } catch (e: unknown) {
        if (ctl.signal.aborted) return; // cancel already reset the surface
        throw e;
      }
      if (ctl.signal.aborted) return;
      // The bridge reports refusals ASYNC as status.posted errors on the
      // scratch doc's thread; snapshot the newest one so only a NEW arrival
      // ends this learn (identity comparison — see ThreadError).
      const key = threadKey(effectiveProject, docId);
      const baseline = useDocThreadStore.getState().lastError[key];
      await requestThemeLearn(effectiveProject, docId, learnBody(kind, value));
      if (ctl.signal.aborted) return;
      setPhase('queued');
      setStatus('Queued — the bridge is reading the source. Watching for the learned '
        + 'tokens; this stops by itself in about a minute, or cancel below.');
      const outcome = await pollLearnedTheme({
        fetchLearned: () => getLearnedTheme(effectiveProject, docId),
        bridgeError: () => {
          const current = useDocThreadStore.getState().lastError[key];
          return current !== undefined && current !== baseline ? current.text : null;
        },
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return; // cancel already reset the surface
      if (outcome.kind === 'cancelled') { setPhase('idle'); setStatus(null); return; }
      if (outcome.kind === 'bridge-error') { setPhase('error'); setStatus(outcome.reason); return; }
      if (outcome.kind === 'timeout') {
        setPhase('error');
        setStatus(`No learned theme appeared after ${outcome.attempts} checks — the learn `
          + 'may still be running on the bridge. Try again in a moment.'
          + (outcome.lastFetchError !== null ? ` (last read error: ${outcome.lastFetchError})` : ''));
        return;
      }
      const adapted = adaptLearnedTokens(outcome.result.tokens);
      if (!adapted.ok) { setPhase('error'); setStatus(adapted.reason); return; }
      const mapped = mapBrandTheme(adapted.palette);
      setMapping(mapped);
      if (isUnsatisfiable(mapped)) {
        // §4.5: never applied silently — disclose, and offer no Apply.
        setPhase('error');
        setStatus('The extracted palette cannot satisfy the contrast and distinctness '
          + 'guarantees — see the adjustments below.');
        return;
      }
      // Preview IS the page (§3.4): the mapped primitives land inline on
      // <html>, NOT through the store — nothing persists until Apply. The
      // learned shape carries no logo, so the logo override is never touched.
      const current = useAppearanceStore.getState().appearance;
      applyAppearance({
        ...current,
        accent_h: mapped.accent_h,
        accent_s: mapped.accent_s,
        accent_l: mapped.accent_l,
      });
      setPhase('ready');
      setStatus(`Learned “${adapted.palette.name}” — the whole page is previewing it; `
        + 'nothing is saved until you apply.');
    } catch (e: unknown) {
      if (ctl.signal.aborted) return;
      setPhase('error');
      setErrorSource(e);
      setStatus(errorText(e)); // sync refusals (unknown doc, 403, the typed 503) verbatim
    }
  }

  function onApply(): void {
    if (mapping === null || isUnsatisfiable(mapping) || phase !== 'ready') return;
    // Persistence is the appearance store's job — the SAME optimistic inline
    // apply + debounced PUT the manual wheel above uses. No new surface.
    useAppearanceStore.getState().update({
      accent_h: mapping.accent_h,
      accent_s: mapping.accent_s,
      accent_l: mapping.accent_l,
    });
    setPhase('applied');
    setStatus('Applied — your workspace appearance is saved.');
  }

  function onDiscard(): void {
    abortRef.current?.abort();
    // Revert the un-persisted preview: the stored appearance is the truth.
    applyAppearance(useAppearanceStore.getState().appearance);
    setMapping(null);
    setPhase('idle');
    setStatus(null);
  }

  const applicable = mapping !== null && !isUnsatisfiable(mapping) && phase === 'ready';

  return (
    <section
      data-testid="brand-learn"
      className="wk-card wk-pg-set-stack"
    >
      <SectionTitle>Learn from a brand</SectionTitle>
      <p className="wk-field-note">Learn colors from a website, PDF, or image, then preview and apply them to your workspace; choose a logo separately above.</p>
      <div className="flex items-center gap-4 flex-wrap mb-2">
        {LEARN_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="radio"
              name="brand-learn-kind"
              className="wk-radio"
              data-testid={`learn-source-${k}`}
              checked={kind === k}
              onChange={() => setKind(k)}
            />
            {LEARN_LABEL[k].noun}
          </label>
        ))}
        {selectable.length > 1 && (
          <select
            data-testid="learn-project"
            aria-label="Project"
            value={effectiveProject}
            onChange={(e) => setProjectId(e.target.value)}
            className="wk-field"
          >
            {selectable.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          data-testid="learn-input"
          aria-label="Brand source"
          placeholder={LEARN_LABEL[kind].placeholder}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void onLearn(); }}
          className="wk-field flex-1 min-w-0"
        />
        <button
          type="button"
          data-testid="learn-submit"
          disabled={busy || !learnReady(kind, source.trim()) || effectiveProject === ''}
          onClick={() => void onLearn()}
          className={mapping === null ? "wk-btn wk-btn--primary" : "wk-btn wk-btn--secondary"}
        >
          Learn
        </button>
      </div>

      {(busy || !learnReady(kind, source.trim()) || effectiveProject === '') && <p className="wk-field-note">{busy ? 'Wait for learning to finish, or cancel it below.' : effectiveProject === '' ? 'Create a project before learning a brand.' : 'Enter a website address or file location to learn from.'}</p>}
      {status !== null && (phase === 'error'
        ? <StateBanner data-testid="learn-status" kind={readErrorKind(errorSource ?? status)} what="brand colors" error={status} onRetry={() => void onLearn()} />
        : <p data-testid="learn-status" className="wk-field-note" role="status">{status}</p>)}
      {busy && <Skeleton rows={2} />}
      {busy && (
        <div className="mt-2">
          <button
            type="button"
            data-testid="learn-cancel"
            onClick={onDiscard}
            className="wk-btn wk-btn--quiet"
          >
            Cancel
          </button>
        </div>
      )}

      {mapping !== null && (
        <div className="mt-3">
          {applicable && (
            <div className="flex items-center gap-3 flex-wrap">
              <span
                data-testid="learn-preview-chip"
                className="wk-tag"
              >
                learned accent {mapping.accent_h}° {mapping.accent_s}% {mapping.accent_l}%
              </span>
              <span className="text-xs">
                Your workspace is previewing these colors.
              </span>
            </div>
          )}
          {mapping.adjustments.length > 0 && <div data-testid="mapper-adjustments"><p className="wk-field-note">The colors were adjusted to keep text readable and status colors distinct.</p><TechDetails text={mapping.adjustments.map((a) => `${a.constraint}: ${a.original} → ${a.adjusted} — ${a.reason}`)} /></div>}
          {!applicable && <p className="wk-field-note">{phase === 'applied' ? 'These colors have already been applied.' : 'These colors cannot be applied until they meet the readability checks.'}</p>}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              data-testid="learn-apply"
              disabled={!applicable}
              onClick={onApply}
              className="wk-btn wk-btn--primary"
            >
              Apply
            </button>
            <button
              type="button"
              data-testid="learn-discard"
              onClick={onDiscard}
              className="wk-btn wk-btn--secondary"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
