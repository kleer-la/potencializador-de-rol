import { vi } from 'vitest';

export type Reply = { status: number; body?: unknown };
export type Routes = Record<string, (body: unknown) => Reply>;
export type Call = { route: string; body: unknown };

/**
 * Replaces `fetch` with a table of routes keyed "METHOD /path" and records every call.
 * An unexpected request fails the test.
 */
export function fakeBackend(routes: Routes): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = `${init?.method ?? 'GET'} ${String(input)}`;
    const handler = routes[route];
    if (handler === undefined) throw new Error(`unexpected request: ${route}`);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ route, body });
    const reply = handler(body);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

export const json = (body: unknown, status = 200): Reply => ({ status, body });
