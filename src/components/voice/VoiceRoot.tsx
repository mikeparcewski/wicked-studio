import { useMemo } from 'react';
import { altChord, useGlobalShortcuts, type ShortcutEntry } from '../../hooks/useGlobalShortcuts.js';
import { openVoice } from '../../voice/controller.js';
import { useVoiceStore } from '../../store/voice.js';
import { VoiceFullScreen } from './VoiceFullScreen.js';
import { VoiceModal } from './VoiceModal.js';

/** Voice mode's one mount (every route): ⌥V opens it, even from a composer; the phase picks the surface. */
export function VoiceRoot(): React.ReactElement | null {
  const phase = useVoiceStore((s) => s.phase);
  const entries = useMemo<ShortcutEntry[]>(() => [{
    id: 'voice.open',
    chord: altChord('v'),
    description: 'Voice mode',
    group: 'panels',
    allowInTypingContext: true,
    handler: (e) => { e.preventDefault(); void openVoice(); },
  }], []);
  useGlobalShortcuts(entries);
  if (phase === 'ask') return <VoiceModal />;
  if (phase === 'full') return <VoiceFullScreen />;
  return null;
}
