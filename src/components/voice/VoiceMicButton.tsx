import { Mic } from 'lucide-react';
import { openVoice } from '../../voice/controller.js';

/** The mic in a composer (DES-VOICE §2a): opens voice mode's modal. ⌥V does the same from anywhere. */
export function VoiceMicButton({ size = 'sm', testId = 'voice-open' }: { size?: 'sm' | 'xs'; testId?: string }): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      className={`wk-btn wk-btn--secondary ${size === 'xs' ? 'wk-voice-micbtn--xs' : 'wk-btn--sm'} wk-voice-micbtn shrink-0`}
      onClick={() => void openVoice()}
      title="Voice mode (⌥V)"
      aria-label="Voice mode"
      aria-keyshortcuts="Alt+V"
    >
      <Mic size={size === 'xs' ? 13 : 15} aria-hidden />
      {size === 'sm' && <span>Voice</span>}
    </button>
  );
}
