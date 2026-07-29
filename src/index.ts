import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { bindServerRef } from './utils/server-ref.js';
import { logger } from './utils/logger.js';

/**
 * Entry point (skill 2.2). `MCP_TRANSPORT=http` runs the gateway-facing HTTP
 * streaming server (src/http.ts); otherwise this starts a single stdio
 * server, for local/CLI use against a single set of CLIO_* env credentials.
 */
async function main(): Promise<void> {
  if (process.env.MCP_TRANSPORT === 'http') {
    const { startHttpServer } = await import('./http.js');
    startHttpServer();
    return;
  }

  const server = createServer();
  // stdio is single-session (one process = one caller), so there is no
  // concurrent tenant to isolate from — bind once for the process lifetime
  // rather than per-request. See utils/server-ref.ts.
  bindServerRef(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Clio MCP server started (stdio)');
}

main().catch((err) => {
  logger.error('Fatal error starting Clio MCP server', { error: (err as Error).message });
  process.exit(1);
});
