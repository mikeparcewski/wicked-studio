import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { VoiceSetup } from '../src/components/voice/VoiceSetup.js';
import { INITIAL_VOICE, useVoiceStore } from '../src/store/voice.js';
import { refreshTts, resetVoice } from '../src/voice/controller.js';
import type { VoiceTtsStatus, VoiceTtsVoice } from '../src/api/voice.js';

const AMY: VoiceTtsVoice = { installed: true, name: 'Amy', accent: 'US English', licence: 'CC BY 4.0', bytes: 63 * 1048576, source: 'Hugging Face rhasspy/piper-voices' };
const RYAN: VoiceTtsVoice = { installed: false, name: 'Ryan', accent: 'US English', licence: 'MIT', bytes: 75 * 1048576, source: 'Hugging Face rhasspy/piper-voices' };

function tts(over: Partial<VoiceTtsStatus> = {}): VoiceTtsStatus {
  return {
    supported: { ok: true, reason: null },
    python: { found: true, path: '/usr/bin/python3', version: '3.11.4' },
    engine: { found: true, version: '1.8.0' },
    voices: { amy: { ...AMY }, ryan: { ...RYAN } },
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
    const ryan = screen.getByTestId('voice-tts-voice-ryan');
    expect(ryan.textContent).toContain('75 MB');
    expect(ryan.textContent).toContain('MIT');
    expect(fetchSpy).not.toHaveBeenCalled(); // nothing fetched just by showing the rows
  });

  it('consent posts exactly {consent: true, voices: [id]}', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push([String(url), init]); return okResponse(tts()); }));
    vi.useFakeTimers();
    useVoiceStore.setState({ tts: tts(), readAloud: true });
    render(<VoiceSetup />);
    await act(async () => { fireEvent.click(screen.getByTestId('voice-tts-consent-ryan')); });
    const post = calls.find(([, init]) => init?.method === 'POST');
    expect(post).toBeDefined();
    expect(post![0]).toContain('/voice/tts');
    expect(post![1]!.body).toBe(JSON.stringify({ consent: true, voices: ['ryan'] }));
  });

  it('offers Play sample only for an installed voice', () => {
    useVoiceStore.setState({ tts: tts(), readAloud: true });
    render(<VoiceSetup />);
    expect(screen.getByTestId('voice-tts-sample-amy')).toBeTruthy();   // installed
    expect(screen.queryByTestId('voice-tts-sample-ryan')).toBeNull();  // not installed → no sample
    expect(screen.getByTestId('voice-tts-consent-ryan')).toBeTruthy(); // not installed → consent
    expect(screen.queryByTestId('voice-tts-consent-amy')).toBeNull();  // installed → no consent
  });

  it('choosing a voice persists in localStorage', () => {
    useVoiceStore.setState({ tts: tts({ voices: { amy: { ...AMY }, ryan: { ...RYAN, installed: true } } }), ttsVoice: 'amy', readAloud: true });
    render(<VoiceSetup />);
    fireEvent.click(screen.getByTestId('voice-tts-choose-ryan').querySelector('input')!);
    expect(localStorage.getItem('studio.voice.ttsVoice')).toBe('ryan');
    expect(useVoiceStore.getState().ttsVoice).toBe('ryan');
  });

  it('defaults the chosen voice to the first installed, and keeps a still-installed saved choice', async () => {
    const both = tts({ voices: { amy: { ...AMY }, ryan: { ...RYAN, installed: true } } });
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(both)));
    // No saved choice → first installed (amy).
    await act(async () => { await refreshTts(); });
    expect(useVoiceStore.getState().ttsVoice).toBe('amy');
    // A saved choice that is still installed survives.
    useVoiceStore.setState({ ttsVoice: null });
    localStorage.setItem('studio.voice.ttsVoice', 'ryan');
    await act(async () => { await refreshTts(); });
    expect(useVoiceStore.getState().ttsVoice).toBe('ryan');
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
