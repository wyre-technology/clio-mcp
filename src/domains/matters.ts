import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MatterCreateData, MatterListParams, MatterStatus, MatterUpdateData } from '@wyre-ai/node-clio';
import type { CallToolResult, DomainHandler } from '../utils/types.js';
import { errorResult, jsonResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { elicitSelection, elicitText, hasNoFilters } from '../utils/elicitation.js';
import { logger } from '../utils/logger.js';

const MATTER_STATUSES: MatterStatus[] = ['open', 'pending', 'closed'];

function getTools(): Tool[] {
  return [
    {
      name: 'clio_matters_list',
      description:
        'List matters (Clio\'s core case/file object). Supports filtering by client, status, ' +
        'practice area, responsible attorney, and free-text query. Pass `fields` to get more ' +
        'than the default id/etag -- e.g. "id,etag,display_number,description,status,client{id,name}".',
      annotations: { title: 'List matters', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Wildcard search across description, display number, and client name.' },
          status: { type: 'string', description: 'Comma-separated: "open,pending,closed".' },
          client_id: { type: 'number', description: 'Filter to matters for this client contact ID.' },
          practice_area_id: { type: 'number' },
          responsible_attorney_id: { type: 'number' },
          billable: { type: 'boolean' },
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
      name: 'clio_matters_get',
      description: 'Get a single matter by its numeric Clio ID.',
      annotations: { title: 'Get matter', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The matter ID.' },
          fields: { type: 'string', description: 'Comma-separated field list. Omitting this returns only id/etag.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'clio_matters_create',
      description: 'Create a new matter. Requires a description and a client.',
      annotations: { title: 'Create matter', readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Matter description. Required by Clio.' },
          client_id: { type: 'number', description: 'Numeric contact ID of the client. Provide this or client_name.' },
          client_name: {
            type: 'string',
            description:
              'Client name to search for, used to resolve client_id when it is not already known. ' +
              'If multiple contacts match, you will be asked to pick one.',
          },
          status: { type: 'string', enum: MATTER_STATUSES, description: 'Defaults to open.' },
          practice_area_id: { type: 'number' },
          responsible_attorney_id: { type: 'number' },
          originating_attorney_id: { type: 'number' },
          billable: { type: 'boolean' },
          open_date: { type: 'string', description: 'ISO-8601 date.' },
          client_reference: { type: 'string' },
        },
        required: [],
      },
    },
    {
      name: 'clio_matters_update',
      description: 'Update an existing matter. Only the fields provided are changed.',
      annotations: { title: 'Update matter', readOnlyHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The matter ID to update.' },
          description: { type: 'string' },
          status: { type: 'string', enum: MATTER_STATUSES },
          client_id: { type: 'number' },
          practice_area_id: { type: 'number' },
          responsible_attorney_id: { type: 'number' },
          originating_attorney_id: { type: 'number' },
          billable: { type: 'boolean' },
          close_date: { type: 'string', description: 'ISO-8601 date.' },
        },
        required: ['id'],
      },
    },
  ];
}

/** Resolve a client contact id from an explicit id, or by name-search + elicited selection. */
async function resolveClientId(
  args: Record<string, unknown>
): Promise<{ clientId?: number; error?: string }> {
  if (typeof args.client_id === 'number') return { clientId: args.client_id };

  const client = await getClient();
  let clientName = typeof args.client_name === 'string' ? args.client_name : undefined;
  if (!clientName) {
    clientName = (await elicitText('Which client is this matter for? Enter the client name to search for.')) ?? undefined;
  }
  if (!clientName) return {};

  const matches = await client.contacts.list({ query: clientName, fields: 'id,name,type' });
  if (matches.data.length === 0) {
    return { error: `No contact found matching "${clientName}". Provide client_id directly, or create the contact first.` };
  }
  if (matches.data.length === 1) {
    return { clientId: matches.data[0]!.id };
  }

  const choice = await elicitSelection(
    `Multiple contacts matched "${clientName}". Which one is the client for this matter?`,
    matches.data.map((c) => `${c.name} (id: ${c.id})`)
  );
  const idMatch = choice?.match(/\(id:\s*(\d+)\)/);
  if (idMatch) return { clientId: Number(idMatch[1]) };
  return { error: `Multiple contacts matched "${clientName}" and none was selected. Provide client_id directly.` };
}

const TOOL_NAMES = new Set(getTools().map((t) => t.name));

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  if (!TOOL_NAMES.has(toolName)) {
    logger.warn('Unknown matters tool', { tool: toolName });
    return errorResult(`Unknown tool: ${toolName}`);
  }
  const client = await getClient();

  switch (toolName) {
    case 'clio_matters_list': {
      let listArgs = args as MatterListParams;
      if (hasNoFilters(listArgs)) {
        const term = await elicitText(
          'No filters were provided, which would list every matter in the account. Enter a search term ' +
            '(matches description, display number, or client name), a status ("open"/"pending"/"closed"), ' +
            'or leave blank to list all matters anyway.'
        );
        if (term) listArgs = { ...listArgs, query: term };
      }
      const page = await client.matters.list(listArgs);
      return jsonResult(page);
    }

    case 'clio_matters_get': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');
      const matter = await client.matters.get(id, { fields: args.fields as string | undefined });
      return jsonResult(matter);
    }

    case 'clio_matters_create': {
      let description = typeof args.description === 'string' ? args.description : undefined;
      if (!description) {
        description = (await elicitText('What is the description for this new matter? (Clio requires a description.)')) ?? undefined;
      }
      if (!description) return errorResult('Cannot create a matter without a description.');

      const { clientId, error } = await resolveClientId(args);
      if (error) return errorResult(error);
      if (!clientId) {
        return errorResult('Cannot create a matter without a client. Provide client_id, or a client_name that resolves to exactly one contact.');
      }

      const data: MatterCreateData = {
        description,
        client: { id: clientId },
        status: args.status as MatterStatus | undefined,
        billable: typeof args.billable === 'boolean' ? args.billable : undefined,
        open_date: args.open_date as string | undefined,
        client_reference: args.client_reference as string | undefined,
        practice_area: typeof args.practice_area_id === 'number' ? { id: args.practice_area_id } : undefined,
        responsible_attorney: typeof args.responsible_attorney_id === 'number' ? { id: args.responsible_attorney_id } : undefined,
        originating_attorney: typeof args.originating_attorney_id === 'number' ? { id: args.originating_attorney_id } : undefined,
      };
      const created = await client.matters.create(data);
      return jsonResult(created);
    }

    case 'clio_matters_update': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');

      const data: MatterUpdateData = {
        description: args.description as string | undefined,
        status: args.status as MatterStatus | undefined,
        billable: typeof args.billable === 'boolean' ? args.billable : undefined,
        close_date: args.close_date as string | undefined,
        client: typeof args.client_id === 'number' ? { id: args.client_id } : undefined,
        practice_area: typeof args.practice_area_id === 'number' ? { id: args.practice_area_id } : undefined,
        responsible_attorney: typeof args.responsible_attorney_id === 'number' ? { id: args.responsible_attorney_id } : undefined,
        originating_attorney: typeof args.originating_attorney_id === 'number' ? { id: args.originating_attorney_id } : undefined,
      };
      const updated = await client.matters.update(id, data);
      return jsonResult(updated);
    }

    default:
      logger.warn('Unknown matters tool', { tool: toolName });
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

export const mattersHandler: DomainHandler = { getTools, handleCall };
