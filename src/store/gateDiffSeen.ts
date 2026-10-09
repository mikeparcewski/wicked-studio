import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { diffstatOf } from '../components/gateMoveModel.js';

/**
 * studio#244: "is the thing I am approving now the thing I approved before?"
 *
 * When the operator commits a gate decision, the run's diff at that moment (`GET /runs/:id/diff`,
 * merge-base) is recorded per run — each file's patch as a short hash — in localStorage under
 * `studio.gateDiffSeen` (the latest review only, so a reload keeps it). Every later gate of the
 * run compares the current diff to it: unchanged, or which files differ. No record → nothing is
 * said; the card never guesses. Browser-local on purpose: "what did THIS person last review" is a
 * per-browser fact, like the visit clock (`store/visit.ts`).
 */

export const GATE_DIFF_SEEN_KEY = 'studio.gateDiffSeen';
/** Runs kept; the oldest record goes first. */
const MAX_RUNS = 50;

export interface DiffSeen {
  /** The gate the decision answered. */
  ord: number;
  at: number;
  /** path → hash of that file's patch. */
  files: Record<string, string>;
}

export type DiffDrift =
  | { kind: 'same'; ord: number }
  | { kind: 'changed'; ord: number; paths: string[]; now: string | null };

/** FNV-1a (32-bit) as hex — identity of a patch, not a security hash. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A unified diff split per file (`diff --git a/<p> b/<p>`), each file's patch hashed. */
export function diffFiles(diff: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = diff.split(/^(?=diff --git )/m);
  for (const part of parts) {
    const head = /^diff --git a\/(\S+) b\/(\S+)/.exec(part);
    if (head === null) continue;
    out[head[2]!] = fnv(part);
  }
  return out;
}

/** The comparison the gate states. `null` when there is no record to compare with. */
export function diffDrift(seen: DiffSeen | null, nowDiff: string): DiffDrift | null {
  if (seen === null) return null;
  const now = diffFiles(nowDiff);
  const paths = [...new Set([...Object.keys(seen.files), ...Object.keys(now)])]
    .filter((p) => seen.files[p] !== now[p])
    .sort();
  return paths.length === 0 ? { kind: 'same', ord: seen.ord } : { kind: 'changed', ord: seen.ord, paths, now: diffstatOf(nowDiff) };
}

/** The one line the gate shows. */
export function driftLine(d: DiffDrift): string {
  if (d.kind === 'same') return `Diff unchanged since your review at unit ${d.ord}.`;
  const shown = d.paths.slice(0, 3).join(', ');
  const more = d.paths.length > 3 ? ` and ${d.paths.length - 3} more` : '';
  return `Diff changed since your review at unit ${d.ord}: ${d.paths.length} file${d.paths.length === 1 ? '' : 's'} differ (${shown}${more})${d.now !== null ? ` · now ${d.now}` : ''}.`;
}

function readAll(): Record<string, DiffSeen> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(GATE_DIFF_SEEN_KEY) ?? 'null');
    if (raw === null || typeof raw !== 'object') return {};
    const out: Record<string, DiffSeen> = {};
    for (const [run, v] of Object.entries(raw as Record<string, unknown>)) {
      const o = v as Record<string, unknown> | null;
      if (o === null || typeof o !== 'object' || typeof o.ord !== 'number' || typeof o.at !== 'number' || o.files === null || typeof o.files !== 'object') continue;
      out[run] = { ord: o.ord, at: o.at, files: o.files as Record<string, string> };
    }
    return out;
  } catch {
    return {};
  }
}

export function seenFor(runId: string): DiffSeen | null {
  return readAll()[runId] ?? null;
}

export function recordSeen(runId: string, seen: DiffSeen): void {
  const all = readAll();
  all[runId] = seen;
  const runs = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_RUNS);
  try {
    window.localStorage.setItem(GATE_DIFF_SEEN_KEY, JSON.stringify(Object.fromEntries(runs)));
  } catch {
    /* storage unavailable (private mode, quota): the drift line is best-effort */
  }
}

/** Read the diff the operator is deciding on — issued BEFORE the decision is posted, so it is the
 *  tree the gate showed, not one the resumed run went on to change. Best-effort: a failed read is
 *  `null`, and nothing is recorded (the next gate then says nothing rather than something wrong). */
export function readDecisionDiff(runId: string): Promise<Record<string, string> | null> {
  return api.getRunDiff(runId, undefined, 'merge-base')
    .then((d) => (typeof d.diff === 'string' ? diffFiles(d.diff) : null))
    .catch(() => null);
}

/**
 * The drift line for an open gate, or null: the record the operator's LAST decision on this run left
 * (made before this gate instance opened — `receivedAt`), compared with the current diff.
 */
export function useDiffDrift(runId: string, gate: { ord: number; receivedAt: number } | undefined): DiffDrift | null {
  const key = gate === undefined ? null : `${runId}:${gate.ord}:${gate.receivedAt}`;
  const [drift, setDrift] = useState<{ key: string; d: DiffDrift | null } | null>(null);
  useEffect(() => {
    if (key === null || gate === undefined) return;
    const seen = seenFor(runId);
    if (seen === null || seen.at >= gate.receivedAt) { setDrift({ key, d: null }); return; }
    let live = true;
    api.getRunDiff(runId, undefined, 'merge-base')
      .then((r) => { if (live) setDrift({ key, d: typeof r.diff === 'string' ? diffDrift(seen, r.diff) : null }); })
      .catch(() => { if (live) setDrift({ key, d: null }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return drift !== null && drift.key === key ? drift.d : null;
}
