import { ApiError } from '../../api/errors.js';
import { ensureWorkingDoc, getWorkingDoc, proposeWorkingDoc, type WorkingDocSectionId, type WorkingDocView } from '../../api/workingDoc.js';
import type { HostDoc } from '../../editors/host.js';

/**
 * The working-document seam a run-thread block hands its plugin (power mode spike 3), and the host's own "Send to the
 * next step". Pure over its deps so the rules are tested without a frame:
 *  - the run and plugin are read AT CALL TIME (a block reused for another run never touches the old one);
 *  - every read and write is numbered and only the newest answer lands in the store (a slow read never rolls the
 *    document or its thread rows back);
 *  - a missing route is `unsupported`, a failed read `unavailable` (the plugin keeps what it showed);
 *  - a person's first edit makes the document and is made on its FIRST version (a document someone already changed
 *    answers a conflict, never an overwrite); a plugin's lines never start one.
 */
export interface SeamDeps {
  current(): { runId: string; plugin: { id: string; version: string } };
  land(runId: string, view: WorkingDocView): void;
  api?: { get: typeof getWorkingDoc; ensure: typeof ensureWorkingDoc; propose: typeof proposeWorkingDoc };
}

const API = { get: getWorkingDoc, ensure: ensureWorkingDoc, propose: proposeWorkingDoc };

export function workingDocSeam(d: SeamDeps): HostDoc & { appendToNext(text: string, known: WorkingDocView | undefined): Promise<WorkingDocView> } {
  const api = d.api ?? API;
  let seq = 0;
  const landIfNewest = (mine: number, runId: string, view: WorkingDocView): void => { if (mine === seq) d.land(runId, view); };
  return {
    read: async () => {
      const { runId } = d.current();
      const mine = ++seq;
      try {
        const view = await api.get(runId);
        if (view === null) return { error: 'unsupported', message: 'this version of studio’s service keeps no working document' };
        landIfNewest(mine, runId, view);
        return { view };
      } catch (e) {
        return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) };
      }
    },
    propose: async (edit, by) => {
      const { runId, plugin } = d.current();
      const mine = ++seq;
      try {
        let base = edit.base;
        if (base < 0) {
          if (by === 'plugin') return { error: 'refused', message: 'this job has no working document yet' };
          await api.ensure(runId);
          base = 0;
        }
        const r = await api.propose(runId, { base, author: by, plugin: { id: plugin.id, version: plugin.version }, sections: { [edit.section as WorkingDocSectionId]: edit.text } });
        landIfNewest(mine, runId, r.view);
        return { version: r.version, unchanged: r.unchanged, by };
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return { error: 'head_moved', message: 'the working document changed since' };
        if (e instanceof ApiError && (e.status === 403 || e.status === 400)) return { error: 'refused', message: e.message };
        return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) };
      }
    },
    /** The host's own Send (a person's click): the note is ADDED to what Next already says, read from the document as
     *  it is (made first if there is none), never from an empty guess. */
    appendToNext: async (text, known) => {
      const { runId, plugin } = d.current();
      const view = known?.doc != null && known.sections != null ? known : await api.ensure(runId);
      const next = [view.sections?.next ?? '', text].filter((x) => x.trim() !== '').join('\n');
      const mine = ++seq;
      const r = await api.propose(runId, { base: view.doc?.head ?? 0, author: 'operator', plugin: { id: plugin.id, version: plugin.version }, sections: { next } });
      landIfNewest(mine, runId, r.view);
      return r.view;
    },
  };
}
