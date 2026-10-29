import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { EditorHost, type HostAdapter, type HostDoc, type HostLogEntry } from '../../editors/host.js';
import { ensureWorkingDoc, getWorkingDoc, proposeWorkingDoc, type WorkingDocSectionId } from '../../api/workingDoc.js';
import { ApiError } from '../../api/errors.js';
import { useWorkingDocs } from '../../store/workingDocs.js';
import { RunEventFeed, type EventsBatch } from '../../editors/runEvents.js';
import { readThemeTokens } from '../../editors/theme.js';
import { subscribeCoreEvents } from '../../hooks/eventTap.js';
import { useRoster } from '../../hooks/useRoster.js';
import { seatLabel } from '../../board/seatNames.js';
import { stepLabelOf } from '../../board/chainModel.js';
import { RUN_PLUGINS, topicWords, type RunPlugin } from '../../plugins/runPlugins.js';
import { useBlockView, useRunPluginView } from '../../store/runPluginView.js';
import { useConnectionStore } from '../../store/connection.js';

/**
 * THE RUN-THREAD PLUGIN SLOT (program DES-PLUGIN-EVENTS §4 step 1; operator placement 2026-10-28).
 *
 * One sandboxed block per run-thread plugin, in the run's thread at its first unit. It is the editor host
 * (`EditorHost`: `sandbox="allow-scripts"`, the one-time handshake, a MessagePort, strict parsing, pings) on protocol 3:
 * the plugin is granted NO request (every artifact request answers `not_granted`), and hears only `events.batch` —
 * the run's durable log replayed (`GET /runs/:id/events?type=…`, only the types its granted topics are made from),
 * then live frames from the page's one `/ws` — plus `host.fold`. The fold, the pin and the attribution line are the
 * host's own chrome; the plugin draws the summary and the dashboard inside its frame.
 */

/** Rows at the unit they are about that are UPDATES (a jump row): the plan's own rows describe the future. */
const NOT_AN_UPDATE = new Set(['wicked.run.unit.planned', 'wicked.run.unit.assigned']);

/** A plugin that only observes has no artifact: every artifact request is refused. */
const NO_ARTIFACT: HostAdapter = {
  artifact: () => ({ kind: 'run-events', title: 'Run events', version: 0, head: 0, readonly: true, lockedParts: [] }),
  read: async () => ({ error: 'unsupported', message: 'an observing plugin has no artifact' }),
  versions: async () => ({ error: 'unsupported', message: 'an observing plugin has no artifact' }),
  write: async () => ({ error: 'refused', message: 'an observing plugin cannot write' }),
  undo: async () => ({ error: 'refused', message: 'an observing plugin cannot write' }),
  fork: async () => ({ error: 'refused', message: 'an observing plugin cannot write' }),
};

/** The block's frame, renamed from the editor host's `editor-frame`. */
const RUN_FRAME_TESTID = /* testid */ 'run-plugin-iframe';

/** The first unit the block sits at: rows about it never get a jump row. */
const FIRST_ORD = 1;

/** The block's element id, which a jump scrolls to. */
export function runPluginBlockId(runId: string, pluginId: string): string { return `run-plugin-${pluginId}-${runId}`; }

export function attributionLine(p: Pick<RunPlugin, 'title' | 'version'>): string {
  return `From plugin · ${p.title} ${p.version} · observes run events`;
}

