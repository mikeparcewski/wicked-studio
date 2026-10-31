import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { EditorHost, type HostAdapter, type HostLogEntry } from '../../editors/host.js';
import { RUN_TAB, useHostPanel, PANEL_RIBBON_BELOW_PX } from '../../editors/hostApi.js';
import { workingDocSeam } from './workingDocSeam.js';
import { useWorkingDocs } from '../../store/workingDocs.js';
import { RunEventFeed, type EventsBatch } from '../../editors/runEvents.js';
import { readThemeTokens } from '../../editors/theme.js';
import { subscribeCoreEvents } from '../../hooks/eventTap.js';
import { useRoster } from '../../hooks/useRoster.js';
import { seatLabel } from '../../board/seatNames.js';
import { stepLabelOf } from '../../board/chainModel.js';
import { pickedUpStep } from '../../plugins/wicked-phase-report/workingDoc.js';
import { pluginSectionOpen, sectionKey, type PluginSection } from '../../board/runPluginPanels.js';
import { RUN_PLUGINS, topicWords, type RunPlugin } from '../../plugins/runPlugins.js';
import { useBlockView, useRunPluginView, type RunPhase } from '../../store/runPluginView.js';
import { useRunPanel } from '../../store/runPanel.js';
import { useConnectionStore } from '../../store/connection.js';

/**
 * RUN PLUGINS IN THE DETAILS PANEL (program DES-LEARN §1.2; operator 2026-10-30: the phase reports move from the thread
 * to the run's right panel, as plugin-registered sections).
 *
 * A run plugin's manifest registers sections (`panels[]`, `src/board/runPluginPanels.ts`); the run's Details panel
 * draws each in order beside its own sections. The section's CHROME is the host's: the fold, the title, the "Plugin"
 * mark, the plugin's one-line summary (`panel.summary`), Pin (to the top of the panel) and the attribution line. The
 * BODY is the same sandboxed plugin as before: the editor host (`EditorHost`: `sandbox="allow-scripts"`, the one-time
 * handshake, a MessagePort, strict parsing, pings) on protocol 3, hearing only `events.batch` (the run's durable log
 * replayed, then live frames from the page's one `/ws`) and `host.fold` — one instance per phase in a power build.
 *
 * The thread keeps only slim rows: "Phase report · Build updated · Show in Details" opens the section and lights it.
 */

/** Rows at the unit they are about that are UPDATES (a thread row): the plan's own rows describe the future. */
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

/** The section's frame, renamed from the editor host's `editor-frame`. */
const RUN_FRAME_TESTID = /* testid */ 'run-plugin-iframe';

/** The first unit of a run: rows about it never get a thread row (the section opens on the run's start anyway). */
const FIRST_ORD = 1;

/** A section's element id, which Show in Details brings into view. */
export function runPluginBlockId(runId: string, key: string): string { return `run-plugin-${key.replace(/:/g, '-')}-${runId}`; }

export function attributionLine(p: Pick<RunPlugin, 'title' | 'version'>): string {
  return `From plugin · ${p.title} ${p.version} · observes run events`;
}

export type { RunPhase };

/**
 * Show in Details: the run's panel opens on the run (the overlay below 1200 px), the section opens — remembered for this
 * run — and comes into view, lit for a moment.
 */
export function showInDetails(sessionId: string | null, runId: string, key: string): void {
  if (sessionId !== null) useRunPanel.getState().pick(sessionId, runId);
  const hp = useHostPanel.getState();
  hp.setTab(RUN_TAB);
  const narrow = typeof matchMedia === 'function' && matchMedia(`(max-width: ${PANEL_RIBBON_BELOW_PX - 1}px)`).matches;
  if (narrow) hp.setOverlay(true); else hp.setFolded(false);
  useRunPluginView.getState().reveal(runId, key);
}

const TONE_WORDS: Record<string, string> = { run: 'working', wait: 'waiting on you', ok: 'done', fail: 'did not pass', none: '' };

