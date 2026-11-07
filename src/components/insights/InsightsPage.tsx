import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase } from '../../api/client.js';
import { editorFor, listEditors, type EditorView } from '../../api/editors.js';
import { insightsApi, type InsightsRecommendation } from '../../api/insights.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { EditorHost } from '../../editors/host.js';
import { INSIGHTS_KIND, InsightsAdapter } from '../../editors/insightsAdapter.js';
import { bundleUrl, fetchGrants } from '../../editors/model.js';
import type { AnchorRef } from '../../editors/protocol.js';
import { readThemeTokens } from '../../editors/theme.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmHead, CalmPage } from '../calm/Calm.js';
import { InsightsDecide } from './InsightsDecide.js';

// The decide aside and where Accept lands moved to `InsightsDecide` (G2: a review run's card decides with it too).
export { acceptPath, SETTINGS_SECTION_PATHS } from './InsightsDecide.js';

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
  const [said, setSaid] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<import('../../api/insights.js').InsightsMetricDef[]>([]);
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
        setMetrics(data.metrics);
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
      <InsightsDecide selected={selected} metrics={metrics} navigate={navigate} onDecided={refresh} said={said} />
    </div>
  );
}
