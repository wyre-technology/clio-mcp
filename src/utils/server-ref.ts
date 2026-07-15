import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Shared reference to the currently-active MCP Server instance, so that
 * domain handlers (which don't otherwise have access to the server) can call
 * `server.elicitInput()` for elicitation (skill 2.8).
 *
 * Since the server is created fresh per-request (skill 2.3), this is set at
 * the top of every request in server.ts before any tool call is routed.
 */
let _server: Server | null = null;

export function setServerRef(server: Server): void {
  _server = server;
}

export function getServerRef(): Server | null {
  return _server;
}
