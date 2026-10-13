import { useEffect, useMemo } from 'react';
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

/** The Agents rows over the shared reads; starts the read once if nothing has. */
export function useAgentRows(): AgentRowsView {
  const s = useAgentsReads();
  useEffect(() => { ensureAgentsRead(); return followRosterCache(); }, []);
  const rows = useMemo(
    () => (s.roster === null ? [] : agentRows({ roster: s.roster, governance: s.governance, acpByCli: s.acpByCli, record: s.record, defaults: storedDefaults(), now: Date.now() })),
    [s.roster, s.governance, s.acpByCli, s.record],
  );
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
    attention: settled && s.rosterState === 'ok' && s.roster !== null ? attention(rows) : null,
    reload: s.load,
  };
}
