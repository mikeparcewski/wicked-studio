import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { normalizeSnapshot } from '../src/api/system.js';
import { Widget } from '../src/components/voice/VoiceDashboard.js';
import { useGateStore } from '../src/store/gates.js';
import { useNeedsCount } from '../src/store/needsCount.js';
import { useSystemStore } from '../src/store/systemSnapshot.js';
import { useVoiceStore } from '../src/store/voice.js';
import { answerAsk, answerEntry, closeVoice, resetVoice, resetVoiceDeps, setVoiceDeps } from '../src/voice/controller.js';
import { resetDashStore, useDashStore } from '../src/voice/dashboardStore.js';
import { NEEDS_SETTLE_MS } from '../src/hooks/useNeedsRows.js';
import { dashboardWidgets } from '../src/voice/widgets.js';

const snapshot = normalizeSnapshot({ runs: [], infra: [], clis: [], attention: [], governance: [] });
const widget = dashboardWidgets(null, []).find((w) => w.id === 'builtin.gates')!;
const say = vi.fn<(text: string) => Promise<void>>(async () => {});

beforeEach(() => {
  resetVoice();
  resetDashStore();
  useSystemStore.setState({ snapshot: null });
  useNeedsCount.setState({ phase: 'loading', count: null });
  useGateStore.setState({ gates: {} });
  setVoiceDeps({ speaker: { available: true, say, cancel: () => {} }, endChat: () => {} });
  say.mockClear();
});
afterEach(() => { cleanup(); resetVoice(); resetVoiceDeps(); vi.useRealTimers(); });

function enter(): void {
  useVoiceStore.setState({ phase: 'ask' });
  act(() => answerEntry(true));
}

it('shows an ellipsis and speaks no system summary while the count is loading', () => {
  useDashStore.setState({ system: snapshot });
  render(<Widget w={widget} />);
  enter();
  expect(screen.getByTestId('voice-gates-count').textContent).toBe('…');
  expect(useVoiceStore.getState().lines[0]?.text).toBe("Reading what's happening around us…");
  expect(useVoiceStore.getState().lines[1]?.ask?.context.kind).toBe('mode');
  expect(say).not.toHaveBeenCalled();
  expect(useVoiceStore.getState().lines.some((l) => /nothing (waiting|needs)/.test(l.text))).toBe(false);
});

it('uses the settled six for the widget and summary when only four gates are cached', () => {
  for (let i = 0; i < 4; i++) useGateStore.getState().setGate({ runId: `r${i}`, ord: 1, prompt: 'Continue?', lifecycle: 'open', receivedAt: i });
  useNeedsCount.setState({ phase: 'complete', count: 6 });
  useDashStore.setState({ system: snapshot });
  render(<Widget w={widget} />);
  enter();
  expect(screen.getByTestId('voice-gates-count').textContent).toBe('6');
  expect(screen.getByText('need you')).toBeTruthy();
  expect(useVoiceStore.getState().lines[0]?.text).toContain('6 things need you');
  expect(say).toHaveBeenCalledWith(expect.stringContaining('6 things need you'));
});

it.each(['dashboard', 'system'] as const)('replaces the placeholder in place once the count and %s snapshot are ready', (source) => {
  enter();
  const [placeholder, ask] = useVoiceStore.getState().lines;
  expect(placeholder?.text).toBe("Reading what's happening around us…");
  useNeedsCount.setState({ phase: 'complete', count: 1 });
  expect(say).not.toHaveBeenCalled();
  if (source === 'dashboard') useDashStore.setState({ system: snapshot });
  else useSystemStore.setState({ snapshot });
  const lines = useVoiceStore.getState().lines;
  expect(lines).toHaveLength(2);
  expect(lines[0]?.id).toBe(placeholder?.id);
  expect(lines[1]).toBe(ask);
  expect(lines[0]?.text).toContain('one thing needs you');
  expect(say).toHaveBeenCalledWith(expect.stringContaining('How should I listen?'));
  say.mockClear();
  useNeedsCount.setState({ phase: 'complete', count: 2 });
  expect(say).not.toHaveBeenCalled();
});

