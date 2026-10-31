/**
 * The voice modulator (mockup state g): bars that move with whoever is speaking: accent for you, green for the
 * system, quiet when nobody is. Live from the mic's `AnalyserNode` while you speak; a calm pulse while the system
 * speaks (the browser's speech synthesis has no level to read). Reduced motion keeps the bars still.
 */

import { useVoiceStore } from '../../store/voice.js';

const N_DEFAULT = 28;

/** The waveform bound to the live mic: only this re-renders on each audio frame, never the surface around it. */
export function LiveWave({ count = N_DEFAULT, testId = 'voice-wave' }: { count?: number; testId?: string }): React.ReactElement {
  const bars = useVoiceStore((s) => s.bars);
  const who = useVoiceStore((s) => s.speaking);
  return <VoiceWave bars={bars} who={who} count={count} testId={testId} />;
}

export function VoiceWave({ bars, who, count = N_DEFAULT, testId = 'voice-wave' }: {
  bars: readonly number[];
  who: 'you' | 'it' | 'idle';
  count?: number;
  testId?: string;
}): React.ReactElement {
  const heights: number[] = [];
  for (let i = 0; i < count; i++) {
    const shape = Math.sin(((i + 0.5) / count) * Math.PI);
    if (who === 'you') {
      const v = bars.length > 0 ? bars[Math.floor((i / count) * bars.length)] ?? 0 : 0;
      heights.push(Math.round(6 + Math.min(1, v * 1.6) * 58 * (0.45 + shape * 0.55)));
    } else {
      heights.push(Math.round(12 + shape * 46 * (0.55 + ((i * 37) % 10) / 22)));
    }
  }
  return (
    <div className="wk-voice-wave" data-who={who} data-testid={testId} aria-hidden>
      {heights.map((h, i) => (
        <i key={i} style={{ '--h': `${h}px`, ...(who === 'you' ? { height: `${h}px` } : { animationDelay: `${(i * 83) % 900}ms` }) } as unknown as React.CSSProperties} />
      ))}
    </div>
  );
}
