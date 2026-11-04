/**
 * The agent switches are human-only in the UI (DES-KNOWLEDGE-DATA-001 §7.1: "The switches are human-operator
 * only and audited"). crew refuses a non-human actor (403 `agents_switch_human_only`); studio adds that they are reached
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
    for (const banned of ['location', 'URLSearchParams', 'localStorage', 'sessionStorage', 'postMessage', 'addEventListener', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
      expect(c, banned).not.toContain(banned);
    }
    // Every change is a click or a tick; "query" turns on only from the confirmation's button.
    expect([...c.matchAll(/apply\(\{ query: true \}\)/g)]).toHaveLength(1);
    expect(c).toMatch(/confirm-on`\} onClick=\{\(\) => void apply\(\{ query: true \}\)\}/);
    // EVERY effect only reads or focuses: no apply, no setAgentAccess in any of them.
    const effects = c.split('useEffect(').slice(1).map((chunk) => chunk.slice(0, chunk.search(/\}, \[[^\]]*\]\);/)));
    expect(effects.length).toBeGreaterThan(0);
    for (const e of effects) expect(e).not.toMatch(/apply\(|setAgentAccess/);
  });
  it('only the sources components import the agent API', () => {
    const importers = all.filter((f) => /\bsourceAgentsApi\b/.test(f.text) && f.path !== 'src/api/sourceAgents.ts').map((f) => f.path).sort();
    // The sequence guard's ticket is taken only where the write is sent.
    expect(all.filter((f) => /agentSwitchWrites\.take\(/.test(f.text)).map((f) => f.path)).toEqual(['src/components/sources/AgentAccess.tsx']);
    expect(importers).toEqual(['src/components/session/RunDataUse.tsx', 'src/components/sources/AgentAccess.tsx']);
  });
});
