import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Wave 2a round 2: ONE decision mechanism. Every human gate decision goes through the
 * shared path (`commitGateDecision` / `decideGate` → the undo window → `sendGateDecision`),
 * so an Undo that works on the board also works on the run page, the dashboard, the steer
 * composer, the reassign control and the unit detail. This fails the moment any other
 * module calls the gate POST (`api.confirmGate`) directly.
 */

const SRC = join(__dirname, '..', 'src');
const ALLOWED = new Set(['api/client.ts', 'board/gateActions.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('the gate POST has exactly one caller', () => {
  it('only board/gateActions.ts calls confirmGate (api/client.ts defines it)', () => {
    const offenders = files(SRC)
      .map((p) => relative(SRC, p).split('\\').join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => /\bconfirmGate\s*\(/.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('gateActions.ts calls it exactly once, in the send half', () => {
    const text = readFileSync(join(SRC, 'board/gateActions.ts'), 'utf8');
    expect(text.match(/\bapi\.confirmGate\s*\(/g)).toHaveLength(1);
  });
});
