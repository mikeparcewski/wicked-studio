import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase } from '../../api/client.js';
import { editorFor, listEditors, type EditorView } from '../../api/editors.js';
import { insightsApi, type InsightsAcceptTarget, type InsightsRecommendation } from '../../api/insights.js';
import { memoryPath } from '../../api/memory.js';
import { steerProposalsPath } from '../../api/steering.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { sessionPath } from '../../board/sessionModel.js';
import { EditorHost } from '../../editors/host.js';
import { INSIGHTS_KIND, InsightsAdapter } from '../../editors/insightsAdapter.js';
import { bundleUrl, fetchGrants } from '../../editors/model.js';
import type { AnchorRef } from '../../editors/protocol.js';
import { readThemeTokens } from '../../editors/theme.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmButton, CalmHead, CalmPage } from '../calm/Calm.js';

/** Where a settings recommendation's Accept lands. */
export const SETTINGS_SECTION_PATHS: Record<string, string> = { seats: '/agents', gates: '/system' };

/** The page an Accept opens, or `null` when it opens nothing (the host panel shows what to do). */
export function acceptPath(target: InsightsAcceptTarget, rec: InsightsRecommendation): string | null {
  if (target.kind === 'proposal') return rec.kind === 'memory' ? memoryPath('proposals') : steerProposalsPath();
  if (target.kind === 'settings') return SETTINGS_SECTION_PATHS[target.section] ?? '/build';
  if (target.kind === 'runs' && target.runIds.length === 1) return sessionPath(`run:${target.runIds[0] as string}`);
  return null;
}

type Phase = { kind: 'loading' } | { kind: 'unsupported' } | { kind: 'no-plugin' } | { kind: 'error'; message: string } | { kind: 'ready'; editor: EditorView };

/**
 * RUN INSIGHTS (`/insights`, crew DES-RUNS-REVIEW-001 §7). Studio only HOSTS the dashboard: the first-party
 * `wicked-insights` plugin draws every review (what got better, recommendations, watching, trends) from the
 * `insights` adapter. Deciding stays in the host (editor-defaults ED-2): when the plugin points at a
 * recommendation, this page draws its evidence (with the run links the plugin never sees) and Accept / Dismiss.
 */
