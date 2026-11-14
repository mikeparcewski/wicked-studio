/**
 * The code adapter for the ring model (Graph rings, part 1). It owns everything code-specific — how a
 * blast radius becomes rings, the collapse/paging state, the owner map, the ring labels, the block
 * order and the refusal wording — and hands ringModel.ts only placed nodes, drawn items, an ownerOf
 * and a levelLabel. ringModel knows nothing of files, symbols or hops.
 *
 * Ids are tagged: q:<query> (the centre), n:<symbolId>, g:<level>:<encodedFile> (a file group),
 * m:<level>:files (a ring's "+N more files"), m:<groupId> (a group's "+N more" members), s:<k>
 * (the summary). The tags are this module's private contract; ringModel never parses one.
 */

import {
  type AdapterView,
  type Item,
  type RingInput,
  type VisibleModel,
  tryApply as tryApplyCore,
  visibleModel,
} from './ringModel.js';

export interface CodeRow {
  symbolId: string;
  name: string;
  file: string;
  /** blast depth; placed when an integer ≥ 1, otherwise the row is unplaced. */
  depth: number | null;
}

export interface CodeSliceNode {
  symbolId: string;
  name: string;
  file: string;
}

/** A raw dependency edge, read as "src depends on tgt"; endpoints are symbolIds or the query name. */
export interface CodeRawEdge {
  src: string;
  tgt: string;
}

export interface CodeBlastInput {
  query: string;
  rows: CodeRow[];
  edges: CodeRawEdge[];
  /** the broader loaded slice (optional); a slice node with no row is a centre member or loaded-not-placed. */
  sliceNodes?: CodeSliceNode[];
}

export interface CollapseState {
  openLevel: number;
  /** level → pages of 12 files shown (absent = 1). */
  filePages: Readonly<Record<number, number>>;
  /** open group ids. */
  openGroups: ReadonlySet<string>;
  /** group id → pages of 20 members shown (absent = 1). */
  memberPages: Readonly<Record<string, number>>;
}

export const INLINE_MAX = 24; // a level with ≤ this many rows shows symbols inline
export const FILE_PAGE = 12; // files per "+N more files" page
export const MEMBER_PAGE = 20; // members per "+N more" page
export const DEFAULT_LIMIT = 150; // the largest level whose closed view stays under this is openLevel

export interface BlockDescriptor {
  level: number;
  kind: 'symbol' | 'group' | 'more-files';
  id: string;
  label: string;
  count: number;
  file?: string;
  open?: boolean;
  /** for a group: the full member list (tagged ids), sorted by label then id, regardless of paging. */
  members?: string[];
}

interface PlacedSymbol {
  symbolId: string;
  id: string; // n:<symbolId>
  name: string;
  file: string;
  level: number;
}

interface FileBlock {
  file: string;
  groupId: string; // g:<level>:<enc>
  members: PlacedSymbol[]; // sorted by (label, id)
  count: number;
}

const enc = (file: string): string => encodeURIComponent(file);
const groupIdOf = (level: number, file: string): string => `g:${level}:${enc(file)}`;
const moreFilesId = (level: number): string => `m:${level}:files`;
const moreMembersId = (groupId: string): string => `m:${groupId}`;
const summaryId = (level: number): string => `s:${level}`;

const byLabelThenId = (a: PlacedSymbol, b: PlacedSymbol): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// Block sort: −count, full file path, id.
const byBlockOrder = (a: FileBlock, b: FileBlock): number =>
  b.count - a.count || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0);

export interface CodeRings {
  readonly focusId: string;
  defaultState(): CollapseState;
  ringInput(): RingInput;
  view(state: CollapseState): AdapterView;
  model(state: CollapseState): VisibleModel;
  blocks(state: CollapseState, level: number): BlockDescriptor[];
  levelAccounting(state: CollapseState): Map<number, { placed: number; drawn: number; closed: number; more: number; summary: number }>;
  openGroup(state: CollapseState, groupId: string): CollapseState;
  closeGroup(state: CollapseState, groupId: string): CollapseState;
  moreGroups(state: CollapseState, level: number): CollapseState;
  moreMembers(state: CollapseState, groupId: string): CollapseState;
  openToLevel(state: CollapseState, level: number): CollapseState;
  reveal(state: CollapseState, id: string): CollapseState;
  tryApply(prev: CollapseState, next: CollapseState): { state: CollapseState; refused?: { visible: number; message: string } };
  refusalText(visible: number): string;
}

