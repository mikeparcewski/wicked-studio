import { applyChapterOp, defaultVideoStyle, timedCut, type DemoCut, type VideoStyle } from '../demoCutModel.js';
import type { AdapterResult, HostAdapter } from '../host.js';
import { chapterInventoryOf, checkOps, type WireItem } from '../ops.js';

/** Scripted adapter conventions from fakeAdapter.ts: immutable snapshots, observable writes, Undo. */
export const demoCut4: DemoCut = timedCut({ type: 'demo-cut', title: 'Build a team', rev: 1, version: 1,
  chapters: ['open-the-scope', 'pick-a-plan', 'add-a-seat', 'invite-the-team'].map((id, i) => ({
    id, title: ['Open the scope', 'Pick a plan', 'Add a seat', 'Invite the team'][i]!,
    say: ['Open the scope to see what your team will build.', 'Pick the plan that fits your work.', 'Add a seat for the next teammate.', 'Invite the team and start working together.'][i]!,
    take: `_take-${id}-1.webm`, inSec: 0, outSec: [8, 10, 6, 12][i]!, durationSec: 0, startSec: 0,
  })),
  takes: Object.fromEntries(['open-the-scope', 'pick-a-plan', 'add-a-seat', 'invite-the-team'].map((id, i) => [id, Array.from({ length: i % 2 === 0 ? 2 : 1 }, (_, n) => ({ file: `_take-${id}-${n + 1}.webm`, durationSec: [8, 10, 6, 12][i]! + n }))])),
  style: defaultVideoStyle('Build a team'),
  ffmpeg: { ok: true, burnIn: true },
});
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export function fakeDemoCutAdapter(initial: DemoCut = demoCut4) {
  let cut = copy(initial);
  const snapshots = new Map<number, DemoCut>([[cut.version, copy(cut)]]);
  const entries = [{ version: cut.version, parent: null as number | null, createdAt: new Date(0).toISOString() }];
  const writes: { base: number; items: WireItem[]; summary: string }[] = [];
  const stale = (base: number): { error: 'head_moved'; message: string; head: number } | null => base === cut.version ? null : { error: 'head_moved', message: 'The cut changed since.', head: cut.version };
  const land = (next: DemoCut): { version: number } => {
    const parent = cut.version;
    cut = timedCut({ ...copy(next), rev: cut.rev + 1, version: cut.version + 1 });
    snapshots.set(cut.version, copy(cut));
    entries.push({ version: cut.version, parent, createdAt: new Date().toISOString() });
    return { version: cut.version };
  };
  const adapter = {
    writes,
    artifact: () => ({ kind: 'demo-video', title: cut.title, version: cut.version, head: cut.version, readonly: false, lockedParts: [] }),
    async read(version?: number): Promise<AdapterResult<{ version: number; content: DemoCut & Record<string, unknown> }>> {
      const c = snapshots.get(version ?? cut.version);
      return c === undefined ? { error: 'bad_request', message: 'No such cut.' } : { version: c.version, content: { ...copy(c) } };
    },
    async versions() { return { versions: copy(entries), head: cut.version }; },
    async write(base: number, items: WireItem[], summary: string): Promise<AdapterResult<{ version: number }>> {
      const s = stale(base); if (s !== null) return s;
      if (items.length !== 1 || items[0]?.type !== 'chapter') return { error: 'bad_request', message: 'One chapter edit per cut.' };
      const check = checkOps([items[0].op], chapterInventoryOf(cut));
      if (!check.ok) return { error: check.code, message: check.message };
      writes.push({ base, items: copy(items), summary });
      return land(applyChapterOp(cut, items[0].op));
    },
    async theme(base: number, tokens: Record<string, unknown>): Promise<AdapterResult<{ version: number }>> {
      const s = stale(base); if (s !== null) return s;
      if (tokens['kind'] !== 'video-style' || typeof tokens['style'] !== 'object' || tokens['style'] === null) return { error: 'bad_request', message: 'Expected a video style.' };
      return land({ ...cut, style: copy(tokens['style'] as VideoStyle) });
    },
    async media() { return { type: 'video/webm', blob: new Blob([], { type: 'video/webm' }) }; },
    async undo(version: number): Promise<AdapterResult<{ undone: true }>> {
      const s = stale(version); if (s !== null) return s;
      const parent = entries.find(e => e.version === version)?.parent;
      const c = parent == null ? undefined : snapshots.get(parent);
      if (c === undefined) return { error: 'refused', message: 'Nothing to undo.' };
      const r = land(c); return { undone: true, moved: { head: r.version, kind: 'fork' } };
    },
    async fork(from: number): Promise<AdapterResult<{ version: number }>> {
      const c = snapshots.get(from);
      return c === undefined ? { error: 'bad_request', message: 'No such cut.' } : land(c);
    },
  } satisfies HostAdapter & { writes: typeof writes };
  return adapter;
}