export function InsightsPage({ navigate }: { navigate: Navigate }): React.ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [selected, setSelected] = useState<InsightsRecommendation | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const frameBox = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<EditorHost | null>(null);
  const adapterRef = useRef<InsightsAdapter | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [data, editors] = await Promise.all([insightsApi.insights(), listEditors()]);
        if (cancelled) return;
        if (data === null) { setPhase({ kind: 'unsupported' }); return; }
        const editor = editors === null ? null : editorFor(editors, INSIGHTS_KIND, 'full');
        if (editor === null) { setPhase({ kind: 'no-plugin' }); return; }
        adapterRef.current = new InsightsAdapter(data);
        setPhase({ kind: 'ready', editor });
      } catch (e) {
        if (!cancelled) setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const editor = phase.kind === 'ready' ? phase.editor : null;
  useEffect(() => {
    const adapter = adapterRef.current;
    if (editor === null || adapter === null || frameBox.current === null) return;
    let cancelled = false;
    void (async () => {
      const decided = await fetchGrants(editor.id, editor.version, editor.sha256, null);
      if (cancelled || frameBox.current === null) return;
      const host = new EditorHost({
        container: frameBox.current,
        src: bundleUrl(apiBase(), editor.id, editor.version, editor.sha256),
        editor: editor.id,
        version: editor.version,
        name: editor.title,
        title: `${editor.title}: every review of recent work`,
        size: 'full',
        surface: 'full',
        grants: decided.grants,
        theme: readThemeTokens(),
        prefs: { reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, techDetails: false, locale: navigator.language },
        firstParty: editor.first_party,
        adapter,
        ...(editor.surfaces !== undefined ? { declared: editor.surfaces } : {}),
        sizes: editor.sizes,
        ui: {
          chips: () => undefined,
          draft: () => undefined,
          typed: () => undefined,
          key: () => undefined,
          morph: () => undefined,
          status: () => undefined,
          notes: () => undefined,
          thread: () => undefined,
          fullscreen: async () => false,
          torn: (why) => setSaid(`The insights view stopped: ${why}. Reload the page to open it again.`),
          log: () => undefined,
          selected: (anchors: AnchorRef[]) => {
            const a = anchors.find((x) => x.kind === 'element');
            setSelected(a !== undefined && a.kind === 'element' ? adapter.recommendationAt(a.id) ?? null : null);
            setDismissing(false);
            setReason('');
            setSaid(null);
          },
        },
      });
      hostRef.current = host;
      host.mount();
    })();
    return () => {
      cancelled = true;
      hostRef.current?.teardown('The page was closed');
      hostRef.current = null;
    };
  }, [editor]);

  // A theme change while the page is open reaches the plugin (the same observer the run page's cards keep).
  useEffect(() => {
    if (typeof MutationObserver !== 'function') return undefined;
    const seen = new MutationObserver(() => hostRef.current?.setTheme(readThemeTokens()));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => seen.disconnect();
  }, []);

  /** Re-read crew after a decision and tell the plugin its artifact moved on. */
  const refresh = useCallback(async (): Promise<void> => {
    const data = await insightsApi.insights();
    const adapter = adapterRef.current;
    if (data === null || adapter === null) return;
    const v = adapter.reload(data);
    hostRef.current?.artifactChanged(v, 'generated');
    setSelected((cur) => (cur === null ? null : data.reviews.flatMap((r) => r.recommendations).find((r) => r.id === cur.id) ?? null));
  }, []);

  const accept = async (rec: InsightsRecommendation): Promise<void> => {
    setBusy(true);
    try {
      const { open } = await insightsApi.accept(rec.id);
      await refresh();
      const path = acceptPath(open, rec);
      if (open.kind === 'issue') {
        if (open.url !== null) window.open(open.url, '_blank', 'noopener,noreferrer');
        setSaid(open.url !== null ? 'Accepted. A prefilled issue opened in a new tab.' : `Accepted. File this issue: ${open.title}`);
      } else if (path !== null) {
        navigate(path);
      } else {
        setSaid(open.kind === 'runs' ? 'Accepted. Open each run below to retry it or archive it.' : 'Accepted.');
      }
    } catch (e) {
      setSaid(`Not accepted: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (rec: InsightsRecommendation): Promise<void> => {
    if (reason.trim() === '') return;
    setBusy(true);
    try {
      await insightsApi.dismiss(rec.id, reason.trim());
      await refresh();
      setDismissing(false);
      setSaid('Dismissed, with your reason.');
    } catch (e) {
      setSaid(`Not dismissed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (phase.kind !== 'ready') {
    const sentence =
      phase.kind === 'loading' ? 'Reading the reviews…'
        : phase.kind === 'unsupported' ? 'This version of crew does not review runs yet. Upgrade crew to see Run insights.'
          : phase.kind === 'no-plugin' ? 'The Run insights plugin is not installed or is turned off. Turn it on under Build & settings → Plugins.'
            : `The reviews could not be read: ${phase.message}`;
    return (
      <CalmPage data-testid="insights-page">
        <CalmHead title={PAGE_NAMES.insights} sentence={sentence} sentenceTestId="insights-state" />
      </CalmPage>
    );
  }

  return (
    <div data-testid="insights-page" className="wk-insights-page">
      <div ref={frameBox} data-testid="insights-frame" className="wk-insights-frame" />
      <aside data-testid="insights-decide" className="wk-insights-decide" aria-label="Decide on a recommendation">
        {selected === null ? (
          <p className="wk-insights-hint">Pick a recommendation to see its evidence and accept or dismiss it.</p>
        ) : (
          <>
            <h2 className="wk-insights-title" data-testid="insights-decide-title">{selected.title}</h2>
            <p className="wk-insights-line">{selected.evidence.line}</p>
            {selected.evidence.runs.length > 0 && (
              <ul className="wk-insights-runs" data-testid="insights-decide-runs" aria-label="Runs behind it">
                {selected.evidence.runs.slice(0, 12).map((r) => (
                  <li key={r.id}><a href={sessionPath(`run:${r.id}`)} onClick={(e) => { e.preventDefault(); navigate(sessionPath(`run:${r.id}`)); }}>{r.title}</a></li>
                ))}
              </ul>
            )}
            {selected.proposalError !== null && <p className="wk-insights-line">Its proposal was not filed: {selected.proposalError}</p>}
            {selected.state === 'new' ? (
              dismissing ? (
                <div className="wk-insights-dismiss">
                  <label htmlFor="insights-reason">Why not?</label>
                  <textarea id="insights-reason" data-testid="insights-dismiss-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                  <span className="wk-insights-buttons">
                    <CalmButton tone="primary" testId="insights-dismiss-confirm" disabled={busy || reason.trim() === ''} onClick={() => void dismiss(selected)}>Dismiss</CalmButton>
                    <CalmButton tone="link" onClick={() => setDismissing(false)}>Back</CalmButton>
                  </span>
                </div>
              ) : (
                <span className="wk-insights-buttons">
                  <CalmButton tone="primary" testId="insights-accept" disabled={busy} onClick={() => void accept(selected)}>
                    {selected.proposalId !== null ? 'Accept: open the proposal' : 'Accept'}
                  </CalmButton>
                  <CalmButton testId="insights-dismiss" disabled={busy} onClick={() => setDismissing(true)}>Dismiss…</CalmButton>
                </span>
              )
            ) : (
              <p className="wk-insights-line" data-testid="insights-decided">
                {selected.state === 'accepted' ? 'Accepted' : `Dismissed: ${selected.reason ?? ''}`}
                {selected.decidedAt !== null ? ` on ${new Date(selected.decidedAt).toLocaleDateString()}` : ''}.
              </p>
            )}
          </>
        )}
        {said !== null && <p className="wk-insights-said" role="status" data-testid="insights-said">{said}</p>}
      </aside>
    </div>
  );
}
