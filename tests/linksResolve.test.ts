// X1 (operator ruling 2026-10-09: the moved-address redirects are removed): a link studio generates
// must never land on a dead address. Route-table-driven: the oracle is the router itself
// (`parseRoute`) plus its `RETIRED_ADDRESSES` table — no hand list of links.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gateOpenPath } from '../src/board/gateActions.js';
import { everythingPath, SESSION_FILTERS } from '../src/board/everythingModel.js';
import { madeOpenAddress } from '../src/board/madeMoves.js';
import { sessionPath } from '../src/board/sessionModel.js';
import { projectTestsPath, testingPath } from '../src/api/testing.js';
import { parseRoute, projectDetailPath, RETIRED_ADDRESSES, runEventsPath, runFilesPath } from '../src/hooks/useRoute.js';
import { routeTargets } from '../src/palette/routeTargets.js';
import { makeView } from './factories.js';

const SRC = join(__dirname, '..', 'src');

/** Every `.ts` / `.tsx` file under `src/`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [p] : [];
  });
}

/**
 * The in-app link targets written as literals in a LINK position: `href="/x"`, `href={'/x'}`,
 * `href: '/x'`, `navigate('/x')`, `go('/x')`, `goTo('/x')`, `location.assign|replace('/x')`,
 * `location.href = '/x'`, `path: '/x'` (whitespace allowed around each) — single, double or
 * backtick quotes. A `${…}` right after a `/` stands for one id segment; anywhere else it stands
 * for nothing (`/testing${tail}`). API paths (`apiFetch('/runs')`) are not link positions and are
 * never read.
 */
const LINK_AT = /(?:\bhref\s*[=:]\s*(?:\{\s*)?|\b(?:navigate|go|goTo|assign|replace)\s*\(\s*|\blocation\.href\s*=\s*|\bpath\s*:\s*)(['"`])(\/(?!\/)[^'"`\s]*)\1/g;

function literalLinks(): { at: string; target: string }[] {
  const out: { at: string; target: string }[] = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(LINK_AT)) {
      const line = text.slice(0, m.index).split('\n').length;
      out.push({ at: `${relative(SRC, file)}:${line}`, target: m[2]!.replace(/\/\$\{[^}]*\}/g, '/x1').replace(/\$\{[^}]*\}/g, '') });
    }
  }
  return out;
}

/** A retired shape as a matcher (`:id` = one segment). */
const RETIRED = RETIRED_ADDRESSES.map((a) => ({ a, re: new RegExp(`^${a.replace(/:id/g, '[^/]+')}/*$`) }));

/** Why an address is not a destination (naming the retired shape it hits), or null when it is one. */
function dead(target: string): string | null {
  const path = target.split(/[?#]/)[0]!;
  if (parseRoute(path).panel !== 'not-found') return null;
  const hit = RETIRED.find((r) => r.re.test(path));
  return hit !== undefined ? `retired (${hit.a})` : 'not-found';
}

describe('X1 — every link studio generates resolves', () => {
  it('the scan finds the literal links (a guard against a regex that matches nothing)', () => {
    const found = literalLinks();
    expect(found.length).toBeGreaterThan(30);
    expect(found.some((l) => l.target === '/everything')).toBe(true);
  });

  it('no literal link in src/ lands on a retired or not-found address', () => {
    const bad = literalLinks().map((l) => ({ ...l, why: dead(l.target) })).filter((l) => l.why !== null);
    expect(bad.map((l) => `${l.at} ${l.target} — ${l.why}`)).toStrictEqual([]);
  });

  it('the link builders produce live addresses', () => {
    const runs = [makeView({ id: 'r1', status: 'completed', project_id: 'kes' })];
    const built = [
      sessionPath('run:r1'), sessionPath('chat-1'), gateOpenPath('kes', 'r1'), gateOpenPath('', 'r1'),
      projectDetailPath('kes'), runEventsPath('r1'), runFilesPath('r1'),
      projectTestsPath('kes'), testingPath('campaigns'), testingPath('evals'),
      everythingPath(), everythingPath({ tab: 'projects' }), everythingPath({ tab: 'made', kind: 'documents', project: 'kes' }),
      ...SESSION_FILTERS.map((f) => everythingPath({ tab: 'sessions', filter: f.id })),
      madeOpenAddress('video', 'kes', 'r1', runs, false), madeOpenAddress('document', 'kes', 'd1', [], false),
      ...routeTargets({
        projects: [{ id: 'kes', name: 'Kestrel' }], runs, projectIdByRun: { r1: 'kes' },
        chats: [{ id: 'c1', title: 'a chat' }], campaigns: [{ id: 'k1', label: 'sweep' }], runChatId: false,
      }).map((t) => t.href),
    ];
    expect(built.filter((t) => dead(t) !== null)).toStrictEqual([]);
  });
});
