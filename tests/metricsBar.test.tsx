import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { outcomeOf } from '../src/board/metrics.js';
import { useGateStore } from '../src/store/gates.js';
import { useRuntimeStore } from '../src/store/runtime.js';

/**
 * The slice-E SVG-first tiles that SURVIVE the command-center rework
 * (DES-HOME-COMMAND-CENTER §1): each answers a §2.1 named operator question
 * off data the page ALREADY holds — no chart library, no new polling, no
 * invented wire fields. (RunOutcomeBar and TokenBurnSparkline retired with the
 * narrative band; the KPI band's windowed tiles carry their questions now.)
 */

/** Every network path the tiles could take is a spy — zero requests allowed. */
const fetchSpy = vi.fn(() => Promise.reject(new Error('metrics tiles must not fetch')));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  useGateStore.setState({ gates: {} });
  useRuntimeStore.setState({ logs: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
});

describe('outcomeOf — the one status → outcome partition', () => {
  it('maps statuses to outcome classes (cancelled is its OWN class — J5/A5)', () => {
    expect(outcomeOf('executing')).toBe('run');
    expect(outcomeOf('awaiting_human')).toBe('gate');
    expect(outcomeOf('failed')).toBe('fail');
    expect(outcomeOf('cancelled')).toBe('cancelled');
    expect(outcomeOf('completed')).toBe('done');
  });
});
