import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { VoiceSetup } from '../src/components/voice/VoiceSetup.js';
import { INITIAL_VOICE, useVoiceStore } from '../src/store/voice.js';
import { refreshTts, resetVoice } from '../src/voice/controller.js';
import type { VoiceTtsStatus, VoiceTtsVoice } from '../src/api/voice.js';

// Only the voices crew's manifest offers (wicked-crew#1548): Joe (en_US-joe-medium, CC0) and Cori (en_GB-cori-high,
// public domain). `JOE` is the installed one, `CORI` the not-yet-installed one.
const JOE_ID = 'en_US-joe-medium';
const CORI_ID = 'en_GB-cori-high';
const JOE: VoiceTtsVoice = { installed: true, name: 'Joe', accent: 'US English', licence: 'CC0', bytes: 63 * 1048576, source: 'Hugging Face rhasspy/piper-voices' };
const CORI: VoiceTtsVoice = { installed: false, name: 'Cori', accent: 'UK English', licence: 'Public domain', bytes: 85 * 1048576, source: 'Hugging Face rhasspy/piper-voices' };

function tts(over: Partial<VoiceTtsStatus> = {}): VoiceTtsStatus {
  return {
    supported: { ok: true, reason: null },
    python: { found: true, path: '/usr/bin/python3', version: '3.11.4' },
    engine: { found: true, version: '1.8.0' },
    voices: { [JOE_ID]: { ...JOE }, [CORI_ID]: { ...CORI } },
    install: null,
    ...over,
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  useVoiceStore.setState({ ...INITIAL_VOICE });
  try { localStorage.clear(); } catch { /* ignore */ }
});

afterEach(() => {
  resetVoice();
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('read-aloud setup rows', () => {
  it('shows what, where, size and licence before any request', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    useVoiceStore.setState({ tts: tts(), readAloud: true });
    render(<VoiceSetup />);
    const disc = screen.getByTestId('voice-tts-disclosure');
    expect(disc.textContent).toContain('piper-tts 1.8.0');
    expect(disc.textContent).toContain('GPL-3.0-or-later');
    expect(disc.textContent).toContain('Hugging Face');
    // A voice row names its size and licence.
    const cori = screen.getByTestId(`voice-tts-voice-${CORI_ID}`);
    expect(cori.textContent).toContain('85 MB');
    expect(cori.textContent).toContain('Public domain');
    expect(fetchSpy).not.toHaveBeenCalled(); // nothing fetched just by showing the rows
  });

  it('installing shows a human step label (never the raw step id) and an indeterminate bar', () => {
    // D1: crew's step is `engine` or `voice:<id>`; show a person-facing label, never the raw id.
    useVoiceStore.setState({ tts: tts({ install: { state: 'running', step: `voice:${JOE_ID}`, error: null } }), readAloud: true });
    const { rerender } = render(<VoiceSetup />);
    const prog = screen.getByTestId('voice-tts-progress');
    expect(prog.textContent).toContain('Downloading Joe');
    expect(prog.textContent).not.toContain(JOE_ID);
    expect(prog.textContent).not.toContain('voice:');
    // D2: no byte count → indeterminate bar: aria-busy true, aria-valuenow absent, no width claim.
    const bar = prog.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-busy')).toBe('true');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    const fill = bar.querySelector('span')!;
    expect(fill.getAttribute('style') ?? '').not.toContain('width');
    // The engine step maps to its own line.
    useVoiceStore.setState({ tts: tts({ install: { state: 'running', step: 'engine', error: null } }) });
    rerender(<VoiceSetup />);
    expect(screen.getByTestId('voice-tts-progress').textContent).toContain('Installing the read-aloud engine');
  });

  it('consent posts exactly {consent: true, voices: [id]}', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push([String(url), init]); return okResponse(tts()); }));
    vi.useFakeTimers();
    useVoiceStore.setState({ tts: tts(), readAloud: true });
    render(<VoiceSetup />);
    await act(async () => { fireEvent.click(screen.getByTestId(`voice-tts-consent-${CORI_ID}`)); });
    const post = calls.find(([, init]) => init?.method === 'POST');
    expect(post).toBeDefined();
    expect(post![0]).toContain('/voice/tts');
    expect(post![1]!.body).toBe(JSON.stringify({ consent: true, voices: [CORI_ID] }));
  });

  it('offers Play sample only for an installed voice', () => {
    useVoiceStore.setState({ tts: tts(), readAloud: true });
    render(<VoiceSetup />);
    expect(screen.getByTestId(`voice-tts-sample-${JOE_ID}`)).toBeTruthy();   // installed
    expect(screen.queryByTestId(`voice-tts-sample-${CORI_ID}`)).toBeNull();  // not installed → no sample
    expect(screen.getByTestId(`voice-tts-consent-${CORI_ID}`)).toBeTruthy(); // not installed → consent
    expect(screen.queryByTestId(`voice-tts-consent-${JOE_ID}`)).toBeNull();  // installed → no consent
  });

  it('choosing a voice persists in localStorage', () => {
    useVoiceStore.setState({ tts: tts({ voices: { [JOE_ID]: { ...JOE }, [CORI_ID]: { ...CORI, installed: true } } }), ttsVoice: JOE_ID, readAloud: true });
    render(<VoiceSetup />);
    fireEvent.click(screen.getByTestId(`voice-tts-choose-${CORI_ID}`).querySelector('input')!);
    expect(localStorage.getItem('studio.voice.ttsVoice')).toBe(CORI_ID);
    expect(useVoiceStore.getState().ttsVoice).toBe(CORI_ID);
  });

  it('defaults the chosen voice to the first installed, and keeps a still-installed saved choice', async () => {
    const both = tts({ voices: { [JOE_ID]: { ...JOE }, [CORI_ID]: { ...CORI, installed: true } } });
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(both)));
    // No saved choice → first installed (Joe).
    await act(async () => { await refreshTts(); });
    expect(useVoiceStore.getState().ttsVoice).toBe(JOE_ID);
    // A saved choice that is still installed survives.
    useVoiceStore.setState({ ttsVoice: null });
    localStorage.setItem('studio.voice.ttsVoice', CORI_ID);
    await act(async () => { await refreshTts(); });
    expect(useVoiceStore.getState().ttsVoice).toBe(CORI_ID);
  });

  it('shows the upgrade line when the crew has no read-aloud routes (404)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })));
    await act(async () => { await refreshTts(); });
    expect(useVoiceStore.getState().ttsError).toContain('Upgrade wicked-crew');
    render(<VoiceSetup />);
    expect(screen.getByTestId('voice-tts-error').textContent).toContain('Upgrade wicked-crew');
  });

  it('shows the platform remedy when Python is missing / unsupported', () => {
    useVoiceStore.setState({
      tts: tts({ supported: { ok: false, reason: 'Install Python 3.10+ where crew runs to use read-aloud.' }, python: { found: false, path: null, version: null } }),
      readAloud: true,
    });
    render(<VoiceSetup />);
    expect(screen.getByTestId('voice-tts-unsupported').textContent).toContain('Install Python 3.10+');
  });

  it('hides the read-aloud rows entirely when read-aloud is off', () => {
    useVoiceStore.setState({ tts: tts(), readAloud: false });
    const { container } = render(<VoiceSetup />);
    expect(container.querySelector('[data-testid="voice-tts"]')).toBeNull();
  });
});