it('waits for the count after the snapshot arrives', () => {
  enter();
  useDashStore.setState({ system: snapshot });
  expect(say).not.toHaveBeenCalled();
  useNeedsCount.setState({ phase: 'complete', count: 0 });
  expect(useVoiceStore.getState().lines[0]?.text).toContain('nothing needs you');
  expect(say).toHaveBeenCalledTimes(1);
});

it('does not repeat the listening ask when a mode was chosen while the summary was pending', () => {
  useDashStore.setState({ system: snapshot });
  enter();
  const ask = useVoiceStore.getState().lines.find((line) => line.ask?.context.kind === 'mode')!;
  act(() => answerAsk(ask.id, { askId: ask.ask!.ask.id, option: 'space' }));
  expect(useVoiceStore.getState().mode).toBe('space');
  say.mockClear();
  useNeedsCount.setState({ phase: 'complete', count: 1 });
  expect(say).toHaveBeenCalledTimes(1);
  expect(say).toHaveBeenCalledWith(expect.stringContaining('one thing needs you'));
  expect(say.mock.calls[0]?.[0]).not.toContain('How should I listen');
});

it('does not speak the listening ask after leaving it with no mode chosen', () => {
  useDashStore.setState({ system: snapshot });
  enter();
  useVoiceStore.setState({ openAsk: null });
  useNeedsCount.setState({ phase: 'complete', count: 1 });
  expect(say).toHaveBeenCalledTimes(1);
  expect(say.mock.calls[0]?.[0]).not.toContain('How should I listen');
});

it('omits the machine clause when the load has not been read', () => {
  useDashStore.setState({ system: snapshot });
  useNeedsCount.setState({ phase: 'complete', count: 0 });
  enter();
  expect(useVoiceStore.getState().lines[0]?.text).toBe('You’re in voice mode. Around us is what’s happening now: no jobs running, nothing needs you.');
  expect(say.mock.calls[0]?.[0]).not.toContain('the machine');
});

it('never says nothing needs you for a partial zero count', () => {
  useDashStore.setState({ system: snapshot });
  useNeedsCount.setState({ phase: 'partial', count: 0 });
  enter();
  expect(useVoiceStore.getState().lines[0]?.text).not.toMatch(/nothing (waiting|needs)/);
});

it('replaces an unread summary honestly after the settling deadline and speaks the ask once', async () => {
  vi.useFakeTimers();
  enter();
  const id = useVoiceStore.getState().lines[0]?.id;
  await vi.advanceTimersByTimeAsync(NEEDS_SETTLE_MS + 5000);
  expect(useVoiceStore.getState().lines[0]).toMatchObject({ id, text: "I couldn't read yet what's waiting on you; the Desk has it." });
  expect(say).toHaveBeenCalledTimes(1);
  expect(say).toHaveBeenCalledWith(expect.stringContaining('How should I listen?'));
  useDashStore.setState({ system: snapshot });
  useNeedsCount.setState({ phase: 'complete', count: 6 });
  expect(say).toHaveBeenCalledTimes(1);
});

it('drops pending summary subscriptions and its deadline when voice closes', async () => {
  vi.useFakeTimers();
  enter();
  closeVoice();
  useDashStore.setState({ system: snapshot });
  useNeedsCount.setState({ phase: 'complete', count: 6 });
  await vi.advanceTimersByTimeAsync(NEEDS_SETTLE_MS + 5000);
  expect(useVoiceStore.getState().lines).toEqual([]);
  expect(say).not.toHaveBeenCalled();
});

it('updates the widget from loading to the single settled need', () => {
  render(<Widget w={widget} />);
  act(() => useNeedsCount.setState({ phase: 'complete', count: 1 }));
  expect(screen.getByTestId('voice-gates-count').textContent).toBe('1');
  expect(screen.getByText('needs you')).toBeTruthy();
});
