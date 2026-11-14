import { chooseVoice, consentToModel, consentToVoice, playSample, refreshStatus } from '../../voice/controller.js';
import { useShallow } from 'zustand/react/shallow';
import { useVoiceStore } from '../../store/voice.js';
import type { VoiceTtsVoice } from '../../api/voice.js';

const mb = (n: number): string => `${Math.round(n / 1048576)} MB`;

/**
 * What voice needs before it can hear and speak, said plainly (DES-VOICE §3, §4; wicked-crew#1548):
 *   - speech input: the whisper.cpp engine on this machine, and one model fetched ONLY with consent;
 *   - read-aloud: piper on this machine, and one or more licence-cleared voices fetched ONLY with consent.
 * Both run locally — audio never leaves the machine either way. The whisper rows disappear once speech input is
 * ready and the mic is on; the read-aloud rows show whenever read-aloud is on (so a voice can be chosen or sampled).
 */
export function VoiceSetup(): React.ReactElement | null {
  const { status, statusError, micError, tts, ttsError, ttsVoice, readAloud } = useVoiceStore(
    useShallow((s) => ({
      status: s.status, statusError: s.statusError, micError: s.micError,
      tts: s.tts, ttsError: s.ttsError, ttsVoice: s.ttsVoice, readAloud: s.readAloud,
    })),
  );

  const rows: React.ReactNode[] = [];

  // ── Speech input (whisper.cpp) ──────────────────────────────────────────────────────────────
  if (statusError !== null) {
    rows.push(<p key="status-error" data-testid="voice-setup-status-error" data-state="error">{statusError}</p>);
  }
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

  // ── Read-aloud (piper) ──────────────────────────────────────────────────────────────────────
  const readAloudBlock = buildReadAloud(readAloud, tts, ttsError, ttsVoice);
  if (readAloudBlock !== null) rows.push(readAloudBlock);

  if (rows.length === 0) return null;
  return <div className="wk-voice-setup" data-testid="voice-setup" role="status">{rows}</div>;
}

function buildReadAloud(
  readAloud: boolean,
  tts: ReturnType<typeof useVoiceStore.getState>['tts'],
  ttsError: string | null,
  ttsVoice: string | null,
): React.ReactNode {
  if (!readAloud) return null;
  // A crew with no read-aloud routes (404) or a read error: the upgrade/remedy line.
  if (ttsError !== null) {
    return <div key="tts" data-testid="voice-tts" data-state="error"><p data-testid="voice-tts-error">{ttsError}</p></div>;
  }
  if (tts === null) return null; // still loading

  const inner: React.ReactNode[] = [];
  // Read-aloud can't run here (no python, unsupported platform): show the remedy, nothing to download.
  if (!tts.supported.ok || !tts.python.found) {
    inner.push(
      <p key="unsup" data-testid="voice-tts-unsupported">
        {tts.supported.reason ?? 'Read-aloud can’t run on this computer: Python wasn’t found where crew runs.'}
      </p>,
    );
    return <div key="tts" data-testid="voice-tts" data-state="unsupported">{inner}</div>;
  }

  // Before anything downloads, say exactly what will be fetched and from where.
  inner.push(
    <p key="disclosure" data-testid="voice-tts-disclosure">
      Read-aloud speaks on this computer with <b>piper-tts 1.8.0</b> from PyPI (GPL-3.0-or-later), installed here as a
      separate program. Each voice is downloaded from Hugging Face (rhasspy/piper-voices); its size and licence are
      shown below.
    </p>,
  );

  const installing = tts.install?.state === 'running';
  if (installing) {
    inner.push(
      <div key="progress" data-testid="voice-tts-progress">
        <p>Installing read-aloud… {tts.install?.step}</p>
        <div className="wk-voice-progress" role="progressbar" aria-label="Read-aloud install" aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: '40%' }} />
        </div>
      </div>,
    );
  }
  if (tts.install?.state === 'failed') {
    inner.push(<p key="failed" data-testid="voice-tts-failed">The last install failed: {tts.install.error}</p>);
  }

  for (const [id, v] of Object.entries(tts.voices)) {
    inner.push(voiceRow(id, v, ttsVoice === id, installing));
  }

  return <div key="tts" data-testid="voice-tts" data-state="ready">{inner}</div>;
}

function voiceRow(id: string, v: VoiceTtsVoice, chosen: boolean, installing: boolean): React.ReactNode {
  return (
    <div key={`voice-${id}`} className="wk-voice-trow" data-testid={`voice-tts-voice-${id}`}>
      <p>
        <b>{v.name}</b> · {v.accent} · {v.licence} · {mb(v.bytes)}{' '}
        <span className="wk-voice-src">({v.source})</span>
      </p>
      {!v.installed ? (
        <button
          type="button"
          className="wk-btn wk-btn--primary wk-btn--sm"
          data-testid={`voice-tts-consent-${id}`}
          disabled={installing}
          onClick={() => void consentToVoice(id)}
        >
          Download {v.name} ({mb(v.bytes)})
        </button>
      ) : (
        <div className="wk-voice-trow-actions">
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid={`voice-tts-sample-${id}`} onClick={() => void playSample(id)}>
            Play sample
          </button>
          <label className="wk-voice-choose" data-testid={`voice-tts-choose-${id}`}>
            <input type="radio" name="voice-tts-voice" checked={chosen} onChange={() => chooseVoice(id)} /> Use this voice
          </label>
        </div>
      )}
    </div>
  );
}