export function buildCodeRings(input: CodeBlastInput): CodeRings {
  const { query } = input;
  const focusId = `q:${query}`;

  const rowIds = new Set(input.rows.map((r) => r.symbolId));
  const slice = input.sliceNodes ?? [];
  const centreMemberIds = new Set(slice.filter((s) => s.name === query && !rowIds.has(s.symbolId)).map((s) => s.symbolId));
  const loadedNotPlaced = slice.filter((s) => s.name !== query && !rowIds.has(s.symbolId)).length;

  // Placed rows: integer depth ≥ 1, keeping the minimum depth per symbol.
  const placedBySymbol = new Map<string, PlacedSymbol>();
  let unplaced = 0;
  for (const r of input.rows) {
    const ok = typeof r.depth === 'number' && Number.isInteger(r.depth) && r.depth >= 1;
    if (!ok) {
      unplaced += 1;
      continue;
    }
    const prev = placedBySymbol.get(r.symbolId);
    if (prev === undefined || (r.depth as number) < prev.level) {
      placedBySymbol.set(r.symbolId, { symbolId: r.symbolId, id: `n:${r.symbolId}`, name: r.name, file: r.file, level: r.depth as number });
    }
  }
  const placed = [...placedBySymbol.values()];
  const levelById = new Map<string, number>();
  for (const p of placed) levelById.set(p.id, p.level);

  const placedLevels = [...new Set(placed.map((p) => p.level))].sort((a, b) => a - b);
  const maxPlacedLevel = placedLevels.length > 0 ? placedLevels[placedLevels.length - 1]! : 0;

  // Per level: the placed symbols, and (when grouped) the file blocks in block order.
  const perLevel = new Map<number, { symbols: PlacedSymbol[]; inline: boolean; fileBlocks: FileBlock[] }>();
  for (const k of placedLevels) {
    const symbols = placed.filter((p) => p.level === k).sort(byLabelThenId);
    const inline = symbols.length <= INLINE_MAX;
    const byFile = new Map<string, PlacedSymbol[]>();
    for (const s of symbols) (byFile.get(s.file) ?? byFile.set(s.file, []).get(s.file)!).push(s);
    const fileBlocks: FileBlock[] = [...byFile.entries()]
      .map(([file, members]) => ({ file, groupId: groupIdOf(k, file), members: [...members].sort(byLabelThenId), count: members.length }))
      .sort(byBlockOrder);
    perLevel.set(k, { symbols, inline, fileBlocks });
  }

  const placedCount = (k: number): number => perLevel.get(k)?.symbols.length ?? 0;
  const filePagesOf = (state: CollapseState, k: number): number => Math.max(1, state.filePages[k] ?? 1);
  const memberPagesOf = (state: CollapseState, groupId: string): number => Math.max(1, state.memberPages[groupId] ?? 1);
  const shownFiles = (state: CollapseState, k: number): number => {
    const total = perLevel.get(k)?.fileBlocks.length ?? 0;
    return Math.min(total, filePagesOf(state, k) * FILE_PAGE);
  };
  const shownMembers = (state: CollapseState, fb: FileBlock): number => Math.min(fb.members.length, memberPagesOf(state, fb.groupId) * MEMBER_PAGE);

  // Tagged edges: a centre-member endpoint (or the query itself) becomes the focus; everything else n:<id>.
  const tag = (raw: string): string =>
    raw === focusId || raw === query || raw === 'q:' || centreMemberIds.has(raw) ? focusId : `n:${raw}`;
  const taggedEdges = input.edges.map((e) => ({ src: tag(e.src), tgt: tag(e.tgt) }));

  const ringInput = (): RingInput => ({
    focusId,
    nodes: placed.map((p) => ({ id: p.id, label: p.name, level: p.level, groupKey: p.file })),
    edges: taggedEdges,
  });

  // ---- default openLevel: largest L ≥ 1 whose all-closed view stays ≤ DEFAULT_LIMIT ----
  const closedVisibleAt = (openLevel: number): number => {
    let n = 1; // focus
    for (const k of placedLevels) {
      if (k > openLevel) continue;
      const pl = perLevel.get(k)!;
      if (pl.inline) {
        n += pl.symbols.length;
      } else {
        const total = pl.fileBlocks.length;
        n += Math.min(total, FILE_PAGE) + (total > FILE_PAGE ? 1 : 0);
      }
    }
    if (openLevel < maxPlacedLevel) n += 1; // summary
    return n;
  };
  const defaultOpenLevel = (): number => {
    for (let L = maxPlacedLevel; L >= 1; L--) if (closedVisibleAt(L) <= DEFAULT_LIMIT) return L;
    return 1;
  };

  const defaultState = (): CollapseState => ({ openLevel: defaultOpenLevel(), filePages: {}, openGroups: new Set(), memberPages: {} });

  // ---- block descriptors per level ----
  const blocks = (state: CollapseState, level: number): BlockDescriptor[] => {
    const pl = perLevel.get(level);
    if (pl === undefined) return [];
    if (pl.inline) {
      return pl.symbols.map((s) => ({ level, kind: 'symbol' as const, id: s.id, label: s.name, count: 1 }));
    }
    const out: BlockDescriptor[] = [];
    const shown = shownFiles(state, level);
    pl.fileBlocks.slice(0, shown).forEach((fb) => {
      out.push({
        level,
        kind: 'group',
        id: fb.groupId,
        label: fb.file,
        count: fb.count,
        file: fb.file,
        open: state.openGroups.has(fb.groupId),
        members: fb.members.map((m) => m.id),
      });
    });
    const hidden = pl.fileBlocks.length - shown;
    if (hidden > 0) out.push({ level, kind: 'more-files', id: moreFilesId(level), label: `+${hidden} more files`, count: hidden });
    return out;
  };

  // ---- the drawn items for a state, with block order stamped into item.order ----
  const buildItems = (state: CollapseState): Item[] => {
    const items: Item[] = [];
    let order = 0;
    const focusCount = Math.max(1, centreMemberIds.size);
    items.push({
      id: focusId,
      kind: 'focus',
      size: 'focus',
      outlined: false,
      refocusable: false,
      activatable: false,
      level: 0,
      order: order++,
      colorLevel: 0,
      label: query,
      count: focusCount,
      hiddenLinks: 0,
    });

    for (const k of placedLevels) {
      if (k > state.openLevel) continue;
      const pl = perLevel.get(k)!;
      if (pl.inline) {
        for (const s of pl.symbols) items.push(symbolItem(s, order++));
        continue;
      }
      const shown = shownFiles(state, k);
      const shownBlocks = pl.fileBlocks.slice(0, shown);
      for (const fb of shownBlocks) {
        if (!state.openGroups.has(fb.groupId)) {
          items.push(groupItem(fb, k, order++));
          continue;
        }
        const sm = shownMembers(state, fb);
        for (const m of fb.members.slice(0, sm)) items.push(symbolItem(m, order++));
        const overflow = fb.members.length - sm;
        if (overflow > 0)
          items.push(placeholderItem(moreMembersId(fb.groupId), 'more', `+${overflow} more`, overflow, k, order++));
      }
      const hiddenFiles = pl.fileBlocks.length - shown;
      if (hiddenFiles > 0)
        items.push(placeholderItem(moreFilesId(k), 'more', `+${hiddenFiles} more files`, hiddenFiles, k, order++));
    }

    if (state.openLevel < maxPlacedLevel) {
      const first = state.openLevel + 1;
      const last = maxPlacedLevel;
      const total = placedLevels.filter((k) => k > state.openLevel).reduce((s, k) => s + placedCount(k), 0);
      const label = `${first}${last > first ? `–${last}` : ''} hop${last > 1 ? 's' : ''} · ${total}`;
      items.push(placeholderItem(summaryId(first), 'summary', label, total, first, order++));
    }
    return items;
  };

  const symbolItem = (s: PlacedSymbol, order: number): Item => ({
    id: s.id,
    kind: 'symbol',
    size: 'node',
    outlined: false,
    refocusable: true,
    activatable: false,
    level: s.level,
    order,
    colorLevel: s.level,
    label: s.name,
    count: 1,
    hiddenLinks: 0,
  });
  const groupItem = (fb: FileBlock, level: number, order: number): Item => ({
    id: fb.groupId,
    kind: 'group',
    size: 'placeholder',
    outlined: true,
    refocusable: false,
    activatable: true,
    level,
    order,
    colorLevel: level,
    label: fb.file,
    count: fb.count,
    hiddenLinks: 0,
  });
  const placeholderItem = (id: string, kind: 'more' | 'summary', label: string, count: number, level: number, order: number): Item => ({
    id,
    kind,
    size: 'placeholder',
    outlined: true,
    refocusable: false,
    activatable: true,
    level,
    order,
    colorLevel: level,
    label,
    count,
    hiddenLinks: 0,
  });

  // ---- owner map (first match wins) ----
  const ownerOf = (state: CollapseState) => {
    // Index each placed symbol's file position and member position per level for O(1) lookup.
    return (id: string): string => {
      if (id === focusId) return focusId;
      const lvl = levelById.get(id);
      if (lvl === undefined) return id; // not a placed symbol
      if (lvl > state.openLevel) return summaryId(state.openLevel + 1); // 1: summary
      const pl = perLevel.get(lvl)!;
      if (pl.inline) return id; // 4: the node itself
      const fileIndex = pl.fileBlocks.findIndex((fb) => fb.members.some((m) => m.id === id));
      if (fileIndex < 0) return id;
      const shown = shownFiles(state, lvl);
      if (fileIndex >= shown) return moreFilesId(lvl); // 2: "+N more files"
      const fb = pl.fileBlocks[fileIndex]!;
      if (!state.openGroups.has(fb.groupId)) return fb.groupId; // 3: the closed group
      const memberIndex = fb.members.findIndex((m) => m.id === id);
      if (memberIndex >= shownMembers(state, fb)) return moreMembersId(fb.groupId); // 3: the group's "+N more"
      return id; // 4: the node itself
    };
  };

  const membersOf = (state: CollapseState) => (itemId: string): string[] => {
    if (itemId === focusId) return [...centreMemberIds].map((s) => `n:${s}`);
    const lvl = levelById.get(itemId);
    if (lvl !== undefined) return [itemId]; // a drawn symbol represents itself
    // summary
    if (itemId.startsWith('s:')) {
      const first = Number(itemId.slice(2));
      return placed.filter((p) => p.level >= first).map((p) => p.id);
    }
    // "+N more files"
    const mf = /^m:(\d+):files$/.exec(itemId);
    if (mf) {
      const k = Number(mf[1]);
      const pl = perLevel.get(k);
      if (pl === undefined) return [];
      return pl.fileBlocks.slice(shownFiles(state, k)).flatMap((fb) => fb.members.map((m) => m.id));
    }
    // a group "+N more" members: m:g:<level>:<enc>
    if (itemId.startsWith('m:g:')) {
      const gid = itemId.slice(2);
      const k = Number(gid.split(':')[1]);
      const pl = perLevel.get(k);
      const fb = pl?.fileBlocks.find((b) => b.groupId === gid);
      if (fb === undefined) return [];
      return fb.members.slice(shownMembers(state, fb)).map((m) => m.id);
    }
    // a closed group: g:<level>:<enc>
    if (itemId.startsWith('g:')) {
      const k = Number(itemId.split(':')[1]);
      const pl = perLevel.get(k);
      const fb = pl?.fileBlocks.find((b) => b.groupId === itemId);
      return fb ? fb.members.map((m) => m.id) : [];
    }
    return [];
  };

  const levelLabel = (k: number, count: number): string => `${k} hop${k === 1 ? '' : 's'} · ${count}`;

  const view = (state: CollapseState): AdapterView => {
    const items = buildItems(state);
    const shownByLevel = new Map<number, number>();
    for (const it of items) shownByLevel.set(it.level, (shownByLevel.get(it.level) ?? 0) + 1);
    return {
      items,
      openLevel: state.openLevel,
      ownerOf: ownerOf(state),
      levelLabel,
      membersOf: membersOf(state),
      centreMembers: new Set([...centreMemberIds].map((s) => `n:${s}`)),
      placedLevels,
      placedCount,
      shownCount: (k: number) => shownByLevel.get(k) ?? 0,
      unplaced,
      loadedNotPlaced,
    };
  };

  const model = (state: CollapseState): VisibleModel => visibleModel(ringInput(), view(state));

  // ---- per-level conservation accounting (rows) ----
  const levelAccounting = (state: CollapseState) => {
    const out = new Map<number, { placed: number; drawn: number; closed: number; more: number; summary: number }>();
    for (const k of placedLevels) {
      const placedK = placedCount(k);
      const acc = { placed: placedK, drawn: 0, closed: 0, more: 0, summary: 0 };
      if (k > state.openLevel) {
        acc.summary = placedK;
      } else {
        const pl = perLevel.get(k)!;
        if (pl.inline) {
          acc.drawn = placedK;
        } else {
          const shown = shownFiles(state, k);
          pl.fileBlocks.slice(0, shown).forEach((fb) => {
            if (!state.openGroups.has(fb.groupId)) {
              acc.closed += fb.count;
            } else {
              const sm = shownMembers(state, fb);
              acc.drawn += sm;
              acc.more += fb.members.length - sm;
            }
          });
          acc.more += pl.fileBlocks.slice(shown).reduce((s, fb) => s + fb.count, 0);
        }
      }
      out.set(k, acc);
    }
    return out;
  };

  // ---- transitions ----
  const withFilePages = (state: CollapseState, level: number, pages: number): CollapseState => ({
    ...state,
    filePages: { ...state.filePages, [level]: pages },
  });
  const withMemberPages = (state: CollapseState, groupId: string, pages: number): CollapseState => ({
    ...state,
    memberPages: { ...state.memberPages, [groupId]: pages },
  });

  const openGroup = (state: CollapseState, groupId: string): CollapseState => ({ ...state, openGroups: new Set([...state.openGroups, groupId]) });
  const closeGroup = (state: CollapseState, groupId: string): CollapseState => {
    const next = new Set(state.openGroups);
    next.delete(groupId);
    return { ...state, openGroups: next };
  };
  const moreGroups = (state: CollapseState, level: number): CollapseState => withFilePages(state, level, filePagesOf(state, level) + 1);
  const moreMembers = (state: CollapseState, groupId: string): CollapseState => withMemberPages(state, groupId, memberPagesOf(state, groupId) + 1);
  const openToLevel = (state: CollapseState, level: number): CollapseState => ({ ...state, openLevel: level });

  const levelOfGroup = (groupId: string): number => Number(groupId.split(':')[1]);

  const reveal = (state: CollapseState, id: string): CollapseState => {
    // reveal a symbol: open its level, file page, group and member page so it is drawn.
    if (id.startsWith('n:')) {
      const lvl = levelById.get(id);
      if (lvl === undefined) return state;
      let next: CollapseState = lvl > state.openLevel ? openToLevel(state, lvl) : state;
      const pl = perLevel.get(lvl)!;
      if (pl.inline) return next;
      const fileIndex = pl.fileBlocks.findIndex((fb) => fb.members.some((m) => m.id === id));
      if (fileIndex < 0) return next;
      const fb = pl.fileBlocks[fileIndex]!;
      const neededFilePages = Math.ceil((fileIndex + 1) / FILE_PAGE);
      if (neededFilePages > filePagesOf(next, lvl)) next = withFilePages(next, lvl, neededFilePages);
      next = openGroup(next, fb.groupId);
      const memberIndex = fb.members.findIndex((m) => m.id === id);
      const neededMemberPages = Math.ceil((memberIndex + 1) / MEMBER_PAGE);
      if (neededMemberPages > memberPagesOf(next, fb.groupId)) next = withMemberPages(next, fb.groupId, neededMemberPages);
      return next;
    }
    // reveal a file group: open its level and file page only; leave its expansion and member page alone.
    if (id.startsWith('g:')) {
      const lvl = levelOfGroup(id);
      const pl = perLevel.get(lvl);
      if (pl === undefined) return state;
      let next: CollapseState = lvl > state.openLevel ? openToLevel(state, lvl) : state;
      const fileIndex = pl.fileBlocks.findIndex((fb) => fb.groupId === id);
      if (fileIndex < 0) return next;
      const neededFilePages = Math.ceil((fileIndex + 1) / FILE_PAGE);
      if (neededFilePages > filePagesOf(next, lvl)) next = withFilePages(next, lvl, neededFilePages);
      return next;
    }
    return state;
  };

  const refusalText = (visible: number): string => `Showing ${visible}. Close a group to open more.`;

  const tryApply = (prev: CollapseState, next: CollapseState): { state: CollapseState; refused?: { visible: number; message: string } } => {
    const res = tryApplyCore(prev, next, (s) => model(s).counts.visible);
    if (res.refused) {
      const current = model(prev).counts.visible;
      return { state: res.state, refused: { visible: res.refused.visible, message: refusalText(current) } };
    }
    return { state: res.state };
  };

  return {
    focusId,
    defaultState,
    ringInput,
    view,
    model,
    blocks,
    levelAccounting,
    openGroup,
    closeGroup,
    moreGroups,
    moreMembers,
    openToLevel,
    reveal,
    tryApply,
    refusalText,
  };
}
