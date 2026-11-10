import { useEffect, useRef, useState } from 'react';
import { InlineUndo } from '../InlineUndo.js';
import { Mic, Volume2, VolumeX } from 'lucide-react';
import { AskCard, AskRecord } from '../ask/AskCard.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';
import { answerAsk, closeVoice, holdToTalk, setReadAloud } from '../../voice/controller.js';
import { DASH_POLL_MS, loadDashboard, readDashboardData, useDashStore } from '../../voice/dashboardStore.js';
import { dashboardWidgets, sides } from '../../voice/widgets.js';
import { useShallow } from 'zustand/react/shallow';
import { useVoiceStore, withoutWave, type VoiceLine } from '../../store/voice.js';
import { AddWidgetButton, Widget } from './VoiceDashboard.js';
import { JobPreview } from './JobPreview.js';
import { TypeInstead } from './VoiceModal.js';
import { VoiceSetup } from './VoiceSetup.js';
import { LiveWave } from './VoiceWave.js';
import { WidgetPicker } from './WidgetPicker.js';

const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase() ?? '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable === true;
};

/**
 * Step 2 of voice mode (DES-VOICE §2a; mockup state g "Choose mode" / "Streaming" / "Gate by voice"): the
 * conversation in the middle, a scrolling transcript of constrained width and height, framed by the live system
 * dashboard. Captions are always on (the transcript IS the captions). Esc leaves. In space-bar mode Space, or the
 * held mic button, records; in a text field Space types.
 */
export function VoiceFullScreen(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const trans = useRef<HTMLDivElement>(null);
  // Everything but the waveform's bars and who is speaking (those move ~20 times a second; LiveWave reads them).
  const v = useVoiceStore(useShallow(withoutWave));
  const { layout, widgets, loaded } = useDashStore();
  const [picking, setPicking] = useState(false);
  useDialogFocus(true, ref, { modal: true, prefer: '[data-testid="voice-trans"] [data-ask-option][tabindex="0"], [data-testid="voice-exit"]' });

  useEffect(() => {
    if (!useDashStore.getState().loaded) void loadDashboard().then(() => readDashboardData());
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void readDashboardData(); }, DASH_POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { const el = trans.current; if (el !== null) el.scrollTop = el.scrollHeight; }, [v.lines]);

  const all = loaded ? dashboardWidgets(layout, widgets) : [];
  const { left, right } = sides(all);
  const modeLabel = v.mode === 'stream' ? '● Streaming' : v.mode === 'space' ? (v.holding ? '● Listening' : 'Hold Space to talk') : 'Mode not chosen';
  const foot = v.mode === 'stream'
    ? (v.transcribing ? 'Writing down what you said…' : 'Listening · pause to send · say “stop listening” or press Esc')
    : v.mode === 'space'
      ? (v.holding ? 'Listening while you hold…' : v.transcribing ? 'Writing down what you said…' : 'Hold Space, or the mic button, to talk · Esc leaves')
      : 'Say or tap how I should listen';

  return (
    <div
      ref={ref}
      className="wk-voice-full"
      role="dialog"
      aria-modal="true"
      aria-label="Voice mode"
      data-testid="voice-full"
      data-preview={v.preview !== null ? 'true' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !picking) { e.preventDefault(); e.stopPropagation(); closeVoice(); return; }
        if (e.key === ' ' && v.mode === 'space' && !typing(e.target) && !picking) { e.preventDefault(); if (!e.repeat) holdToTalk(true); }
      }}
      onKeyUp={(e) => { if (e.key === ' ' && v.mode === 'space' && !typing(e.target)) { e.preventDefault(); holdToTalk(false); } }}
    >
      <aside className="wk-voice-side" data-side="left" aria-label="System, left">
        {left.map((w) => <Widget key={w.id} w={w} />)}
      </aside>
      <section className="wk-voice-center" aria-label="Conversation">
        <div className="wk-voice-top">
          <span className="wk-voice-micdot" data-on={v.micOn ? 'true' : 'false'} aria-hidden />
          <span className="sr-only" data-testid="voice-mic-state">{v.micOn ? 'Microphone on' : 'Microphone off'}</span>
          <LiveWave count={40} testId="voice-fwave" />
          <span className="wk-voice-mode" data-on={v.mode === 'stream' || v.holding ? 'true' : 'false'} data-testid="voice-mode">{modeLabel}</span>
          <button
            type="button"
            className="wk-btn wk-btn--secondary wk-btn--sm"
            aria-pressed={v.readAloud}
            data-testid="voice-read-aloud"
            onClick={() => setReadAloud(!v.readAloud)}
            title={v.readAloud ? 'Replies are read aloud' : 'Replies are captions only'}
          >
            {v.readAloud ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />}
            <span className="wk-voice-hide-sm">{v.readAloud ? 'Read aloud' : 'Captions only'}</span>
          </button>
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="voice-exit" onClick={closeVoice}>Leave voice</button>
        </div>
        <VoiceSetup />
        <div className="wk-voice-trans" ref={trans} role="log" aria-live="polite" aria-label="Transcript" data-testid="voice-trans" tabIndex={0}>
          {((undoLines) => v.lines.map((l) => <Line key={l.id} l={l} undoHere={undoLines.has(l.id)} />))(latestUndoLine(v.lines))}
        </div>
        <div className="wk-voice-foot" data-testid="voice-foot">
          <span className="wk-voice-dot" data-tone={v.mode !== null ? 'run' : 'idle'} aria-hidden /> {foot}
          {v.mode === 'space' && (
            <button
              type="button"
              className="wk-btn wk-btn--secondary wk-btn--sm wk-voice-hold"
              data-testid="voice-hold"
              data-held={v.holding ? 'true' : 'false'}
              aria-pressed={v.holding}
              onPointerDown={(e) => { e.preventDefault(); holdToTalk(true); }}
              onPointerUp={() => holdToTalk(false)}
              onPointerLeave={() => { if (v.holding) holdToTalk(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); holdToTalk(!v.holding); } }}
            >
              <Mic size={14} aria-hidden /> {v.holding ? 'Release to send' : 'Hold to talk'}
            </button>
          )}
        </div>
        <TypeInstead label="Type to the system" testId="voice-type" placeholder="Type instead of speaking (Enter sends)" />
      </section>
      <aside className="wk-voice-side" data-side="right" aria-label="System, right">
        {right.map((w) => <Widget key={w.id} w={w} />)}
        <AddWidgetButton onOpen={() => setPicking(true)} />
      </aside>
      {v.preview !== null && <JobPreview key={v.preview.runId} runId={v.preview.runId} pinned={v.preview.pinned} />}
      {picking && <WidgetPicker onClose={() => setPicking(false)} />}
    </div>
  );
}

