import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AskCard } from '../ask/AskCard.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';
import { ENTRY_ASK, answerEntry, closeVoice, hear } from '../../voice/controller.js';
import { useShallow } from 'zustand/react/shallow';
import { useVoiceStore, withoutWave } from '../../store/voice.js';
import { VoiceSetup } from './VoiceSetup.js';
import { LiveWave } from './VoiceWave.js';


/**
 * Step 1 of voice mode (DES-VOICE §2a; mockup state g "Modal asks" / "Modal answers"): a centred modal, about 35%
 * of the viewport wide and tall (92% wide on a phone), over a blurred page. It asks, aloud and on screen, whether to
 * enter voice mode; a question about voice is answered, then the question is asked again. Esc or No closes it.
 */
export function VoiceModal(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  // Everything but the waveform's bars and who is speaking (those move ~20 times a second; LiveWave reads them).
  const v = useVoiceStore(useShallow(withoutWave));
  const asking = useVoiceStore((s) => s.speaking === 'it');
  useDialogFocus(true, ref, { modal: true, prefer: '[data-ask-option="yes"]' });
  const listening = v.micOn && v.status?.ready === true;
  return (
    <div className="wk-voice-scrim" data-testid="voice-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) closeVoice(); }}>
      <div
        ref={ref}
        className="wk-voice-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Voice mode"
        data-testid="voice-modal"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeVoice(); } }}
      >
        <div className="wk-voice-modal-h">
          <span className="wk-voice-micdot" data-on={listening ? 'true' : 'false'} aria-hidden />
          <span data-testid="voice-mic-state">{listening ? 'Voice · listening only while this is open' : v.micOn ? 'Voice · mic on, not hearing yet' : 'Voice · mic off'}</span>
          <button type="button" className="wk-voice-x" aria-label="Close voice mode" data-testid="voice-close" onClick={closeVoice}><X size={16} aria-hidden /></button>
        </div>
        <LiveWave />
        <p className="wk-voice-heard" data-testid="voice-heard" aria-live="polite">{v.heard ?? (asking ? 'Asking…' : '\u00a0')}</p>
        {v.modal.length > 0 && (
          <div className="wk-voice-modal-thread" data-testid="voice-modal-thread">
            {v.modal.map((l) => (
              <p key={l.id} className="wk-voice-say" data-who={l.who}>{l.who === 'you' ? <b>You: </b> : null}{l.text}</p>
            ))}
          </div>
        )}
        <VoiceSetup />
        <AskCard ask={ENTRY_ASK} onAnswer={(a) => answerEntry(a.option === 'yes')} testIds={{ root: 'voice-entry-ask' }} />
        <TypeInstead label="Or type it" testId="voice-modal-type" />
        <p className="wk-voice-tip">Say “yes”, “no”, or ask about voice mode. Esc closes.</p>
      </div>
    </div>
  );
}

/** Keyboard reaches everything: words typed here go exactly where spoken words go. */
export function TypeInstead({ label, testId, placeholder = 'Type instead of speaking' }: { label: string; testId: string; placeholder?: string }): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <form
      className="wk-voice-type"
      data-testid={testId}
      onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t === '') return; setText(''); void hear(t, 'typed'); }}
    >
      <label className="sr-only" htmlFor={`${testId}-input`}>{label}</label>
      <input id={`${testId}-input`} data-testid={`${testId}-input`} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoComplete="off" />
      <button type="submit" className="wk-btn wk-btn--secondary wk-btn--sm" disabled={text.trim() === ''}>Send</button>
    </form>
  );
}