export function RunThreadPlugin({ runId, plugin, placement }: { runId: string; plugin: RunPlugin; placement: 'thread' | 'pinned' }): React.ReactElement {
  const view = useBlockView(runId, plugin.id);
  const setFolded = useRunPluginView((s) => s.setFolded);
  const setPinned = useRunPluginView((s) => s.setPinned);
  const heard = useRunPluginView((s) => s.heard);
  const roster = useRoster();
  const names = useRef<(cli: string) => string | null>(() => null);
  names.current = (cli) => {
    const seat = roster?.find((r) => r.key === cli);
    return seat !== undefined ? seatLabel(seat) : null;
  };
  const frameBox = useRef<HTMLDivElement | null>(null);
  const block = useRef<HTMLElement | null>(null);
  const hostRef = useRef<EditorHost | null>(null);
  const foldedRef = useRef(view.folded);
  foldedRef.current = view.folded;
  const [height, setHeight] = useState<number>(34);
  const [torn, setTorn] = useState<string | null>(null);
  const [mountKey, setMountKey] = useState(0);
  const [flash, setFlash] = useState<'highlight' | 'pulse' | null>(null);
  const log = useRef<HostLogEntry[]>([]);
  // A note the plugin suggested for the next step: drawn with the host's own Send, never sent by the plugin.
  const [proposal, setProposal] = useState<string | null>(null);
  const [proposalState, setProposalState] = useState<'idle' | 'sending' | 'failed'>('idle');
  const setDoc = useWorkingDocs((s) => s.set);
  const granted = (id: string): boolean => plugin.permissions.some((p) => p.id === id);

  /** The working document seam the host hands the plugin (spike 3). Crew decides the rest. */
  const docSeam = useRef<HostDoc>({
    read: async () => {
      try {
        const view = await getWorkingDoc(runId);
        if (view === null) return { error: 'unavailable', message: 'this version of studio’s service keeps no working document' };
        setDoc(runId, view);
        return { view };
      } catch (e) {
        return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) };
      }
    },
    propose: async (edit, by) => {
      try {
        let base = edit.base;
        if (base < 0) {
          // A plugin's own lines never START a working document; a person's first edit does.
          if (by === 'plugin') return { error: 'refused', message: 'this job has no working document yet' };
          base = (await ensureWorkingDoc(runId)).doc?.head ?? 0;
        }
        const r = await proposeWorkingDoc(runId, {
          base, author: by, plugin: { id: plugin.id, version: plugin.version },
          sections: { [edit.section as WorkingDocSectionId]: edit.text },
        });
        setDoc(runId, r.view);
        return { version: r.version, unchanged: r.unchanged, by };
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return { error: 'head_moved', message: 'the working document changed since' };
        if (e instanceof ApiError && (e.status === 403 || e.status === 400)) return { error: 'refused', message: e.message };
        return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  useEffect(() => {
    if (frameBox.current === null) return undefined;
    setTorn(null);
    const url = URL.createObjectURL(new Blob([plugin.html], { type: 'text/html' }));
    const host = new EditorHost({
      container: frameBox.current,
      src: url,
      editor: plugin.id,
      version: plugin.version,
      name: plugin.title,
      title: `${plugin.title}: this job`,
      size: 'inline',
      surface: 'card',
      // Run-thread requests only, each one its manifest asked for (a built-in plugin is pre-granted them).
      grants: plugin.permissions.map((p) => p.id),
      ...(granted('doc.read') || granted('doc.propose_edit') ? { doc: docSeam.current } : {}),
      theme: readThemeTokens(),
      prefs: { reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, techDetails: false, locale: navigator.language },
      firstParty: plugin.firstParty,
      adapter: NO_ARTIFACT,
      heightRange: { min: 28, max: 1600 },
      events: {
        runId,
        topics: plugin.granted,
        subscribe: (deliver) => {
          const feed = new RunEventFeed({
            runId,
            granted: plugin.granted,
            history: async (types) => (await api.getRunEvents(runId, types)).events,
            live: subscribeCoreEvents,
            names: (cli) => names.current(cli),
            deliver: (batch: EventsBatch) => {
              deliver(batch);
              const ords = [...new Set(batch.rows.filter((r) => r.ord !== null && r.ord > FIRST_ORD && !NOT_AN_UPDATE.has(r.topic)).map((r) => r.ord as number))];
              const steps: Record<number, string> = {};
              for (const r of batch.rows) if (r.topic === 'wicked.run.unit.planned' && r.ord !== null && typeof r.data['step'] === 'string') steps[r.ord] = stepLabelOf(r.data['step']);
              heard(runId, plugin.id, ords, !batch.replay && batch.rows.length > 0, steps);
            },
          });
          feed.start();
          return () => feed.stop();
        },
      },
      ui: {
        chips: () => undefined, draft: () => undefined, typed: () => undefined, key: () => undefined, morph: () => undefined,
        status: () => undefined, notes: () => undefined, thread: () => undefined, fullscreen: async () => false,
        torn: (reason) => setTorn(reason),
        log: (e) => { log.current.push(e); if (log.current.length > 200) log.current.shift(); },
        surfaces: (_s, protocol) => {
          // A run-thread block is protocol 3 or nothing: a plugin that cannot hear events has nothing to show here.
          if (protocol < 3) { queueMicrotask(() => hostRef.current?.teardown('This plugin can’t hear run events')); return; }
          queueMicrotask(() => hostRef.current?.setFold(foldedRef.current));
        },
        cardHeight: (px) => setHeight(px),
        fold: (folded) => setFolded(runId, plugin.id, folded),
        steerProposal: (text) => { setProposal(text.slice(0, 600)); setProposalState('idle'); },
      },
    });
    // Its own name, so "the editor frames on the page" (artifact cards) never counts a run-thread block.
    host.frame.setAttribute('data-testid', RUN_FRAME_TESTID);
    host.frame.classList.add('wk-runplugin-iframe');
    hostRef.current = host;
    host.mount();
    return () => {
      host.teardown('The block was closed');
      hostRef.current = null;
      URL.revokeObjectURL(url);
    };
    // One frame per mount; "Reload it" remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, plugin.id, plugin.html, mountKey]);

  // The working document changed (crew's `workingDocChanged` frame): the plugin re-reads it, the thread rows follow.
  useEffect(() => subscribeCoreEvents((e) => {
    const ev = e as unknown as { type: string; session?: unknown; head?: unknown };
    if (ev.type !== 'workingDocChanged' || ev.session !== runId) return;
    hostRef.current?.docChanged(typeof ev.head === 'number' ? ev.head : null);
    if (!granted('doc.read')) void getWorkingDoc(runId).then((v) => { if (v !== null) setDoc(runId, v); }).catch(() => undefined);
  }), [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The host's own Send for a suggested note: a person's click adds it to "Next and trailing work" as their edit. */
  const sendProposal = async (): Promise<void> => {
    if (proposal === null) return;
    setProposalState('sending');
    try {
      const current = useWorkingDocs.getState().byRun[runId];
      const base = current?.doc?.head ?? (await ensureWorkingDoc(runId)).doc?.head ?? 0;
      const next = [current?.sections?.next ?? '', proposal].filter((x) => x.trim() !== '').join('\n');
      const r = await proposeWorkingDoc(runId, { base, author: 'operator', plugin: { id: plugin.id, version: plugin.version }, sections: { next } });
      setDoc(runId, r.view);
      hostRef.current?.docChanged(r.version);
      setProposal(null);
    } catch {
      setProposalState('failed');
    }
  };

  // The host owns the fold: every change of it is said to the plugin.
  useEffect(() => { hostRef.current?.setFold(view.folded); }, [view.folded]);

  useEffect(() => {
    if (typeof MutationObserver !== 'function') return undefined;
    const seen = new MutationObserver(() => hostRef.current?.setTheme(readThemeTokens()));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => seen.disconnect();
  }, []);

  // A jump row was pressed: the block comes into view, unfolded, highlighted for a moment. Only a jump made while
  // THIS block is mounted lights it (a remount — pin, unpin, a new visit — never replays an old one).
  const seenHighlight = useRef(view.highlight);
  useEffect(() => {
    // The session thread scrolls to it (SessionView: it owns the thread's follow); the block only lights up.
    if (view.highlight === seenHighlight.current) return undefined;
    seenHighlight.current = view.highlight;
    setFlash('highlight');
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [view.highlight]);

  // Pinned: a live update pulses the summary instead of adding jump rows (only an update heard while mounted).
  const seenPulse = useRef(view.pulse);
  useEffect(() => {
    if (view.pulse === seenPulse.current) return undefined;
    seenPulse.current = view.pulse;
    if (!view.pinned) return undefined;
    setFlash('pulse');
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [view.pulse, view.pinned]);

  // Pin and unpin move the block (it remounts at its other place): the Pin button keeps the keyboard focus.
  const pinButton = useRef<HTMLButtonElement | null>(null);
  const takeFocus = useRunPluginView((s) => s.takePinFocus);
  useEffect(() => { if (takeFocus(runId, plugin.id)) pinButton.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // /ws has no replay: after the socket was lost and came back, the block is rebuilt from the run's durable log, so
  // nothing that happened while it was down is missing.
  const connection = useConnectionStore((s) => s.status);
  const wasUp = useRef(connection === 'connected');
  const lost = useRef(false);
  useEffect(() => {
    if (connection === 'connected') {
      if (lost.current) { lost.current = false; setMountKey((n) => n + 1); }
      wasUp.current = true;
    } else if (wasUp.current) lost.current = true;
  }, [connection]);

  const topics = plugin.granted.map(topicWords).join('; ');
  const pinLabel = view.pinned ? `Unpin ${plugin.title}: back to its place in the conversation` : `Pin ${plugin.title} to the top of the conversation`;
  const foldLabel = view.folded ? `Show the ${plugin.title.toLowerCase()}` : `Fold the ${plugin.title.toLowerCase()}`;
  return (
    <section
      ref={block}
      id={runPluginBlockId(runId, plugin.id)}
      data-testid="run-plugin"
      data-plugin={plugin.id}
      data-run-id={runId}
      data-pinned={view.pinned ? 'true' : 'false'}
      data-folded={view.folded ? 'true' : 'false'}
      data-placement={placement}
      {...(flash !== null ? { 'data-flash': flash } : {})}
      aria-label={`${plugin.title}, a plugin`}
      className={`wk-runplugin${view.folded ? ' wk-runplugin--folded' : ''}${placement === 'pinned' ? ' wk-runplugin--pinned' : ''}${flash !== null ? ` wk-runplugin--${flash}` : ''}`}
    >
      <p className="wk-runplugin-title" data-testid="run-plugin-title">
        <span aria-hidden className="wk-hpanel-dot" />{plugin.title}
        <span className="wk-tag" data-testid="run-plugin-grant" title={`Built in: it was given these without asking. It hears ${topics}.`}>Built in · pre-granted</span>
      </p>
      <div className="wk-runplugin-tools">
        <button type="button" ref={pinButton} data-testid="run-plugin-pin" aria-pressed={view.pinned} aria-label={pinLabel} title={pinLabel}
          onClick={(e) => setPinned(runId, plugin.id, !view.pinned, e.detail === 0 || document.activeElement === e.currentTarget)} className="wk-runplugin-btn">
          <svg aria-hidden viewBox="0 0 16 16" width="14" height="14"><path d="M10.5 1.5 14.5 5.5 12 6.5 9.5 9l.5 3.5-1 1-3-3L3 13.5l-.5-.5L5.5 10l-3-3 1-1L7 6.5 9.5 4z" fill={view.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" data-testid="run-plugin-fold" aria-expanded={!view.folded} aria-label={foldLabel} title={foldLabel}
          onClick={() => setFolded(runId, plugin.id, !view.folded)} className="wk-runplugin-btn">
          <svg aria-hidden viewBox="0 0 16 16" width="14" height="14"><path d={view.folded ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div ref={frameBox} data-testid="run-plugin-frame" className="wk-runplugin-frame" style={{ height: torn === null ? height : 0 }} key={mountKey} />
      {torn !== null && (
        <p data-testid="run-plugin-torn" role="status" className="wk-runplugin-torn">
          {plugin.title} stopped: {torn}.{' '}
          <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => setMountKey((n) => n + 1)}>Reload it</button>
        </p>
      )}
      {proposal !== null && (
        <div data-testid="run-plugin-proposal" className="wk-runplugin-proposal" role="group" aria-label={`${plugin.title} suggests a note for the next step`}>
          <p className="wk-runplugin-proposal-text"><span className="wk-runplugin-proposal-who">{plugin.title} suggests telling the next step:</span> “{proposal}”</p>
          <p className="wk-runplugin-proposal-acts">
            <button type="button" data-testid="run-plugin-proposal-send" disabled={proposalState === 'sending'} className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => { void sendProposal(); }}>
              {proposalState === 'sending' ? 'Sending…' : 'Send to the next step'}
            </button>
            <button type="button" data-testid="run-plugin-proposal-dismiss" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => setProposal(null)}>Dismiss</button>
            {proposalState === 'failed' && <span className="wk-session-grey"> It didn’t go through.</span>}
          </p>
        </div>
      )}
      <p data-testid="run-plugin-attribution" className="wk-runplugin-foot" title={`It hears ${topics}. It can’t change anything.`}>{attributionLine(plugin)}</p>
    </section>
  );
}

/** Every run-thread plugin's block for one run, at one placement: pinned ones at the top, the rest at the first unit. */
export function RunThreadPlugins({ runId, placement }: { runId: string; placement: 'thread' | 'pinned' }): React.ReactElement | null {
  const blocks = useRunPluginView((s) => s.blocks);
  const shown = useMemo(() => RUN_PLUGINS.filter((p) => (blocks[`${runId}::${p.id}`]?.pinned ?? readPinnedSafe(runId, p.id)) === (placement === 'pinned')), [blocks, runId, placement]);
  if (shown.length === 0) return null;
  return (
    <div data-testid={placement === 'pinned' ? 'run-plugins-pinned-run' : 'run-plugins'} className="wk-runplugins">
      {shown.map((p) => <RunThreadPlugin key={p.id} runId={runId} plugin={p} placement={placement} />)}
    </div>
  );
}

/** The ONE sticky strip at the top of the thread holding every pinned block of the session's runs, stacked: two
 *  pinned runs never sit in the same place. Nothing pinned = nothing drawn. */
export function PinnedRunPlugins({ runIds }: { runIds: readonly string[] }): React.ReactElement | null {
  const blocks = useRunPluginView((s) => s.blocks);
  const any = runIds.some((r) => RUN_PLUGINS.some((p) => blocks[`${r}::${p.id}`]?.pinned ?? readPinnedSafe(r, p.id)));
  if (!any) return null;
  return (
    <div data-testid="run-plugins-pinned" className="wk-runplugins-pinned">
      {runIds.map((r) => <RunThreadPlugins key={r} runId={r} placement="pinned" />)}
    </div>
  );
}

function readPinnedSafe(runId: string, pluginId: string): boolean {
  return useRunPluginView.getState().view(runId, pluginId).pinned;
}

/** "Phase report updated · Jump ↑": one per unit the plugin heard an update about, at that unit, while unpinned. */
export function RunPluginJumpRows({ runId, ords, except }: { runId: string; ords?: readonly number[]; except?: readonly number[] }): React.ReactElement | null {
  const blocks = useRunPluginView((s) => s.blocks);
  const jump = useRunPluginView((s) => s.jump);
  const rows = RUN_PLUGINS.flatMap((p) => {
    const b = blocks[`${runId}::${p.id}`];
    if (b === undefined || b.pinned) return [];
    // `ords`: the rows at these units; else every unit not in `except` (the step running now has no message yet).
    if (ords !== undefined) return ords.filter((o) => b.updatedOrds.includes(o)).map((o) => ({ p, o }));
    // The rest (steps with no message of their own yet, the one running now): one row, at the newest of them.
    const rest = b.updatedOrds.filter((o) => !(except ?? []).includes(o));
    return rest.length > 0 ? [{ p, o: rest[rest.length - 1]! }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map(({ p, o }) => (
        <p key={`${p.id}-${o}`} data-testid="run-plugin-updated" data-plugin={p.id} data-ord={o} className="wk-runplugin-updated">
          <span aria-hidden className="wk-hpanel-dot" />
          {/* The step it is about, by the plan's own word, so two rows in a row never read the same. */}
          <span>{p.title} updated{blocks[`${runId}::${p.id}`]?.steps[o] !== undefined ? ` · ${blocks[`${runId}::${p.id}`]!.steps[o]}` : ''}</span>
          <button type="button" data-testid="run-plugin-jump" className="wk-chat-link" aria-label={`Jump to the ${p.title.toLowerCase()} and show it`}
            onClick={() => jump(runId, p.id)}>Jump ↑</button>
        </p>
      ))}
    </>
  );
}

const SECTION_WORDS: Record<string, string> = {
  goal: 'Goal', approach: 'Approach', decisions: 'Decisions', constraints: 'Constraints', questions: 'Open questions', next: 'Next work',
};

/** One steering note's thread row words: "You edited the working document · Constraints · picked up at Review". */
export function steerRowWords(by: string, sections: readonly string[], s: { pickedUp: { step: string | null; ord: number | null } | null; error: string | null }): string {
  const who = by === 'local' ? 'You' : by;
  const where = s.error !== null ? `not sent: ${s.error}`
    : s.pickedUp !== null ? `picked up at ${s.pickedUp.step !== null ? stepLabelOf(s.pickedUp.step) : `step ${s.pickedUp.ord ?? '?'}`}`
    : 'waiting for the next step';
  return `${who} edited the working document · ${sections.map((x) => SECTION_WORDS[x] ?? x).join(', ')} · ${where}`;
}

/**
 * The working document's steering notes in the thread (power mode spike 3), one slim row each, at the step that picked
 * it up (`ords`), or — not picked up yet, or picked up by a step with no message — after the last step (`except`).
 */
export function WorkingDocSteerRows({ runId, ords, except }: { runId: string; ords?: readonly number[]; except?: readonly number[] }): React.ReactElement | null {
  const view = useWorkingDocs((s) => s.byRun[runId]);
  if (view === undefined) return null;
  const rows = view.steers.filter((s) => {
    const at = s.pickedUp?.ord ?? null;
    if (ords !== undefined) return at !== null && ords.includes(at);
    return at === null || !(except ?? []).includes(at);
  });
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((s) => (
        <p key={s.id} data-testid="working-doc-steer" data-steer={s.id} data-picked={s.pickedUp !== null ? 'true' : 'false'} className="wk-runplugin-updated wk-workingdoc-steer">
          <span aria-hidden className="wk-hpanel-dot" />
          <span>{steerRowWords(s.by, s.sections, s)}</span>
        </p>
      ))}
    </>
  );
}
