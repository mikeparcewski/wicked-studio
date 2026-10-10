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

/** The path a `diff --git` header names, for display — spaces and git's quoting included (codex
 *  r1); the whole header when it does not parse, so no patch is ever dropped from the comparison. */
function headerPath(header: string): string {
  const m = /^diff --git (?:"a\/(.+)"|a\/(.+)) (?:"b\/(.+)"|b\/(.+))$/.exec(header);
  return m === null ? header.replace(/^diff --git /, '') : (m[3] ?? m[4] ?? m[1] ?? m[2])!;
}

/** A unified diff split per file (each `diff --git` header starts one), each file's patch hashed,
 *  keyed by the WHOLE header (codex r2: a path guessed out of a spaced header can collide). */
export function diffFiles(diff: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of diff.split(/^(?=diff --git )/m)) {
    if (!part.startsWith('diff --git ')) continue;
    const header = part.slice(0, part.indexOf('\n') === -1 ? part.length : part.indexOf('\n'));
    out[header] = fnv(part);
  }
  return out;
}

/** The comparison the gate states. `null` when there is no record to compare with. */
export function diffDrift(seen: DiffSeen | null, nowDiff: string): DiffDrift | null {
  if (seen === null) return null;
  const now = diffFiles(nowDiff);
  const paths = [...new Set([...Object.keys(seen.files), ...Object.keys(now)])]
    .filter((p) => seen.files[p] !== now[p])
    .map(headerPath)
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

/**
 * What the open gate SHOWED (codex r1 on #644): the diff its row read when it rendered, per run and
 * gate instance. The decision records THIS snapshot — never a read made at decision time, which could
 * race the resumed run and record changes the operator never saw, and never a wait in the send path.
 * In memory only; a decision with no row on screen (the palette, a Desk key) records nothing.
 */
const shown = new Map<string, Record<string, string>>();
/** One gate instance (codex r3: keyed per instance, so a late read for an older gate never
 *  overwrites the open gate's snapshot). */
const instanceKey = (runId: string, ord: number, receivedAt: number): string => `${runId}:${ord}:${receivedAt}`;

/** Called by the one decision path once a decision on (`ord`, `receivedAt`) was accepted. */
export function recordShown(runId: string, ord: number | undefined, receivedAt: number | undefined, at: number = Date.now()): void {
  if (typeof ord !== 'number' || typeof receivedAt !== 'number') return;
  const k = instanceKey(runId, ord, receivedAt);
  const files = shown.get(k);
  if (files === undefined) return;
  // This run's other snapshots are older gates: none of them can be decided any more.
  for (const key of [...shown.keys()]) if (key.startsWith(`${runId}:`)) shown.delete(key);
  recordSeen(runId, { ord, at, files });
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
    const prior = seen !== null && seen.at < gate.receivedAt ? seen : null;
    let live = true;
    // One read per gate instance: it is both what this gate shows (kept for its decision) and what
    // the drift line compares against the last review.
    Promise.resolve()
      .then(() => api.getRunDiff(runId, undefined, 'merge-base'))
      .then((r) => {
        if (typeof r?.diff !== 'string') { if (live) setDrift({ key, d: null }); return; }
        shown.set(instanceKey(runId, gate.ord, gate.receivedAt), diffFiles(r.diff));
        if (live) setDrift({ key, d: diffDrift(prior, r.diff) });
      })
      .catch(() => { if (live) setDrift({ key, d: null }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return drift !== null && drift.key === key ? drift.d : null;
}