function Line({ l, undoHere }: { l: VoiceLine; undoHere: boolean }): React.ReactElement {
  const who = l.who === 'you' ? (l.spoken === true ? 'You · by voice' : 'You') : 'Studio';
  return (
    <div className="wk-voice-line" data-who={l.who} data-partial={l.partial === true ? 'true' : undefined} data-testid={`voice-line-${l.who}`}>
      <small>{who}</small>
      {l.text !== '' && <span className="wk-voice-text">{l.text}</span>}
      {l.ask !== undefined && (l.record !== undefined
        ? <AskRecord line={l.record} testId="voice-ask-record" />
        : <div className="wk-voice-ask"><AskCard ask={l.ask.ask} {...(l.ask.ask.host === 'gate' ? { tag: 'Gate' } : {})} onAnswer={(a) => answerAsk(l.id, a)} testIds={{ root: `voice-ask-${l.ask.context.kind === 'job' ? l.ask.context.action.kind : l.ask.context.kind}` }} /></div>)}
      {/* studio 0.16.4: the 10 s Undo of a decision confirmed here, inline under it. Mounted with the ask (before the
          answer), so the decision is never sent off to a page under this full screen. */}
      {undoHere && l.ask !== undefined && voiceUndoKeys(l.ask.context) !== null && <InlineUndo host="voice" over keys={voiceUndoKeys(l.ask.context)!} className="wk-voice-undo" />}
    </div>
  );
}

/** What a voice ask's decision is about, for its inline Undo: a gate answer, or a job's Stop. */
function voiceUndoKeys(c: NonNullable<VoiceLine['ask']>['context']): string[] | null {
  if (c.kind === 'gate') return [`gate:${c.runId}`];
  if (c.kind === 'job' && c.action.kind === 'stop') return [`stop:${c.runId}`];
  return null;
}

/** The lines that host a voice Undo: for each decision key, only the NEWEST ask about it — an older ask about the same
 *  run (answered, undone, asked again) never claims a later decision. */
function latestUndoLine(lines: readonly VoiceLine[]): Set<number> {
  const byKey = new Map<string, number>();
  for (const l of lines) {
    if (l.ask === undefined) continue;
    const keys = voiceUndoKeys(l.ask.context);
    if (keys !== null) byKey.set(keys.join(' '), l.id);
  }
  return new Set(byKey.values());
}
