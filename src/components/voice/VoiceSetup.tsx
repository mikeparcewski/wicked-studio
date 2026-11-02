import { consentToModel, refreshStatus } from '../../voice/controller.js';
import { useShallow } from 'zustand/react/shallow';
import { useVoiceStore } from '../../store/voice.js';

const mb = (n: number): string => `${Math.round(n / 1048576)} MB`;

/**
 * What voice needs before it can hear, said plainly (DES-VOICE §3, §4): the speech engine (whisper.cpp) on this
 * machine, and one model file fetched ONLY with the person's consent. Audio never leaves the machine either way.
 * Nothing renders once both are here and the mic is on.
 */
export function VoiceSetup(): React.ReactElement | null {
  const { status, statusError, micError } = useVoiceStore(useShallow((s) => ({ status: s.status, statusError: s.statusError, micError: s.micError })));
  if (statusError !== null) {
    return <div className="wk-voice-setup" data-testid="voice-setup" data-state="error" role="status">{statusError}</div>;
  }
  const rows: React.ReactNode[] = [];
  if (micError !== null) rows.push(<p key="mic" data-testid="voice-mic-error">{micError}</p>);
  if (status !== null && (!status.engine.found || status.engine.supported === false)) {
    rows.push(
      <div key="engine" data-testid="voice-engine-missing">
        <p>
          <b>I can’t hear you yet:</b>{' '}
          {status.engine.found ? status.engine.install : <>the speech engine (whisper.cpp) isn’t on this computer. {status.engine.install}</>}
        </p>
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => void refreshStatus()}>Check again</button>
      </div>,
    );
  } else if (status !== null && !status.model.present) {
    const dl = status.model.download;
    if (dl?.state === 'running') {
      const pct = dl.totalBytes !== null && dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : null;
      rows.push(
        <div key="dl" data-testid="voice-model-downloading">
          <p>Downloading the speech model… {mb(dl.receivedBytes)} of {mb(dl.totalBytes ?? status.model.approxBytes)}</p>
          <div className="wk-voice-progress" role="progressbar" aria-label="Speech model download" aria-valuemin={0} aria-valuemax={100} {...(pct !== null ? { 'aria-valuenow': pct } : {})}>
            <span style={{ width: `${pct ?? 5}%` }} />
          </div>
        </div>,
      );
    } else {
      rows.push(
        <div key="model" data-testid="voice-model-consent">
          <p>
            <b>To hear you, voice needs a speech model on this computer</b> ({status.model.name}, about {mb(status.model.approxBytes)},
            from {status.model.source}). It runs here: your audio is never recorded or sent anywhere.
          </p>
          {dl?.state === 'failed' && <p data-testid="voice-model-failed">The last download failed: {dl.error}</p>}
          <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="voice-model-download" onClick={() => void consentToModel()}>
            {dl?.state === 'failed' ? 'Try the download again' : `Download the speech model (${mb(status.model.approxBytes)})`}
          </button>
        </div>,
      );
    }
  }
  if (rows.length === 0) return null;
  return <div className="wk-voice-setup" data-testid="voice-setup" role="status">{rows}</div>;
}
