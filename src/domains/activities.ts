import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ActivityCreateData, ActivityListParams, ActivityType } from '@wyre-technology/node-clio';
import type { CallToolResult, DomainHandler } from '../utils/types.js';
import { errorResult, jsonResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { elicitSelection, elicitText, hasNoFilters } from '../utils/elicitation.js';
import { logger } from '../utils/logger.js';

const ACTIVITY_TYPES: ActivityType[] = ['TimeEntry', 'ExpenseEntry', 'HardCostEntry', 'SoftCostEntry'];

function getTools(): Tool[] {
  return [
    {
      name: 'clio_activities_list',
      description:
        'List activities (time entries and expense entries logged against matters). Supports filtering ' +
        'by matter, user, date range, type, and billing status. No update tool exists -- the SDK has no ' +
        'activities.update().',
      annotations: { title: 'List activities', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Wildcard search on the note field.' },
          matter_id: { type: 'number' },
          user_id: { type: 'number' },
          task_id: { type: 'number' },
          type: { type: 'string', enum: ACTIVITY_TYPES },
          status: {
            type: 'string',
            enum: ['billed', 'draft', 'unbilled', 'non_billable', 'billable', 'written_off'],
          },
          start_date: { type: 'string', description: 'ISO-8601 date -- activities on or after this date.' },
          end_date: { type: 'string', description: 'ISO-8601 date -- activities on or before this date.' },
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
      name: 'clio_activities_get',
      description: 'Get a single activity (time or expense entry) by its numeric Clio ID.',
      annotations: { title: 'Get activity', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The activity ID.' },
          fields: { type: 'string', description: 'Comma-separated field list. Omitting this returns only id/etag.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'clio_activities_create',
      description:
        'Create a new activity (time entry or expense entry). Requires a date and a type. No update tool ' +
        'exists for activities in this server -- the SDK has no activities.update().',
      annotations: { title: 'Create activity', readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO-8601 date, e.g. "2026-07-15". Required.' },
          type: { type: 'string', enum: ACTIVITY_TYPES, description: 'Required.' },
          matter_id: { type: 'number' },
          note: { type: 'string' },
          price: { type: 'number', description: 'TimeEntry: hourly/flat rate. Expense*Entry: the expense amount.' },
          quantity: { type: 'number', description: 'TimeEntry: duration. Expense*Entry: quantity.' },
          non_billable: { type: 'boolean' },
        },
        required: [],
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
    logger.warn('Unknown activities tool', { tool: toolName });
    return errorResult(`Unknown tool: ${toolName}`);
  }
  const client = await getClient();

  switch (toolName) {
    case 'clio_activities_list': {
      let listArgs = args as ActivityListParams;
      if (hasNoFilters(listArgs)) {
        const term = await elicitText(
          'No filters were provided, which would list every activity in the account. Enter a matter ID, ' +
            'a date range, or a search term for the note field -- or leave blank to list all activities anyway.'
        );
        if (term) listArgs = { ...listArgs, query: term };
      }
      const page = await client.activities.list(listArgs);
      return jsonResult(page);
    }

    case 'clio_activities_get': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');
      const activity = await client.activities.get(id, { fields: args.fields as string | undefined });
      return jsonResult(activity);
    }

    case 'clio_activities_create': {
      let date = typeof args.date === 'string' ? args.date : undefined;
      if (!date) {
        date = (await elicitText('What date is this activity for? (ISO-8601, e.g. 2026-07-15)')) ?? undefined;
      }
      if (!date) return errorResult('Cannot create an activity without a date.');

      let type: ActivityType | undefined = ACTIVITY_TYPES.includes(args.type as ActivityType)
        ? (args.type as ActivityType)
        : undefined;
      if (!type) {
        const choice = await elicitSelection('What type of activity is this?', ACTIVITY_TYPES);
        type = ACTIVITY_TYPES.includes(choice as ActivityType) ? (choice as ActivityType) : undefined;
      }
      if (!type) return errorResult('Cannot create an activity without a valid type.');

      const data: ActivityCreateData = {
        date,
        type,
        matter: typeof args.matter_id === 'number' ? { id: args.matter_id } : undefined,
        note: args.note as string | undefined,
        price: args.price as number | undefined,
        quantity: args.quantity as number | undefined,
        non_billable: typeof args.non_billable === 'boolean' ? args.non_billable : undefined,
      };
      const created = await client.activities.create(data);
      return jsonResult(created);
    }

    default:
      logger.warn('Unknown activities tool', { tool: toolName });
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

export const activitiesHandler: DomainHandler = { getTools, handleCall };
