import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase } from '../../api/client.js';
import { editorFor, listEditors, type EditorView } from '../../api/editors.js';
import { insightsApi, type InsightsMetricDef, type InsightsRecommendation, type InsightsResponse } from '../../api/insights.js';
import type { ArtifactSize } from '../../board/artifactMorph.js';
import { EditorHost } from '../../editors/host.js';
import { INSIGHTS_KIND, InsightsAdapter } from '../../editors/insightsAdapter.js';
import { bundleUrl, fetchGrants } from '../../editors/model.js';
import type { AnchorRef } from '../../editors/protocol.js';
import { readThemeTokens } from '../../editors/theme.js';
import { useRoute } from '../../hooks/useRoute.js';
import { InsightsDecide } from './InsightsDecide.js';

/** Crew's insights read narrowed to ONE review run's own review (G2): what that run found, and nothing else. */
export function insightsOfRun(r: InsightsResponse, runId: string): InsightsResponse {
  const reviews = r.reviews.filter((x) => x.runId === runId);
  // The counts are this review's own, never the daemon-wide ones (review r1).
  const newRecommendations = reviews.reduce((n, x) => n + x.recommendations.filter((rec) => rec.state === 'new').length, 0);
  return { ...r, reviews, newRecommendations, lastReview: null };
}

/** While this run's review has no final record yet, the card reads again this often: crew ingests a finished review on
 *  its scheduler's sweep (about a minute), after the run itself has ended (review r1). */
const PENDING_POLL_MS = 15_000;
/** …for at most this long, then the line says so and a reload reads again. */
const PENDING_POLL_MAX_MS = 10 * 60_000;

type Phase =
  | { kind: 'loading' }
  | { kind: 'said'; text: string }
  | { kind: 'ready'; editor: EditorView; data: InsightsResponse };

/**
 * G2 (PLAN S1; operator default D6): a `review-recent-work` run's Run insights, in its thread — the first-party
 * `wicked-insights` plugin on the run's OWN review (the `/insights` read filtered to `runId`), behind the morphing
 * artifact's chrome (inline → pane → full → Esc). The card is read-only: its click opens the pane (the morph's catch).
 * In the pane and full screen the host's decide aside (`InsightsDecide`, the one `/insights` uses) sits beside the
 * plugin: pick a recommendation there, then Accept or Dismiss with a reason.
 *
 * The plugin is mounted ONCE for the slot and told its surface on each morph (`setSurface`), so the frame keeps its
 * place (EP-D2).
 */
export function RunInsightsSlot(props: { runId: string; runStatus: string; size: ArtifactSize }): React.ReactElement {
  // One run's review, one instance: another run never inherits this one's picked recommendation or adapter (review r1).
  return <RunInsightsOf key={props.runId} {...props} />;
}

