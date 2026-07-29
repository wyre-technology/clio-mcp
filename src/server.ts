import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getState, getNavigationTools, getBackTool, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';

const SERVER_VERSION = process.env.npm_package_version ?? '0.0.0';

/**
 * Build a fresh MCP Server instance with decision-tree tool routing
 * (skill 2.6). Per skill 2.3, this MUST be called fresh for every HTTP
 * request in gateway mode -- see http.ts.
 */
export function createServer(): Server {
  const server = new Server(
    { name: 'clio-mcp', version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );
  // Caller (index.ts / http.ts) is responsible for binding this server into
  // the per-request async context via runWithServerRef/bindServerRef — see
  // utils/server-ref.ts. Doing it here would set a module-level ref, the
  // exact cross-tenant bug this file used to have.

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    const sessionId = (extra as { sessionId?: string } | undefined)?.sessionId;
    const state = getState(sessionId);

    if (!state.currentDomain) {
      return { tools: getNavigationTools() };
    }

    const handler = await getDomainHandler(state.currentDomain);
    return { tools: [...handler.getTools(), getBackTool()] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const sessionId = (extra as { sessionId?: string } | undefined)?.sessionId;
    const state = getState(sessionId);

    if (name === 'clio_navigate') {
      const domain = args.domain as DomainName;
      if (!DOMAINS.includes(domain)) {
        return {
          content: [{ type: 'text' as const, text: `Invalid domain: ${domain}. Valid domains: ${DOMAINS.join(', ')}` }],
          isError: true,
        };
      }
      state.currentDomain = domain;
      const handler = await getDomainHandler(domain);
      const tools = handler.getTools().map((t) => t.name);
      await server.sendToolListChanged();
      return {
        content: [{ type: 'text' as const, text: `Navigated to ${domain}. Available tools: ${tools.join(', ')}, clio_back.` }],
      };
    }

    if (name === 'clio_back') {
      state.currentDomain = null;
      await server.sendToolListChanged();
      return { content: [{ type: 'text' as const, text: 'Returned to Clio domain navigation.' }] };
    }

    if (name === 'clio_status') {
      const creds = getCredentials();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                connected: Boolean(creds),
                region: creds?.region ?? null,
                canAutoRefresh: Boolean(creds?.refreshToken && creds?.clientId && creds?.clientSecret),
                domains: DOMAINS,
                currentDomain: state.currentDomain,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (!state.currentDomain) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Call clio_navigate first to select a domain.` }],
        isError: true,
      };
    }

    const handler = await getDomainHandler(state.currentDomain);
    try {
      return await handler.handleCall(name, args, extra);
    } catch (error) {
      logger.error('Tool call failed', { tool: name, error: (error as Error).message });
      return {
        content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  });

  return server;
}
