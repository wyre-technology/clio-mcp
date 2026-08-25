import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { BillListParams, BillState } from '@wyre-ai/node-clio';
import type { CallToolResult, DomainHandler } from '../utils/types.js';
import { errorResult, jsonResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { elicitSelection, hasNoFilters } from '../utils/elicitation.js';
import { logger } from '../utils/logger.js';

const BILL_STATES: BillState[] = ['draft', 'awaiting_approval', 'awaiting_payment', 'paid', 'void', 'deleted'];

function getTools(): Tool[] {
  return [
    {
      name: 'clio_bills_list',
      description:
        'List bills (invoices). Read-only -- billing/trust-accounting mutations are out of scope for the ' +
        'Clio SDK.',
      annotations: { title: 'List bills', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          client_id: { type: 'number' },
          matter_id: { type: 'number' },
          state: { type: 'string', enum: BILL_STATES },
          type: { type: 'string', enum: ['revenue', 'trust'] },
          overdue_only: { type: 'boolean' },
          due_after: { type: 'string', description: 'ISO-8601 date.' },
          due_before: { type: 'string', description: 'ISO-8601 date.' },
          issued_after: { type: 'string', description: 'ISO-8601 date.' },
          issued_before: { type: 'string', description: 'ISO-8601 date.' },
          fields: { type: 'string', description: 'Comma-separated field list. Omitting this returns only id/etag.' },
          limit: { type: 'number', description: 'Max records per page, 1-200. Default 200.' },
          page_token: { type: 'string', description: 'Pagination cursor from a previous response.' },
          order: { type: 'string', description: 'e.g. "id(asc)".' },
        },
      },
    },
    {
      name: 'clio_bills_get',
      description: 'Get a single bill by its numeric Clio ID.',
      annotations: { title: 'Get bill', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The bill ID.' },
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
    logger.warn('Unknown bills tool', { tool: toolName });
    return errorResult(`Unknown tool: ${toolName}`);
  }
  const client = await getClient();

  switch (toolName) {
    case 'clio_bills_list': {
      let listArgs = args as BillListParams;
      if (hasNoFilters(listArgs)) {
        // Bills' free-text `query` filters on invoice number (a number, not a
        // search string -- see BillListParams), so a state pick is a better
        // zero-filter fallback here than the free-text prompt other domains use.
        const choice = await elicitSelection(
          'No filters were provided, which would list every bill in the account. Pick a state to filter by, ' +
            'or leave unselected to list all bills anyway.',
          BILL_STATES
        );
        if (choice && BILL_STATES.includes(choice as BillState)) {
          listArgs = { ...listArgs, state: choice as BillState };
        }
      }
      const page = await client.bills.list(listArgs);
      return jsonResult(page);
    }

    case 'clio_bills_get': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');
      const bill = await client.bills.get(id, { fields: args.fields as string | undefined });
      return jsonResult(bill);
    }

    default:
      logger.warn('Unknown bills tool', { tool: toolName });
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

export const billsHandler: DomainHandler = { getTools, handleCall };
