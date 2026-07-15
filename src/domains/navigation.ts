import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainName, NavigationState } from '../utils/types.js';
import { DOMAIN_NAMES } from '../utils/types.js';

/**
 * Decision-tree navigation state, keyed by session id (skill 2.6). The
 * StreamableHTTP transport is stateless per-request (skill 2.3), so this map
 * -- not the per-request Server instance -- is what actually persists
 * "which domain is the caller currently in" across the separate tools/list
 * and tools/call requests that make up one navigation. Falls back to a
 * single 'default' bucket when no session id is available (stdio mode, or a
 * gateway that doesn't forward one), matching this server's stdio use case
 * of a single caller per process.
 */
const sessionStates = new Map<string, NavigationState>();

export function getState(sessionId = 'default'): NavigationState {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = { currentDomain: null };
    sessionStates.set(sessionId, state);
  }
  return state;
}

export const DOMAINS: DomainName[] = DOMAIN_NAMES;

const DOMAIN_SUMMARY: Record<DomainName, string> = {
  matters: 'list/get/create/update matters (cases/files)',
  contacts: 'list/get/create/update contacts (people and companies)',
  activities: 'list/get/create time entries and expense entries logged against matters',
  communications: 'list/get logged emails and calls (read-only -- no write API in the SDK)',
  tasks: 'list/get/create/update tasks',
  documents: 'list/get document metadata only -- does not return document content',
  'calendar-entries': 'list/get calendar entries (read-only)',
  bills: 'list/get bills/invoices (read-only)',
};

export function getNavigationTools(): Tool[] {
  return [
    {
      name: 'clio_navigate',
      description:
        'Navigate to a Clio domain to see its tools. Domains:\n' +
        DOMAINS.map((d) => `- ${d}: ${DOMAIN_SUMMARY[d]}`).join('\n'),
      annotations: {
        title: 'Navigate to a Clio domain',
        readOnlyHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: DOMAINS,
            description: 'The domain to navigate to.',
          },
        },
        required: ['domain'],
      },
    },
    {
      name: 'clio_status',
      description: 'Check Clio credential status, current region, and available domains.',
      annotations: {
        title: 'Clio connection status',
        readOnlyHint: true,
        openWorldHint: false,
      },
      inputSchema: { type: 'object', properties: {} },
    },
  ];
}

export function getBackTool(): Tool {
  return {
    name: 'clio_back',
    description: 'Return to the Clio domain navigation menu.',
    annotations: {
      title: 'Back to navigation',
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: { type: 'object', properties: {} },
  };
}
