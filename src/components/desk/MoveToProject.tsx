import { useCallback, useEffect, useId, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { FolderInput } from 'lucide-react';
import { create } from 'zustand';
import { api } from '../../api/client.js';
import type { ProjectMember, SessionView } from '../../api/types.js';
import type { RailSession } from '../../board/deskModel.js';
import { useBoardModel } from '../../hooks/useBoardModel.js';
import { useDismissable } from '../../hooks/useDismissable.js';
import { useMembershipStore } from '../../store/membership.js';
import { useProjectsStore } from '../../store/projects.js';

// Confirmed writes must reach both mounted board models, even while their runs prop
// still carries the previous project_id. Keep this bridge local to the two surfaces.
export const useProjectMoves = create<{
  projectsByRun: Record<string, string | null>;
  announcement: string;
}>(() => ({ projectsByRun: {}, announcement: '' }));

export function useMovableBoardModel(runs: SessionView[]): ReturnType<typeof useBoardModel> {
  const projectsByRun = useProjectMoves((s) => s.projectsByRun);
  const placedRuns = useMemo(() => runs.map((v) => Object.hasOwn(projectsByRun, v.session.id)
    ? { ...v, session: { ...v.session, project_id: projectsByRun[v.session.id] ?? null } }
    : v), [runs, projectsByRun]);
  // Once the shell receives Crew's updated DTO, relinquish the temporary placement.
  useEffect(() => {
    const settled = runs.filter((v) => Object.hasOwn(projectsByRun, v.session.id) && v.session.project_id === projectsByRun[v.session.id]);
    if (settled.length === 0) return;
    useProjectMoves.setState((s) => {
      const next = { ...s.projectsByRun };
      for (const v of settled) if (next[v.session.id] === v.session.project_id) delete next[v.session.id];
      return { projectsByRun: next };
    });
  }, [runs, projectsByRun]);
  return useBoardModel(placedRuns);
}

export function MoveProjectStatus(): React.ReactElement {
  const announcement = useProjectMoves((s) => s.announcement);
  return <span role="status" className="wk-desk-move-status">{announcement}</span>;
}

/** Moves run one at a time (codex review r1): two surfaces moving the same work can never both read
 *  the old membership and attach to two destinations. */
let queue: Promise<unknown> = Promise.resolve();
export function moveToProject(...args: Parameters<typeof moveNow>): Promise<void> {
  const next = queue.then(() => moveNow(...args));
  queue = next.catch(() => {});
  return next;
}

/** Crew clears its membership index on detach: ALL detaches precede ANY attach. */
async function moveNow(session: RailSession, runs: SessionView[], oldProject: string | null, target: string | null): Promise<void> {
  const chatId = session.id.startsWith('run:') ? null : session.id;
  // A chat may already be split across groups; include its runs from the whole list.
  const runIds = [...new Set([...session.runIds, ...runs.filter((v) => chatId !== null && v.session.chat_id === chatId).map((v) => v.session.id)])];
  const refs = [
    ...(chatId === null ? [] : [{ kind: 'crew.chat', ref: chatId }]),
    ...runIds.map((ref) => ({ kind: 'crew.run', ref })),
  ];
  const projects = useProjectsStore.getState().projects;
  const moved = useProjectMoves.getState().projectsByRun;
  const membership = useMembershipStore.getState();
  const oldIds = new Set<string>();
  if (oldProject !== null && oldProject !== 'default') oldIds.add(oldProject);
  const chatProject = chatId === null ? undefined : membership.projectIdByRun[chatId];
  if (chatProject && chatProject !== 'default') oldIds.add(chatProject);
  for (const v of runs.filter((v) => runIds.includes(v.session.id))) {
    const id = Object.hasOwn(moved, v.session.id) ? moved[v.session.id] : v.session.project_id ?? membership.projectIdByRun[v.session.id];
    if (id && id !== 'default') oldIds.add(id);
  }
  const removed: { projectId: string; member: ProjectMember }[] = [];
  const attached: ProjectMember[] = [];
  try {
    // Read every old membership before making a write, so a failed read leaves work alone.
    const oldMembers = await Promise.all([...oldIds].map(async (projectId) => ({ projectId, ...(await api.listProjectMembers(projectId)) })));
    for (const { projectId, members } of oldMembers) {
      for (const member of members.filter((m) => refs.some((r) => r.kind === m.member_kind && r.ref === m.member_ref))) {
        await api.detachProjectMember(projectId, member.id);
        removed.push({ projectId, member });
      }
    }
    if (target !== null) {
      for (const ref of refs) {
        const { member } = await api.attachProjectMember(target, { ...ref, attachedBy: 'studio' });
        attached.push(member);
      }
    }
  } catch {
    // Compensate partial writes in the same order (detach first), each step on its own so one failed
    // repair never abandons the rest (codex review r1). Never publish a failed move.
    let unrestored = 0;
    for (const member of attached) {
      try { await api.detachProjectMember(target!, member.id); } catch { unrestored += 1; }
    }
    for (const { projectId, member } of removed) {
      try { await api.attachProjectMember(projectId, { kind: member.member_kind, ref: member.member_ref, attachedBy: 'studio' }); } catch { unrestored += 1; }
    }
    if (unrestored > 0) throw new Error('Couldn’t finish moving or restore all of this work. Try again.');
    throw new Error('Couldn’t move this work. It stays where it was. Try again.');
  }
  const latestMembership = useMembershipStore.getState();
  const names = { ...latestMembership.projectNameByRun };
  const ids = { ...latestMembership.projectIdByRun };
  const clocks = { ...latestMembership.attachedAtByRun };
  for (const ref of refs) {
    delete names[ref.ref]; delete ids[ref.ref]; delete clocks[ref.ref];
    if (target !== null) {
      names[ref.ref] = projects.find((p) => p.id === target)?.name ?? '';
      ids[ref.ref] = target;
      const member = attached.find((m) => m.member_kind === ref.kind && m.member_ref === ref.ref);
      if (member !== undefined) clocks[ref.ref] = member.attached_at;
    }
  }
  useMembershipStore.setState({ projectNameByRun: names, projectIdByRun: ids, attachedAtByRun: clocks });
  useProjectMoves.setState((s) => ({
    projectsByRun: { ...s.projectsByRun, ...Object.fromEntries(runIds.map((id) => [id, target])) },
    announcement: target === null ? `${session.title} is now not in a project.` : `${session.title} moved to ${projects.find((p) => p.id === target)?.name ?? 'the project'}.`,
  }));
}

export function MoveToProject({ session, projectId, runs }: { session: RailSession; projectId: string | null; runs: SessionView[] }): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const pickerId = useId();
  const close = useCallback(() => { if (!busy) setOpen(false); }, [busy]);
  useDismissable(open, close, container, trigger);
  useEffect(() => { if (open) picker.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [open]);
  // studio#723: the picker is placed against the VIEWPORT (fixed), below the trigger or above it when
  // there is more room there, and never taller than that room — so the rail's scroller and its fixed
  // Workspace footer can no longer clip the last projects; it scrolls within its own box.
  const [place, setPlace] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || trigger.current === null) { setPlace(null); return; }
    const r = trigger.current.getBoundingClientRect();
    const vh = window.innerHeight; const vw = window.innerWidth; const w = Math.min(240, vw - 16);
    const below = vh - r.bottom - 8; const above = r.top - 8;
    const left = Math.max(8, Math.min(r.right - w, vw - w - 8));
    setPlace(below >= 220 || below >= above
      ? { position: 'fixed', top: r.bottom + 4, bottom: 'auto', left, right: 'auto', width: w, maxHeight: Math.max(120, below) }
      : { position: 'fixed', top: 'auto', bottom: vh - r.top + 4, left, right: 'auto', width: w, maxHeight: Math.max(120, above) });
  }, [open]);
  // A fixed picker would detach from its row when the rail scrolls or the window resizes: close it.
  useEffect(() => {
    if (!open) return;
    const onMove = (e: Event): void => { if (picker.current !== null && e.target instanceof Node && picker.current.contains(e.target)) return; close(); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  }, [open, close]);
  async function choose(target: string | null): Promise<void> {
    if (busy) return;
    setBusy(true); setError(null);
    // The originating surface, read BEFORE the await: the row may unmount once placement updates.
    const surface = container.current?.closest<HTMLElement>('[data-testid="session-rail"], .wk-desk-side') ?? null;
    try {
      await moveToProject(session, runs, projectId, target);
      setOpen(false);
      // The old row may disappear; focus the same action in the destination group of the SAME
      // surface (the rail and the Desk both list it; at 390 px the rail sits in a closed drawer),
      // else that surface's first move button, so focus is never lost (codex review r1).
      requestAnimationFrame(() => {
        if (surface === null) return;
        const row = [...surface.querySelectorAll<HTMLElement>('[data-move-row]')].find((e) => e.dataset.moveRow === session.id);
        (row?.querySelector<HTMLButtonElement>('[data-testid="session-move"]')
          ?? surface.querySelector<HTMLButtonElement>('[data-testid="session-move"]'))?.focus();
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Couldn’t move this work. Try again.';
      setError(message);
      useProjectMoves.setState({ announcement: message });
    } finally { setBusy(false); }
  }
  return (
    <div ref={container} className="wk-desk-move">
      <button ref={trigger} type="button" data-testid="session-move" className="wk-btn wk-btn--quiet wk-btn--icon wk-btn--sm wk-desk-move-trigger"
        aria-label={`Move ${session.title} to a project`} title="Move to project…" aria-expanded={open} aria-controls={open ? pickerId : undefined}
        onClick={() => { setError(null); setOpen((v) => !v); }}>
        <FolderInput size={16} aria-hidden="true" />
      </button>
      {open && <div ref={picker} id={pickerId} data-testid="session-move-picker" className="wk-desk-move-picker" role="group" aria-label={`Move ${session.title} to a project`} aria-busy={busy} style={place ?? undefined}>
        <p className="wk-desk-label">Move to project…</p>
        {projects.filter((p) => p.id !== 'default' && p.status === 'active').map((p) => (
          p.id === projectId
            ? <p key={p.id} className="wk-desk-move-here" aria-current="true">{p.name} · here now</p>
            : <button key={p.id} type="button" className="wk-btn wk-btn--quiet wk-btn--sm wk-desk-move-item" disabled={busy} onClick={() => { void choose(p.id); }}>{p.name}</button>
        ))}
        {projectId === null || projectId === ''
          ? <p className="wk-desk-move-here" aria-current="true">Not in a project · here now</p>
          : <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm wk-desk-move-item" disabled={busy} onClick={() => { void choose(null); }}>Not in a project</button>}
        {busy && <p className="wk-desk-quiet">Moving…</p>}
        {error !== null && <p role="alert" className="wk-desk-move-error">{error}</p>}
        <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" disabled={busy} onClick={() => { setOpen(false); trigger.current?.focus(); }}>Cancel</button>
      </div>}
    </div>
  );
}
