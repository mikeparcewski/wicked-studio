import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { AgentAccess } from '../src/components/sources/AgentAccess.js';
import type { SourceAgentAccess } from '../src/api/sourceAgents.js';

/**
 * studio#1280: "query on" asks a confirmation; a click that lands after the box is on screen but before React ran its
 * mount effects was lost, because the mount effect cleared the confirmation (`setAsking(false)`) AFTER the click set
 * it. The box now resets only when its source changes, during render, so no effect can undo a click.
 *
 * The race, made deterministic: the box mounts outside `act` (a list read landing, as on the Sources page), so React
 * commits the DOM and leaves its passive effects for a later task; the click is sent from the microtask that sees the
 * DOM, before that task. (CI met it under load: run 44907769759, attempt 1.)
 */
const DEFAULTS: SourceAgentAccess = { see: true, query: false, projects: [], everyProject: false };
let root: Root | null = null;
let host: HTMLDivElement | null = null;
const globalAct = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

function whenShown(testId: string): Promise<HTMLElement> {
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const el = host!.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (el !== null) { obs.disconnect(); resolve(el); }
    });
    obs.observe(host!, { childList: true, subtree: true });
  });
}

describe('studio#1280: a click right after the box appears is never lost', () => {
  it('"query" clicked before the mount effects ran still opens the confirmation', async () => {
    apiFetch.mockImplementation(() => new Promise(() => undefined));
    const before = globalAct.IS_REACT_ACT_ENVIRONMENT;
    globalAct.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      const shown = whenShown('source-agent-controls-query');
      root.render(<AgentAccess source="support-pg" dialect="postgres" agents={DEFAULTS} onChanged={() => undefined} />);
      const sw = await shown;
      expect(sw).not.toBeDisabled();
      sw.click();
      // Let React run everything it has left: the click's update and the mount effects.
      await new Promise((r) => setTimeout(r, 20));
      expect(host.querySelector('[data-testid="source-agent-controls-confirm"]')).not.toBeNull();
    } finally {
      globalAct.IS_REACT_ACT_ENVIRONMENT = before;
    }
  });
});
