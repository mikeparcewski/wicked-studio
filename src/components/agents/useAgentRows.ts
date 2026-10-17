import { useEffect, useMemo, useState } from 'react';
import { agentRows, attention, type AgentRow } from '../../board/agentsModel.js';
import { DEFAULT_CLIS_KEY } from '../../board/docSeats.js';
import { agentsSettled, ensureAgentsRead, followRosterCache, useAgentsReads, type ReadState } from '../../store/agentsReads.js';

/** The stored default agents for new work (`wicked_default_clis`), or `null` for the default rule. */
export function storedDefaults(): string[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(DEFAULT_CLIS_KEY) ?? null;
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Pick an agent for new work, or leave it out (the stored defaults the composers read). Written as the
 * whole list of picked agents, so the default rule stops applying once a choice is made; every surface
 * that reads the rows hears it at once (a `storage` event).
 */
export function setPickedForNewWork(rows: readonly AgentRow[], key: string, on: boolean): void {
  // codex r1: change this one key in what is stored (keys no row shows — a folded reviewer seat, a seat
  // away right now — stay); with nothing stored yet, start from what the default rule picks.
  const base = storedDefaults() ?? rows.flatMap((r) => (r.picked ? r.keys : []));
  const next = on ? [...new Set([...base, key])] : base.filter((k) => k !== key);
  try {
    globalThis.localStorage?.setItem(DEFAULT_CLIS_KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent('storage', { key: DEFAULT_CLIS_KEY }));
  } catch { /* storage unavailable: the choice stays as it was */ }
}

export interface AgentRowsView {
  rows: AgentRow[];
  /** A roster is in hand (read now, or kept from an earlier read). */
  hasRoster: boolean;
  rosterState: ReadState;
  rosterError: unknown;
  diagState: ReadState;
  recordState: ReadState;
  /** Every source answered (ok, failed or absent). */
  settled: boolean;
  readAt: number | null;
  /** Jobs the week's record read, or `null` when it was not read. */
  runsRead: number | null;
  /** The rail's count: `null` until the roster answered and the other reads settled (UI-CONTRACT §1.6). */
  attention: { count: number; tone: 'fail' | 'gate' | null } | null;
  reload: () => Promise<void>;
}

/** The soonest `recent_bench.lifts_at` still ahead of `now`, or null. */
export function nextBenchEnd(roster: readonly { recent_bench?: { lifts_at?: string | null } | null }[] | null, now: number): number | null {
  let next: number | null = null;
  for (const seat of roster ?? []) {
    const t = Date.parse(seat.recent_bench?.lifts_at ?? '');
    if (Number.isFinite(t) && t > now && (next === null || t < next)) next = t;
  }
  return next;
}

/** The Agents rows over the shared reads; starts the read once if nothing has. */
export function useAgentRows(): AgentRowsView {
  const s = useAgentsReads();
  useEffect(() => { ensureAgentsRead(); return followRosterCache(); }, []);
  // The stored defaults, re-read when another tab writes them or this window regains focus (codex PR r1).
  const [defaultsKey, setDefaultsKey] = useState(() => JSON.stringify(storedDefaults()));
  useEffect(() => {
    const reread = (): void => setDefaultsKey(JSON.stringify(storedDefaults()));
    window.addEventListener('storage', reread);
    window.addEventListener('focus', reread);
    return () => { window.removeEventListener('storage', reread); window.removeEventListener('focus', reread); };
  }, []);
  // Rows read the clock (an active bench ends at `lifts_at`): re-derive them when the next one passes,
  // scheduled from the same clock reading the rows used, so a bench ending in between still ticks (codex #759 r1, r4).
  const [tick, setTick] = useState(0);
  const { rows, at } = useMemo(() => {
    const now = Date.now();
    return { at: now, rows: s.roster === null ? [] : agentRows({ roster: s.roster, acpByCli: s.acpByCli, record: s.record, defaults: JSON.parse(defaultsKey) as string[] | null, now }) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is the clock: it re-derives the rows when a bench ends.
  }, [s.roster, s.acpByCli, s.record, defaultsKey, tick]);
  useEffect(() => {
    const next = nextBenchEnd(s.roster, at);
    if (next === null) return;
    const id = window.setTimeout(() => setTick((t) => t + 1), Math.min(Math.max(0, next - Date.now()) + 1000, 2 ** 31 - 1));
    return () => window.clearTimeout(id);
  }, [s.roster, at]);
  const settled = agentsSettled(s);
  return {
    rows,
    hasRoster: s.roster !== null,
    rosterState: s.rosterState,
    rosterError: s.rosterError,
    diagState: s.diagState,
    recordState: s.recordState,
    settled,
    readAt: s.readAt,
    runsRead: s.record?.runsRead ?? null,
    // The count reads only the roster (crew's issues; diagnostics add notes, which never count, Q6).
    attention: settled && s.rosterState === 'ok' && s.roster !== null ? attention(rows) : null,
    reload: s.load,
  };
}