function RunInsightsOf({ runId, runStatus, size }: { runId: string; runStatus: string; size: ArtifactSize }): React.ReactElement {
  const { navigate } = useRoute();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [selected, setSelected] = useState<InsightsRecommendation | null>(null);
  const [metrics, setMetrics] = useState<InsightsMetricDef[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const frameBox = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<EditorHost | null>(null);
  const adapterRef = useRef<InsightsAdapter | null>(null);
  const editorIdRef = useRef<string | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // Read again when the run's status moves (a review that finishes has its report then), and keep reading while this
  // run's review has no final record: crew records it on its next sweep, after the run has ended.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const again = (): void => { if (!cancelled && Date.now() - started < PENDING_POLL_MAX_MS) timer = setTimeout(() => void read(), PENDING_POLL_MS); };
    const read = async (): Promise<void> => {
      try {
        const [all, editors] = await Promise.all([insightsApi.insights(), listEditors()]);
        if (cancelled) return;
        if (all === null) { setPhase({ kind: 'said', text: 'This version of crew does not review runs yet.' }); return; }
        const data = insightsOfRun(all, runId);
        const review = data.reviews[0];
        if (review === undefined) {
          setPhase({ kind: 'said', text: ['completed', 'failed', 'cancelled'].includes(runStatus) ? 'The review’s report is not recorded yet. It shows here once crew records it.' : 'The review is still running. Its report shows here when it ends.' });
          again();
          return;
        }
        if (review.status === 'running') again();
        const editor = editors === null ? null : editorFor(editors, INSIGHTS_KIND, 'full');
        if (editor === null) { setPhase({ kind: 'said', text: 'The Run insights plugin is not installed or is turned off. Turn it on under Build & settings → Plugins.' }); return; }
        setMetrics(data.metrics);
        // A picked recommendation shows its state as crew has it now.
        setSelected((cur) => (cur === null ? null : data.reviews.flatMap((r) => r.recommendations).find((r) => r.id === cur.id) ?? null));
        // The same editor already mounted: hand it the new read as a new version, never a second frame.
        if (adapterRef.current !== null && editorIdRef.current === editor.id) {
          const v = adapterRef.current.reload(data);
          hostRef.current?.artifactChanged(v, 'generated');
          setPhase((was) => (was.kind === 'ready' ? { ...was, data } : { kind: 'ready', editor, data }));
          return;
        }
        adapterRef.current = new InsightsAdapter(data);
        editorIdRef.current = editor.id;
        setPhase({ kind: 'ready', editor, data });
      } catch (e) {
        if (!cancelled) setPhase({ kind: 'said', text: `The review could not be read: ${e instanceof Error ? e.message : String(e)}` });
      }
    };
    void read();
    return () => { cancelled = true; if (timer !== null) clearTimeout(timer); };
  }, [runId, runStatus]);

  const editor = phase.kind === 'ready' ? phase.editor : null;
  useEffect(() => {
    const adapter = adapterRef.current;
    if (editor === null || adapter === null || frameBox.current === null) return undefined;
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
        title: `${editor.title}: this review`,
        size: sizeRef.current,
        surface: sizeRef.current === 'inline' ? 'card' : 'full',
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
          torn: (why) => setSaid(`The insights view stopped: ${why}. Close it and open it again.`),
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
      hostRef.current?.teardown('The review was closed');
      hostRef.current = null;
    };
  }, [editor]);

  // Each morph tells the one frame its surface: the card inline, the full view in the pane and full screen.
  useEffect(() => { hostRef.current?.setSurface(size === 'inline' ? 'card' : 'full'); }, [size]);

  // A theme change while it is open reaches the plugin (the observer the page's other frames keep).
  useEffect(() => {
    if (typeof MutationObserver !== 'function') return undefined;
    const seen = new MutationObserver(() => hostRef.current?.setTheme(readThemeTokens()));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => seen.disconnect();
  }, []);

  /** After a decision: re-read crew (this run's review only) and tell the plugin its artifact moved on. */
  const refresh = useCallback(async (): Promise<void> => {
    const all = await insightsApi.insights();
    const adapter = adapterRef.current;
    // A decision that settles after this card left (another run's card in its place) changes nothing here.
    if (!live.current || all === null || adapter === null) return;
    const data = insightsOfRun(all, runId);
    const v = adapter.reload(data);
    hostRef.current?.artifactChanged(v, 'generated');
    setSelected((cur) => (cur === null ? null : data.reviews.flatMap((r) => r.recommendations).find((r) => r.id === cur.id) ?? null));
  }, [runId]);

  if (phase.kind !== 'ready') {
    return <p data-testid="run-insights-state" className="wk-artifact-body wk-run-insights-state">{phase.kind === 'loading' ? 'Reading the review…' : phase.text}</p>;
  }
  const open = size !== 'inline';
  return (
    <div className="wk-run-insights-box">
    <div data-testid="run-insights" data-size={size} className={`wk-run-insights${open ? ' wk-run-insights--open' : ''}`}>
      <div ref={frameBox} data-testid="run-insights-frame" className="wk-insights-frame" />
      {/* D6: the card is read-only (its click opens the pane); deciding is in the pane and full screen. */}
      {open && (
        <InsightsDecide selected={selected} metrics={metrics} navigate={navigate} onDecided={refresh} said={said}
          hint="Pick a recommendation in this review to see its evidence and accept or dismiss it." />
      )}
    </div>
    </div>
  );
}
