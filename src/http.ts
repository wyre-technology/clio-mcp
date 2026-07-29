import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { credentialsFromHeaders, getCredentials, runWithCredentials } from './utils/client.js';
import { runWithServerRef } from './utils/server-ref.js';
import { logger } from './utils/logger.js';

/**
 * HTTP streaming transport (skill 2.2 / 2.3). Every request gets a brand new
 * Server + StreamableHTTPServerTransport pair -- the gateway sends separate
 * HTTP requests for initialize / tools/list / tools/call, and a shared
 * server would reject the second `initialize` with HTTP 500.
 *
 * SECURITY-CRITICAL invariant: `sessionIdGenerator: undefined` +
 * `enableJsonResponse: true` keeps this transport stateless. Per-request
 * tenant credentials are carried in the AsyncLocalStorage context opened by
 * `runWithCredentials()` below, scoped to exactly this request's handling.
 * Switching to a stateful/SSE transport would let a long-lived connection
 * serve later messages under a stale/foreign credential context.
 */
export function startHttpServer(): void {
  const port = parseInt(process.env.MCP_HTTP_PORT ?? '8080', 10);
  const host = process.env.MCP_HTTP_HOST ?? '0.0.0.0';
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Shallow, unauthenticated liveness probe. Always 200 while the process
    // is up -- in gateway mode credentials arrive per-request via headers, so
    // a credential-gated status would wrongly fail the container's liveness probe.
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', transport: 'http', timestamp: new Date().toISOString() }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    const handle = async () => {
      const server = createServer();

      // Bind this request's server into the per-request async context (not
      // a module-level global) so elicitation helpers resolve *this*
      // server/transport even after await gaps, and never a concurrent
      // request's — see utils/server-ref.ts. The whole connect/handleRequest/
      // catch chain must stay inside this callback so the bound context
      // survives every await gap between here and any later getServerRef()
      // call.
      await runWithServerRef(server, async () => {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on('close', () => {
          transport.close();
          server.close();
        });
        try {
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (err) {
          logger.error('MCP transport error', { error: (err as Error).message });
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
          }
        }
      });
    };

    if (isGatewayMode) {
      const creds = credentialsFromHeaders(req.headers as Record<string, string | string[] | undefined>);
      if (creds) {
        await runWithCredentials(creds, handle);
      } else {
        // No credentials on this request -- don't reject outright. tools/list
        // and initialize still work; a tools/call will fail clearly inside
        // getClient() when it can't find credentials.
        await handle();
      }
    } else {
      await handle();
    }
  });

  httpServer.listen(port, host, () => {
    logger.info(`Clio MCP server listening on ${host}:${port}`, {
      authMode: isGatewayMode ? 'gateway' : 'env',
      hasEnvCredentials: Boolean(getCredentials()),
    });
  });
}
