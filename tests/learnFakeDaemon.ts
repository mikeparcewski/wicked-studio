import { vi } from 'vitest';

/**
 * A fake crew for the Learn tests: `fetch` answered by route (`METHOD /path` without the query, or a
 * function of the full path). Every call is recorded with its parsed body, so a test asserts what was SENT.
 */
export type Handler = (body: unknown, path: string) => unknown | Promise<unknown>;
export interface FakeDaemon {
  calls: { method: string; path: string; body: unknown }[];
  on: (route: string, h: Handler | Record<string, unknown> | readonly unknown[]) => void;
  sent: (route: string) => unknown[];
}

export function fakeDaemon(): FakeDaemon {
  const routes = new Map<string, Handler>();
  const calls: FakeDaemon['calls'] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const full = String(url).replace(/^.*\/api\/v1/u, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ method, path: full, body });
    const key = `${method} ${full.split('?')[0]}`;
    const h = routes.get(key) ?? routes.get(`${method} ${full}`);
    // Fastify's bare unknown-route 404 (what a crew without the route answers).
    if (h === undefined) return new Response(JSON.stringify({ message: `Route ${key} not found`, error: 'Not Found', statusCode: 404 }), { status: 404 });
    try {
      const out = await h(body, full);
      return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status });
    }
  }));
  return {
    calls,
    on: (route, h) => routes.set(route, typeof h === 'function' ? (h as Handler) : () => h),
    sent: (route) => calls.filter((c) => `${c.method} ${c.path.split('?')[0]}` === route).map((c) => c.body),
  };
}
