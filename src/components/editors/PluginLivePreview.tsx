import { useEffect, useRef, useState } from 'react';
import { EditorHost, type HostAdapter } from '../../editors/host.js';
import { RunEventFeed } from '../../editors/runEvents.js';
import { readThemeTokens } from '../../editors/theme.js';
import type { RunPlugin } from '../../plugins/runPlugins.js';
import { SAMPLE_NAMES, SAMPLE_RUN, SAMPLE_SCOPE, sampleEvents } from '../../plugins/wicked-phase-report/samples.js';

/**
 * A run plugin's LIVE preview on the Plugins page (program DES-LEARN §2, `visuals.live`): the plugin's own sandboxed
 * frame, the same host and protocol as in a job's Details, fed ONLY its sample events (`samples.ts`) — never a real
 * run's — and granted nothing (no working document, no steering note). It draws its panel body at `scale`, under a
 * shield: it is a picture of the plugin, not something to use.
 */

const NONE: HostAdapter = {
  artifact: () => ({ kind: 'run-events', title: 'Sample events', version: 0, head: 0, readonly: true, lockedParts: [] }),
  read: async () => ({ error: 'unsupported', message: 'a preview has no artifact' }),
  versions: async () => ({ error: 'unsupported', message: 'a preview has no artifact' }),
  write: async () => ({ error: 'refused', message: 'a preview cannot write' }),
  undo: async () => ({ error: 'refused', message: 'a preview cannot write' }),
  fork: async () => ({ error: 'refused', message: 'a preview cannot write' }),
};

export function PluginLivePreview({ plugin, scale, testId }: { plugin: RunPlugin; scale: number; testId: string }): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<EditorHost | null>(null);
  const [torn, setTorn] = useState(false);
  useEffect(() => {
    if (box.current === null) return undefined;
    const url = URL.createObjectURL(new Blob([plugin.html], { type: 'text/html' }));
    const host = new EditorHost({
      container: box.current,
      src: url,
      editor: plugin.id,
      version: plugin.version,
      name: plugin.title,
      title: `${plugin.title}: a preview on sample events`,
      size: 'inline',
      surface: 'card',
      grants: [],
      theme: readThemeTokens(),
      prefs: { reducedMotion: true, techDetails: false, locale: navigator.language },
      firstParty: plugin.firstParty,
      adapter: NONE,
      heightRange: { min: 28, max: 1600 },
      events: {
        runId: SAMPLE_RUN,
        topics: plugin.granted,
        scope: SAMPLE_SCOPE,
        panel: { slot: 'run.details', id: 'preview' },
        subscribe: (deliver) => {
          const feed = new RunEventFeed({
            runId: SAMPLE_RUN,
            granted: plugin.granted,
            history: async () => sampleEvents(Date.now()),
            live: () => () => undefined,
            names: (cli) => SAMPLE_NAMES[cli] ?? null,
            deliver,
          });
          feed.start();
          return () => feed.stop();
        },
      },
      ui: {
        chips: () => undefined, draft: () => undefined, typed: () => undefined, key: () => undefined, morph: () => undefined,
        status: () => undefined, notes: () => undefined, thread: () => undefined, fullscreen: async () => false,
        torn: () => setTorn(true), log: () => undefined,
        surfaces: (_s, protocol) => { if (protocol < 3) queueMicrotask(() => host.teardown('no events')); else queueMicrotask(() => host.setFold(false)); },
      },
    });
    host.frame.setAttribute('data-testid', `${testId}-frame`);
    host.frame.setAttribute('tabindex', '-1');
    hostRef.current = host;
    host.mount();
    return () => { host.teardown('The preview was closed'); hostRef.current = null; URL.revokeObjectURL(url); };
  }, [plugin.id, plugin.html]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof MutationObserver !== 'function') return undefined;
    // A theme switch repaints the preview in the page's new tokens.
    const seen = new MutationObserver(() => hostRef.current?.setTheme(readThemeTokens()));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => seen.disconnect();
  }, []);

  return (
    <div data-testid={testId} className="wk-plugcard-live" aria-hidden="true" data-torn={torn ? 'true' : 'false'}>
      <div ref={box} className="wk-plugcard-live-frame" style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})` }} />
    </div>
  );
}