/** One plugin section in the run's Details panel. `live` = the run has not ended. */
export function RunPluginSection({ runId, plugin, section, live }: { runId: string; plugin: RunPlugin; section: PluginSection; live: boolean }): React.ReactElement {
  const key = section.key;
  const phase = section.phase;
  const view = useBlockView(runId, key);
  const mine = useRunPluginView((s) => s.open[runId]?.[key]);
  const open = pluginSectionOpen(section, live, mine);
  const setOpen = useRunPluginView((s) => s.setOpen);
  const setPinned = useRunPluginView((s) => s.setPinned);
  const heard = useRunPluginView((s) => s.heard);
  const said = useRunPluginView((s) => s.said);
  const roster = useRoster();
  const names = useRef<(cli: string) => string | null>(() => null);
  names.current = (cli) => {
    const seat = roster?.find((r) => r.key === cli);
    return seat !== undefined ? seatLabel(seat) : null;
  };
  const frameBox = useRef<HTMLDivElement | null>(null);
  const phaseOrds = useRef<number[] | null>(phase?.ords ?? null);
  phaseOrds.current = phase?.ords ?? null;
  const block = useRef<HTMLElement | null>(null);
  const hostRef = useRef<EditorHost | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
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

  // The run and plugin the seam acts for, read at call time (a section reused for another run never writes the old one).
  const current = useRef({ runId, plugin });
  current.current = { runId, plugin };
  /** The working document seam the host hands the plugin (spike 3; `workingDocSeam.ts`). Crew decides the rest. */
  const docSeam = useRef(workingDocSeam({ current: () => current.current, land: (r, v) => setDoc(r, v) }));
  // A suggestion belongs to the run it was made on.
  useEffect(() => { setProposal(null); setProposalState('idle'); }, [runId]);

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
      title: `${plugin.title}${phase !== null ? `: ${phase.label}` : ''}: this job`,
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
        ...(phase !== null ? { scope: { phase: phase.key, label: phase.label, ords: phase.ords } } : {}),
        panel: { slot: 'run.details', id: section.panel.id }, // pluginSections keeps run.details only
        subscribe: (deliver) => {
          const feed = new RunEventFeed({
            runId,
            granted: plugin.granted,
            history: async (types) => (await api.getRunEvents(runId, types)).events,
            live: subscribeCoreEvents,
            names: (cli) => names.current(cli),
            deliver: (batch: EventsBatch) => {
              deliver(batch);
              const ords = [...new Set(batch.rows.filter((r) => r.ord !== null && r.ord > FIRST_ORD && !NOT_AN_UPDATE.has(r.topic) && (phaseOrds.current === null || phaseOrds.current.includes(r.ord))).map((r) => r.ord as number))];
              const steps: Record<number, string> = {};
              for (const r of batch.rows) if (r.topic === 'wicked.run.unit.planned' && r.ord !== null && typeof r.data['step'] === 'string') steps[r.ord] = stepLabelOf(r.data['step']);
              heard(runId, key, ords, !batch.replay && ords.length > 0, steps);
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
          // A run plugin is protocol 3 or nothing: a plugin that cannot hear events has nothing to show here.
          if (protocol < 3) { queueMicrotask(() => hostRef.current?.teardown('This plugin can’t hear run events')); return; }
          queueMicrotask(() => hostRef.current?.setFold(!openRef.current));
        },
        cardHeight: (px) => setHeight(px),
        // The plugin's own fold control (an older one draws its summary line): the section folds or opens.
        fold: (folded) => setOpen(runId, key, !folded),
        steerProposal: (text) => { setProposal(text.slice(0, 600)); setProposalState('idle'); },
        panelSummary: (s) => said(runId, key, s),
      },
    });
    // Its own name, so "the editor frames on the page" (artifact cards) never counts a run plugin.
    host.frame.setAttribute('data-testid', RUN_FRAME_TESTID);
    host.frame.classList.add('wk-runplugin-iframe');
    hostRef.current = host;
    host.mount();
    return () => {
      host.teardown('The section was closed');
      hostRef.current = null;
      URL.revokeObjectURL(url);
    };
    // One frame per mount; "Reload it" remounts; a phase whose units changed is another scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, plugin.id, plugin.html, mountKey, phase?.key, phase?.ords.join(',')]);

  // The working document changed (crew's `workingDocChanged` frame): the plugin re-reads it, the thread rows follow.
  useEffect(() => subscribeCoreEvents((e) => {
    const ev = e as unknown as { type: string; session?: unknown; head?: unknown };
    if (ev.type !== 'workingDocChanged' || ev.session !== runId) return;
    hostRef.current?.docChanged(typeof ev.head === 'number' ? ev.head : null);
    if (!granted('doc.read')) void docSeam.current.read();
  }), [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The host's own Send for a suggested note: a person's click adds it to "Next and trailing work" as their edit. */
  const sendProposal = async (): Promise<void> => {
    if (proposal === null) return;
    setProposalState('sending');
    try {
      const v = await docSeam.current.appendToNext(proposal, useWorkingDocs.getState().byRun[runId]);
      hostRef.current?.docChanged(v.doc?.head ?? null);
      setProposal(null);
    } catch {
      setProposalState('failed');
    }
  };

  // The host owns the fold: every change of it is said to the plugin (a folded section's frame draws nothing).
  useEffect(() => { hostRef.current?.setFold(!open); }, [open]);

  useEffect(() => {
    if (typeof MutationObserver !== 'function') return undefined;
    const seen = new MutationObserver(() => hostRef.current?.setTheme(readThemeTokens()));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => seen.disconnect();
  }, []);

  // Show in Details: the section comes into view and lights up for a moment. Only a reveal made while THIS section is
  // mounted lights it (a remount — pin, unpin, a new visit — never replays an old one).
  const seenHighlight = useRef(view.highlight);
  useEffect(() => {
    if (view.highlight === seenHighlight.current) return undefined;
    seenHighlight.current = view.highlight;
    block.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    setFlash('highlight');
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [view.highlight]);

  // Pinned: a live update pulses the heading (only an update heard while mounted).
  const seenPulse = useRef(view.pulse);
  useEffect(() => {
    if (view.pulse === seenPulse.current) return undefined;
    seenPulse.current = view.pulse;
    if (!view.pinned) return undefined;
    setFlash('pulse');
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [view.pulse, view.pinned]);

  // Pin and unpin move the section (it remounts at its other place): the Pin button keeps the keyboard focus.
  const pinButton = useRef<HTMLButtonElement | null>(null);
  const takeFocus = useRunPluginView((s) => s.takePinFocus);
  useEffect(() => { if (takeFocus(runId, key)) pinButton.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // /ws has no replay: after the socket was lost and came back, the section is rebuilt from the run's durable log, so
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
  const pinLabel = view.pinned ? `Unpin ${section.title}: back to its place in the panel` : `Pin ${section.title} to the top of the panel`;
  const body = `${runPluginBlockId(runId, key)}-body`;
  const summary = section.panel.summary === 'plugin' ? view.summary : null;
  return (
    <section
      ref={block}
      id={runPluginBlockId(runId, key)}
      data-testid="run-plugin"
      data-plugin={plugin.id}
      data-section-key={key}
      data-order={section.order}
      {...(phase !== null ? { 'data-phase': phase.key, 'data-current': phase.current ? 'true' : 'false' } : {})}
      data-run-id={runId}
      data-pinned={view.pinned ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
      data-folded={open ? 'false' : 'true'}
      {...(flash !== null ? { 'data-flash': flash } : {})}
      className={`wk-rp-section wk-runplugin${view.pinned ? ' wk-runplugin--pinned' : ''}${flash !== null ? ` wk-runplugin--${flash}` : ''}`}
    >
      <h3 className="wk-rp-heading wk-runplugin-heading">
        <button type="button" data-testid="run-plugin-fold" aria-expanded={open} aria-controls={body}
          onClick={() => setOpen(runId, key, !open)} className="wk-rp-toggle">
          <span aria-hidden className="wk-rp-chevron" />
          <span className="wk-rp-label" data-testid="run-plugin-title">{section.title}</span>
          <span className="wk-runplugin-mark" data-testid="run-plugin-grant" title={`From the ${plugin.title} plugin (built in, pre-granted). It hears ${topics}.`}>
            <svg aria-hidden viewBox="0 0 16 16" width="11" height="11"><path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Plugin
          </span>
          {summary !== null && summary.text !== '' && (
            <span data-testid="run-plugin-summary" data-tone={summary.tone} className="wk-runplugin-summary" title={summary.text}>
              {summary.tone !== 'none' && <span aria-hidden className="wk-runplugin-dot" data-tone={summary.tone} />}
              {summary.tone !== 'none' && <span className="wk-sr-only">{TONE_WORDS[summary.tone]}: </span>}
              <span className="wk-runplugin-summary-text">{summary.text}</span>
            </span>
          )}
        </button>
        <button type="button" ref={pinButton} data-testid="run-plugin-pin" aria-pressed={view.pinned} aria-label={pinLabel} title={pinLabel}
          onClick={(e) => setPinned(runId, key, !view.pinned, e.detail === 0 || document.activeElement === e.currentTarget)} className="wk-runplugin-btn">
          <svg aria-hidden viewBox="0 0 16 16" width="14" height="14"><path d="M10.5 1.5 14.5 5.5 12 6.5 9.5 9l.5 3.5-1 1-3-3L3 13.5l-.5-.5L5.5 10l-3-3 1-1L7 6.5 9.5 4z" fill={view.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        </button>
      </h3>
      {/* The frame stays mounted while folded: it keeps hearing the run, and says its heading's line. */}
      <div id={body} role="region" aria-label={`${plugin.title}: ${section.title}`} hidden={!open} className="wk-rp-body wk-runplugin-body">
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
        <p data-testid="run-plugin-attribution" className="wk-runplugin-foot" title={`It hears ${topics}. It writes only its own lines in the working document; what you type there is yours, and it never answers a decision.`}>{attributionLine(plugin)}</p>
      </div>
    </section>
  );
}

/** The run plugins with a per-phase section in the panel: each has a thread row per phase. */
function perPhase(): Array<{ plugin: RunPlugin; panelId: string }> {
  return RUN_PLUGINS.flatMap((p) => p.panels.filter((d) => d.slot === 'run.details' && d.instances === 'per-phase').map((d) => ({ plugin: p, panelId: d.id })));
}

/** The run plugins with one section for the whole run (a phased run's per-phase plugins too: it has no phases). */
function wholeRun(): Array<{ plugin: RunPlugin; panelId: string }> {
  return RUN_PLUGINS.flatMap((p) => p.panels.filter((d) => d.slot === 'run.details').map((d) => ({ plugin: p, panelId: d.id })));
}

/**
 * A power build's phase in the thread: "Phase report · Build updated · checkpoint 3 · Show in Details", at the end of
 * the phase's messages (where its block used to sit). A finished phase says "finished".
 */
export function RunPhaseRows({ sessionId, runId, phase, live }: { sessionId: string | null; runId: string; phase: RunPhase; live: boolean }): React.ReactElement | null {
  const blocks = useRunPluginView((s) => s.blocks);
  const rows = perPhase();
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map(({ plugin, panelId }) => {
        const key = sectionKey(plugin.id, panelId, phase);
        const sum = blocks[`${runId}::${key}`]?.summary ?? null;
        // A phase the run still counts as current but whose report says it is done reads as finished.
        const going = phase.current && live && sum?.tone !== 'ok';
        return (
          <p key={key} data-testid="run-plugin-updated" data-plugin={plugin.id} data-phase={phase.key} data-section-key={key} className="wk-runplugin-updated">
            <span aria-hidden className="wk-hpanel-dot" data-tone={going ? 'run' : 'done'} />
            <span className="wk-runplugin-updated-text">{plugin.title} · {phase.label} {going ? 'updated' : 'finished'}{going && sum !== null && sum.text !== '' ? ` · ${sum.text}` : ''}</span>
            <button type="button" data-testid="run-plugin-jump" className="wk-chat-link" aria-label={`Show the ${plugin.title.toLowerCase()} for ${phase.label} in Details`}
              onClick={() => showInDetails(sessionId, runId, key)}>Show in Details</button>
          </p>
        );
      })}
    </>
  );
}

/** "Phase report updated · Review · Show in Details": a phased run's rows, one per unit its section heard an update
 *  about (`ords`), or — `except` — one row at the newest unit not in it (the step running now has no message yet). */
export function RunPluginJumpRows({ sessionId = null, runId, ords, except }: { sessionId?: string | null; runId: string; ords?: readonly number[]; except?: readonly number[] }): React.ReactElement | null {
  const blocks = useRunPluginView((s) => s.blocks);
  const rows = wholeRun().flatMap(({ plugin, panelId }) => {
    const key = sectionKey(plugin.id, panelId, null);
    const b = blocks[`${runId}::${key}`];
    if (b === undefined) return [];
    if (ords !== undefined) return ords.filter((o) => b.updatedOrds.includes(o)).map((o) => ({ plugin, key, o, step: b.steps[o] }));
    const rest = b.updatedOrds.filter((o) => !(except ?? []).includes(o));
    return rest.length > 0 ? [{ plugin, key, o: rest[rest.length - 1]!, step: b.steps[rest[rest.length - 1]!] }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map(({ plugin, key, o, step }) => (
        <p key={`${key}-${o}`} data-testid="run-plugin-updated" data-plugin={plugin.id} data-ord={o} data-section-key={key} className="wk-runplugin-updated">
          <span aria-hidden className="wk-hpanel-dot" />
          {/* The step it is about, by the plan's own word, so two rows in a row never read the same. */}
          <span className="wk-runplugin-updated-text">{plugin.title} updated{step !== undefined ? ` · ${step}` : ''}</span>
          <button type="button" data-testid="run-plugin-jump" className="wk-chat-link" aria-label={`Show the ${plugin.title.toLowerCase()} in Details`}
            onClick={() => showInDetails(sessionId, runId, key)}>Show in Details</button>
        </p>
      ))}
    </>
  );
}

const SECTION_WORDS: Record<string, string> = {
  goal: 'Goal', approach: 'Approach', decisions: 'Decisions', constraints: 'Constraints', questions: 'Open questions', next: 'Next work',
};

/** One steering note's thread row words: "You edited the working document · Constraints · picked up at Review". */
export function steerRowWords(by: string, sections: readonly string[], s: { pickedUp: { step: string | null; ord: number | null } | null; error: string | null }, stepOfOrd?: (ord: number) => string | null): string {
  const who = by === 'local' ? 'You' : by;
  const where = s.error !== null ? `not sent: ${s.error}`
    : s.pickedUp !== null ? `picked up at ${pickedUpStep(s.pickedUp, stepOfOrd)}`
    : 'waiting for the next step';
  return `${who} edited the working document · ${sections.map((x) => SECTION_WORDS[x] ?? x).join(', ')} · ${where}`;
}

/**
 * The working document's steering notes in the thread (power mode spike 3), one slim row each, at the step that picked
 * it up (`ords`), or — not picked up yet, or picked up by a step with no message — after the last step (`except`).
 */
export function WorkingDocSteerRows({ runId, ords, except, stepOfOrd }: { runId: string; ords?: readonly number[]; except?: readonly number[]; stepOfOrd?: (ord: number) => string | null }): React.ReactElement | null {
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
          <span>{steerRowWords(s.by, s.sections, s, stepOfOrd)}</span>
        </p>
      ))}
    </>
  );
}
