/**
 * Instrumented call-counter probe for the S2S guard ordering invariant
 * (boss's ordering-catch rule, 2026-07-28 S2S rollout evidence report).
 *
 * clio-mcp's own credential resolution (credentialsFromHeaders in
 * src/utils/client.ts) is a pure header read -- no I/O. But the vendored
 * @wyre-ai/node-clio SDK's HttpClient has its own refresh-on-401
 * behavior: HttpClient.handleResponse() sees a 401 from Clio's data API,
 * calls refreshAccessToken() -> OAuthTokenRefresher.refresh() -> postToken(),
 * a real outbound fetch to Clio's own OAuth token endpoint
 * (https://app.clio.com/oauth/token), then retries the original request once.
 * This is a real, dependency-level side effect distinct from the simple
 * "gateway already exchanged the token" header-read model most siblings use --
 * it only fires lazily, on a 401 from Clio itself, not on every request.
 *
 * This drives a REAL tools/call round-trip through the actual HTTP server
 * (no mocking of index.ts/http.ts/domains/client.ts), instrumented only at
 * the network boundary: global.fetch is stubbed to intercept calls aimed at
 * Clio's own host (both the data API and the OAuth token endpoint) and pass
 * everything else (including the test's own loopback request) through to
 * the real fetch. The data-API stub deliberately returns 401 on the first
 * call to force the SDK's real refresh-and-retry path to execute.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';

const TEST_PORT = 47005;
const TEST_SECRET = 'test-s2s-guard-ordering-secret-do-not-use-in-prod';
const CLIO_HOST = 'https://app.clio.com';

let tokenCalls = 0;
let dataApiCalls = 0;

const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.startsWith(`${CLIO_HOST}/oauth/token`)) {
      tokenCalls++;
      return new Response(
        JSON.stringify({
          access_token: 'fake-refreshed-access-token',
          refresh_token: 'fake-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.startsWith(`${CLIO_HOST}/api/v4/`)) {
      dataApiCalls++;
      if (dataApiCalls === 1) {
        // Force the SDK's real refresh-on-401 path to fire.
        return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Everything else (notably the test's own loopback calls into the
    // in-process server below) goes through to the real fetch untouched.
    return realFetch(input, init);
  }) as typeof fetch;

  process.env.MCP_TRANSPORT = 'http';
  process.env.AUTH_MODE = 'gateway';
  process.env.MCP_HTTP_PORT = String(TEST_PORT);
  process.env.MCP_HTTP_HOST = '127.0.0.1';
  process.env.CONDUIT_S2S_SECRET = TEST_SECRET;
  const { startHttpServer } = await import('../http.js');
  startHttpServer();
  await waitForServerReady();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

function mintS2sHeader(secret: string, unixSeconds: number): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

async function waitForServerReady(): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await realFetch(`http://127.0.0.1:${TEST_PORT}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('clio-mcp test HTTP server did not become ready in time');
}

async function callTool(headers: Record<string, string>, name: string, args: Record<string, unknown>): Promise<Response> {
  return fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id: 1,
    }),
  });
}

// This server's navigation is decision-tree-based (skill 2.6): a domain's
// tools (e.g. clio_contacts_list) are only dispatchable after clio_navigate
// selects that domain, tracked in a session-state map keyed by session id
// (falls back to a 'default' bucket with no session id, which is what a
// bare stateless request like these tests send). Real client behavior, not
// a test-only shortcut -- must navigate before calling a domain tool.
async function navigateToContacts(headers: Record<string, string>): Promise<void> {
  await callTool(headers, 'clio_navigate', { domain: 'contacts' });
}

async function callContactsList(headers: Record<string, string>): Promise<Response> {
  await navigateToContacts(headers);
  return callTool(headers, 'clio_contacts_list', { query: 'test' });
}

const VALID_CLIO_HEADERS = {
  'x-clio-access-token': 'stale-access-token',
  'x-clio-refresh-token': 'test-refresh-token',
  'x-clio-client-id': 'test-client-id',
  'x-clio-client-secret': 'test-client-secret',
};

describe('S2S guard ordering vs. Clio SDK refresh-on-401 side effect', () => {
  it('does NOT reach Clio (data API or OAuth token endpoint) when the S2S header is missing', async () => {
    tokenCalls = 0;
    dataApiCalls = 0;
    const res = await callContactsList(VALID_CLIO_HEADERS);
    expect(res.status).toBe(401);
    expect(tokenCalls).toBe(0);
    expect(dataApiCalls).toBe(0);
  });

  it('does NOT reach Clio when the S2S header is present but invalid', async () => {
    tokenCalls = 0;
    dataApiCalls = 0;
    const res = await callContactsList({
      'x-gateway-s2s': mintS2sHeader('wrong-secret', Math.floor(Date.now() / 1000)),
      ...VALID_CLIO_HEADERS,
    });
    expect(res.status).toBe(401);
    expect(tokenCalls).toBe(0);
    expect(dataApiCalls).toBe(0);
  });

  it('DOES exercise the real refresh-on-401 path exactly once on a real accepted tool call (negative control)', async () => {
    tokenCalls = 0;
    dataApiCalls = 0;
    const res = await callContactsList({
      'x-gateway-s2s': mintS2sHeader(TEST_SECRET, Math.floor(Date.now() / 1000)),
      ...VALID_CLIO_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBeFalsy();
    // 1st data call 401s, forces exactly one refresh, then the retried data
    // call succeeds -- proves both the guard-ordering invariant (S2S clears
    // first) and that the mock apparatus genuinely detects the SDK's real
    // refresh side effect firing (not vacuously zero).
    expect(tokenCalls).toBe(1);
    expect(dataApiCalls).toBe(2);
  });
});
