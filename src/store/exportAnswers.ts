// The click site's export answers, held OUTSIDE the component (round-3 J3).
//
// DES-UX-001 §7.2 (B5/EC37) makes the clicked control answer PENDING → READY/FAILED
// at the click site. Round 2 found the answer could still end up NOWHERE with the
// thread drawer closed: the answer lived in ExportMenu's local state, keyed to the
// CURRENTLY addressed version — so a landing that advanced the head (the route
// follows the head), a strip re-render, or any selection change wiped the un-acted
// answer out from under the user, and the only other copy sat in a closed drawer.
//
// The store fixes both failure shapes at once:
//   - the answer survives the component's own churn (remounts, selection moves,
//     head-follow landings) because it is not component state;
//   - an un-acted answer for ANOTHER version of the same doc stays VISIBLE at the
//     click site, labeled with its own version — which also keeps the original
//     §7.2 rule honest (a v3 artifact never sits under a bare "Export v4" label;
//     it sits beside it saying v3).
//
// An answer retires only when the user ACTS on it: downloading a READY artifact
// consumes it; re-running the same version+format replaces a FAILED hint. Session-
// transient by design — the durable record is the thread transcript (§4.4).

import { create } from 'zustand';
import type { ExportFormat } from '../api/interactive.js';

export type ExportAnswer =
  | { state: 'pending'; version: number; format: ExportFormat }
  | { state: 'ready'; version: number; format: ExportFormat; href: string; file: string }
  | { state: 'failed'; version: number; format: ExportFormat; hint: string };

/** One click site's identity: the doc, on its project mount. */
export function exportKey(projectId: string, docId: string): string {
  return `${projectId}:${docId}`;
}

interface ExportAnswersStore {
  /** Per exportKey: every un-acted answer, at most one per (version, format). */
  answers: Record<string, ExportAnswer[]>;
  /** A run begins: PENDING replaces any previous answer for the same version+format. */
  begin: (key: string, version: number, format: ExportFormat) => void;
  /** The run resolved: the pending entry becomes READY or FAILED. */
  settle: (key: string, answer: ExportAnswer) => void;
  /** The user acted on the answer (downloaded / dismissed): it retires. */
  consume: (key: string, version: number, format: ExportFormat) => void;
  /** Test seam. */
  clear: () => void;
}

function without(list: ExportAnswer[], version: number, format: ExportFormat): ExportAnswer[] {
  return list.filter((a) => a.version !== version || a.format !== format);
}

export const useExportAnswers = create<ExportAnswersStore>((set) => ({
  answers: {},

  begin: (key, version, format) =>
    set((s) => ({
      answers: {
        ...s.answers,
        [key]: [...without(s.answers[key] ?? [], version, format),
                { state: 'pending', version, format }],
      },
    })),

  settle: (key, answer) =>
    set((s) => ({
      answers: {
        ...s.answers,
        [key]: [...without(s.answers[key] ?? [], answer.version, answer.format), answer],
      },
    })),

  consume: (key, version, format) =>
    set((s) => ({
      answers: { ...s.answers, [key]: without(s.answers[key] ?? [], version, format) },
    })),

  clear: () => set({ answers: {} }),
}));

/** Stable empty list so selectors never mint a fresh array per render. */
export const NO_ANSWERS: ExportAnswer[] = [];
