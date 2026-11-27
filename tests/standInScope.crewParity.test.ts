// (wicked-core#1843 P3) Studio offers reduced assurance only where crew asks no stand-in question. Crew decides that in
// one classifier (`noStandInsKind`, packages/crew/src/api/stand-in-scope.ts); studio's `takesStandIns` mirrors it. The
// fixture is crew's list, copied with its file:line; this test fails when the two lists differ.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_STAND_IN_WORKFLOWS, takesStandIns } from '../src/board/standIn.js';

const CREW = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/stand-in-scope.crew.json'), 'utf8')) as {
  kinds: Record<string, Array<{ id: string; from: string }>>;
};
const crewIds = Object.values(CREW.kinds).flat().map((e) => e.id);

describe('takesStandIns mirrors crew\'s noStandInsKind', () => {
  it('names exactly crew\'s workflows that take no stand-ins', () => {
    expect([...NO_STAND_IN_WORKFLOWS].sort()).toEqual([...crewIds].sort());
  });

  it('says no for each of them, and yes for a free-text job and any other workflow', () => {
    for (const id of crewIds) expect(takesStandIns(id)).toBe(false);
    expect(takesStandIns(null)).toBe(true);
    expect(takesStandIns(undefined)).toBe(true);
    expect(takesStandIns('')).toBe(true);
    expect(takesStandIns('bug')).toBe(true);
    expect(takesStandIns('mcp-server')).toBe(true);
  });
});
