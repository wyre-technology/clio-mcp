import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CalendarEntryListParams } from '@wyre-ai/node-clio';
import type { CallToolResult, DomainHandler } from '../utils/types.js';
import { errorResult, jsonResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { elicitText, hasNoFilters } from '../utils/elicitation.js';
import { logger } from '../utils/logger.js';

function getTools(): Tool[] {
  return [
    {
      name: 'clio_calendar_entries_list',
      description:
        'List calendar entries (logged calendar events, optionally associated with a matter). Read-only -- ' +
        'the Clio SDK has no create/update/delete for calendar entries.',
      annotations: { title: 'List calendar entries', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Wildcard search on the calendar entry.' },
          matter_id: { type: 'number' },
          calendar_id: { type: 'number' },
          from: { type: 'string', description: 'ISO-8601 timestamp -- entries ending on or after this time.' },
          to: { type: 'string', description: 'ISO-8601 timestamp -- entries beginning on or before this time.' },
          is_all_day: { type: 'boolean' },
          fields: { type: 'string', description: 'Comma-separated field list. Omitting this returns only id/etag.' },
          limit: { type: 'number', description: 'Max records per page, 1-200. Default 200.' },
          page_token: { type: 'string', description: 'Pagination cursor from a previous response.' },
          order: { type: 'string', description: 'e.g. "id(asc)".' },
        },
      },
    },
    {
      name: 'clio_calendar_entries_get',
      description:
        'Get a single calendar entry by its ID (Clio documents the path parameter as numeric, even though ' +
        'the response field is typed as a string).',
      annotations: { title: 'Get calendar entry', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The calendar entry ID.' },
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
    logger.warn('Unknown calendar-entries tool', { tool: toolName });
    return errorResult(`Unknown tool: ${toolName}`);
  }
  const client = await getClient();

  switch (toolName) {
    case 'clio_calendar_entries_list': {
      let listArgs = args as CalendarEntryListParams;
      if (hasNoFilters(listArgs)) {
        const term = await elicitText(
          'No filters were provided, which would list every calendar entry in the account. Enter a date ' +
            'range (from/to) or a matter ID, or leave blank to list all calendar entries anyway.'
        );
        if (term) listArgs = { ...listArgs, query: term };
      }
      const page = await client.calendarEntries.list(listArgs);
      return jsonResult(page);
    }

    case 'clio_calendar_entries_get': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');
      const entry = await client.calendarEntries.get(id, { fields: args.fields as string | undefined });
      return jsonResult(entry);
    }

    default:
      logger.warn('Unknown calendar-entries tool', { tool: toolName });
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

export const calendarEntriesHandler: DomainHandler = { getTools, handleCall };
