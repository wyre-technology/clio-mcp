import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CommunicationListParams, CommunicationType } from '@wyre-ai/node-clio';
import type { CallToolResult, DomainHandler } from '../utils/types.js';
import { errorResult, jsonResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { elicitText, hasNoFilters } from '../utils/elicitation.js';
import { logger } from '../utils/logger.js';

const COMMUNICATION_TYPES: CommunicationType[] = ['EmailCommunication', 'PhoneCommunication'];

function getTools(): Tool[] {
  return [
    {
      name: 'clio_communications_list',
      description:
        'List communications (logged emails and phone calls associated with a matter). Read-only -- the ' +
        'Clio SDK has no create/update/delete for communications.',
      annotations: { title: 'List communications', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Wildcard search across subject/body.' },
          matter_id: { type: 'number' },
          contact_id: { type: 'number' },
          user_id: { type: 'number' },
          type: { type: 'string', enum: COMMUNICATION_TYPES },
          date: { type: 'string', description: 'ISO-8601 date -- communications occurring on this exact date.' },
          created_since: { type: 'string', description: 'ISO-8601 timestamp.' },
          updated_since: { type: 'string', description: 'ISO-8601 timestamp.' },
          fields: { type: 'string', description: 'Comma-separated field list. Omitting this returns only id/etag.' },
          limit: { type: 'number', description: 'Max records per page, 1-200. Default 200.' },
          page_token: { type: 'string', description: 'Pagination cursor from a previous response.' },
          order: { type: 'string', description: 'e.g. "id(asc)".' },
        },
      },
    },
    {
      name: 'clio_communications_get',
      description: 'Get a single communication (logged email or phone call) by its numeric Clio ID.',
      annotations: { title: 'Get communication', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The communication ID.' },
          fields: { type: 'string', description: 'Comma-separated field list. Omitting this returns only id/etag.' },
        },
        required: ['id'],
      },
    },
  ];
}

const TOOL_NAMES = new Set(getTools().map((t) => t.name));

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  if (!TOOL_NAMES.has(toolName)) {
    logger.warn('Unknown communications tool', { tool: toolName });
    return errorResult(`Unknown tool: ${toolName}`);
  }
  const client = await getClient();

  switch (toolName) {
    case 'clio_communications_list': {
      let listArgs = args as CommunicationListParams;
      if (hasNoFilters(listArgs)) {
        const term = await elicitText(
          'No filters were provided, which would list every communication in the account -- this data is ' +
            'privileged attorney-client content. Enter a matter ID or a search term, or leave blank to list ' +
            'all communications anyway.'
        );
        if (term) listArgs = { ...listArgs, query: term };
      }
      const page = await client.communications.list(listArgs);
      return jsonResult(page);
    }

    case 'clio_communications_get': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');
      const communication = await client.communications.get(id, { fields: args.fields as string | undefined });
      return jsonResult(communication);
    }

    default:
      logger.warn('Unknown communications tool', { tool: toolName });
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

export const communicationsHandler: DomainHandler = { getTools, handleCall };
