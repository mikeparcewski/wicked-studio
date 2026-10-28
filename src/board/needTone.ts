import type { SystemAttention } from '../api/system.js';

/**
 * ONE colour rule for a "needs you" item's dot, wherever the item is listed (live nit 2026-10-27: the same item read
 * red on Needs you and purple on the project home). Red when it blocks other work — crew rates it red, or it holds
 * more than one job; amber when it waits on you. The decision dock's status rail follows the same rule.
 */
export type NeedTone = 'fail' | 'warn';

export function needTone(a: Pick<SystemAttention, 'level'> & { blockedRunIds?: readonly string[] | undefined }): NeedTone {
  return a.level === 'red' || (a.blockedRunIds?.length ?? 0) > 1 ? 'fail' : 'warn';
}
