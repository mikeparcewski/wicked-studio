/**
 * The agent switches are human-only in the UI (DES-APPS-001 rev 12 §5.4: "human-only to change, like Allow
 * writes"). crew refuses a non-human actor (403 `agents_switch_human_only`); studio adds that they are reached
 * only by a person's click: `sourceAgentsApi.setAgentAccess` has ONE caller, the AgentAccess component, which
 * reads no URL, storage or message, and turns "query" on only from its confirmation button.
 * @vitest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
});
const rel = (p: string): string => relative(join(__dirname, '..'), p).replace(/\\/g, '/');
const all = files(SRC).map((p) => ({ path: rel(p), text: readFileSync(p, 'utf8') }));

describe('the agent switches are reached only by a person\'s click', () => {
  it('setAgentAccess is called only by AgentAccess', () => {
    expect(all.filter((f) => /\.setAgentAccess\s*\(/.test(f.text)).map((f) => f.path)).toEqual(['src/components/sources/AgentAccess.tsx']);
  });
  it('the component reads no URL, storage, message or timer', () => {
    const c = all.find((f) => f.path === 'src/components/sources/AgentAccess.tsx')!.text;
    for (const banned of ['location', 'URLSearchParams', 'localStorage', 'sessionStorage', 'postMessage', 'addEventListener', 'setTimeout']) {
      expect(c, banned).not.toContain(banned);
    }
    // Every change is a click or a tick; "query" turns on only from the confirmation's button.
    expect([...c.matchAll(/apply\(\{ query: true \}\)/g)]).toHaveLength(1);
    expect(c).toMatch(/confirm-on`\} onClick=\{\(\) => void apply\(\{ query: true \}\)\}/);
    // The reads in its effect are reads: no apply, no setAgentAccess there.
    const effect = c.slice(c.indexOf('useEffect('), c.indexOf('}, [source]);'));
    expect(effect).not.toMatch(/apply\(|setAgentAccess/);
  });
  it('only the sources components import the agent API', () => {
    const importers = all.filter((f) => /\bsourceAgentsApi\b/.test(f.text) && f.path !== 'src/api/sourceAgents.ts').map((f) => f.path).sort();
    expect(importers).toEqual(['src/components/session/RunDataUse.tsx', 'src/components/sources/AgentAccess.tsx']);
  });
});
