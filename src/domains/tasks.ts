import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  TaskCreateData,
  TaskListParams,
  TaskPriority,
  TaskStatus,
  TaskUpdateData,
} from '@wyre-technology/node-clio';
import type { CallToolResult, DomainHandler } from '../utils/types.js';
import { errorResult, jsonResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { elicitSelection, elicitText, hasNoFilters } from '../utils/elicitation.js';
import { logger } from '../utils/logger.js';

const TASK_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'in_review', 'complete', 'draft'];
const TASK_PRIORITIES: TaskPriority[] = ['High', 'Normal', 'Low'];
const ASSIGNEE_TYPES = ['User', 'Contact'] as const;

function getTools(): Tool[] {
  return [
    {
      name: 'clio_tasks_list',
      description: 'List tasks. Supports filtering by matter, assignee, status, priority, and due date range.',
      annotations: { title: 'List tasks', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Wildcard search across name/description.' },
          matter_id: { type: 'number' },
          assignee_id: { type: 'number' },
          status: { type: 'string', enum: TASK_STATUSES },
          priority: { type: 'string', enum: ['high', 'normal', 'low'], description: 'Lowercase in this filter.' },
          complete: { type: 'boolean' },
          due_at_from: { type: 'string', description: 'ISO-8601 date.' },
          due_at_to: { type: 'string', description: 'ISO-8601 date.' },
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
      name: 'clio_tasks_get',
      description: 'Get a single task by its numeric Clio ID.',
      annotations: { title: 'Get task', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The task ID.' },
          fields: { type: 'string', description: 'Comma-separated field list. Omitting this returns only id/etag.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'clio_tasks_create',
      description: 'Create a new task. Requires a name, a description, and an assignee.',
      annotations: { title: 'Create task', readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Required.' },
          description: { type: 'string', description: 'Required.' },
          assignee_id: { type: 'number', description: 'Numeric Clio user or contact ID. Required.' },
          assignee_type: { type: 'string', enum: ASSIGNEE_TYPES, description: 'Required alongside assignee_id.' },
          matter_id: { type: 'number' },
          due_at: { type: 'string', description: 'ISO-8601 date.' },
          priority: { type: 'string', enum: TASK_PRIORITIES, description: 'Defaults to Normal.' },
          status: { type: 'string', enum: TASK_STATUSES, description: 'Defaults to pending.' },
        },
        required: [],
      },
    },
    {
      name: 'clio_tasks_update',
      description: 'Update an existing task. Only the fields provided are changed.',
      annotations: { title: 'Update task', readOnlyHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The task ID to update.' },
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: TASK_STATUSES },
          priority: { type: 'string', enum: TASK_PRIORITIES },
          due_at: { type: 'string', description: 'ISO-8601 date.' },
          assignee_id: { type: 'number' },
          assignee_type: { type: 'string', enum: ASSIGNEE_TYPES },
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
    logger.warn('Unknown tasks tool', { tool: toolName });
    return errorResult(`Unknown tool: ${toolName}`);
  }
  const client = await getClient();

  switch (toolName) {
    case 'clio_tasks_list': {
      let listArgs = args as TaskListParams;
      if (hasNoFilters(listArgs)) {
        const term = await elicitText(
          'No filters were provided, which would list every task in the account. Enter a search term, a ' +
            'matter ID, or a status -- or leave blank to list all tasks anyway.'
        );
        if (term) listArgs = { ...listArgs, query: term };
      }
      const page = await client.tasks.list(listArgs);
      return jsonResult(page);
    }

    case 'clio_tasks_get': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');
      const task = await client.tasks.get(id, { fields: args.fields as string | undefined });
      return jsonResult(task);
    }

    case 'clio_tasks_create': {
      let name = typeof args.name === 'string' ? args.name : undefined;
      if (!name) name = (await elicitText('What is the name of this task?')) ?? undefined;
      if (!name) return errorResult('Cannot create a task without a name.');

      let description = typeof args.description === 'string' ? args.description : undefined;
      if (!description) description = (await elicitText('What is the description of this task?')) ?? undefined;
      if (!description) return errorResult('Cannot create a task without a description.');

      let assigneeId = typeof args.assignee_id === 'number' ? args.assignee_id : undefined;
      let assigneeType = ASSIGNEE_TYPES.includes(args.assignee_type as (typeof ASSIGNEE_TYPES)[number])
        ? (args.assignee_type as (typeof ASSIGNEE_TYPES)[number])
        : undefined;
      if (!assigneeId) {
        const idText = await elicitText('Who should this task be assigned to? Enter the numeric Clio user or contact ID.');
        if (idText && /^\d+$/.test(idText)) assigneeId = Number(idText);
      }
      if (assigneeId && !assigneeType) {
        const choice = await elicitSelection('Is the assignee a Clio User or a Contact?', ASSIGNEE_TYPES.slice());
        assigneeType = ASSIGNEE_TYPES.includes(choice as (typeof ASSIGNEE_TYPES)[number])
          ? (choice as (typeof ASSIGNEE_TYPES)[number])
          : 'User';
      }
      if (!assigneeId || !assigneeType) {
        return errorResult('Cannot create a task without an assignee (assignee_id + assignee_type).');
      }

      const data: TaskCreateData = {
        name,
        description,
        assignee: { id: assigneeId, type: assigneeType },
        matter: typeof args.matter_id === 'number' ? { id: args.matter_id } : undefined,
        due_at: args.due_at as string | undefined,
        priority: args.priority as TaskPriority | undefined,
        status: args.status as TaskStatus | undefined,
      };
      const created = await client.tasks.create(data);
      return jsonResult(created);
    }

    case 'clio_tasks_update': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');

      const assigneeId = typeof args.assignee_id === 'number' ? args.assignee_id : undefined;
      const assigneeType = ASSIGNEE_TYPES.includes(args.assignee_type as (typeof ASSIGNEE_TYPES)[number])
        ? (args.assignee_type as (typeof ASSIGNEE_TYPES)[number])
        : undefined;

      const data: TaskUpdateData = {
        name: args.name as string | undefined,
        description: args.description as string | undefined,
        status: args.status as TaskStatus | undefined,
        priority: args.priority as TaskPriority | undefined,
        due_at: args.due_at as string | undefined,
        assignee: assigneeId && assigneeType ? { id: assigneeId, type: assigneeType } : undefined,
      };
      const updated = await client.tasks.update(id, data);
      return jsonResult(updated);
    }

    default:
      logger.warn('Unknown tasks tool', { tool: toolName });
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

export const tasksHandler: DomainHandler = { getTools, handleCall };
