import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContactCreateData, ContactListParams, ContactType, ContactUpdateData } from '@wyre-technology/node-clio';
import type { CallToolResult, DomainHandler } from '../utils/types.js';
import { errorResult, jsonResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { elicitSelection, elicitText, hasNoFilters } from '../utils/elicitation.js';
import { logger } from '../utils/logger.js';

const CONTACT_TYPES: ContactType[] = ['Person', 'Company'];

function getTools(): Tool[] {
  return [
    {
      name: 'clio_contacts_list',
      description:
        'List contacts (people and companies -- clients, opposing counsel, witnesses). Supports ' +
        'filtering by type, client-only, and free-text query.',
      annotations: { title: 'List contacts', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Wildcard search across name, title, email, address, phone.' },
          type: { type: 'string', enum: CONTACT_TYPES },
          client_only: { type: 'boolean', description: 'Filter to contacts that are clients.' },
          initial: { type: 'string', description: 'Single uppercase letter -- last name / company name starts with this.' },
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
      name: 'clio_contacts_get',
      description: 'Get a single contact by its numeric Clio ID.',
      annotations: { title: 'Get contact', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The contact ID.' },
          fields: { type: 'string', description: 'Comma-separated field list. Omitting this returns only id/etag.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'clio_contacts_create',
      description:
        'Create a new contact. Requires a name and a type (Person or Company). For a Person, also set ' +
        'first_name/last_name.',
      annotations: { title: 'Create contact', readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full display name (for a Company, this is the company name). Required.' },
          type: { type: 'string', enum: CONTACT_TYPES, description: 'Required.' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company_id: { type: 'number', description: 'For a Person, the employer Company contact ID.' },
          email: { type: 'string', description: 'Primary email address.' },
          phone: { type: 'string', description: 'Primary phone number.' },
        },
        required: [],
      },
    },
    {
      name: 'clio_contacts_update',
      description: 'Update an existing contact. Only the fields provided are changed.',
      annotations: { title: 'Update contact', readOnlyHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The contact ID to update.' },
          name: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          email: { type: 'string', description: 'Primary email address.' },
          phone: { type: 'string', description: 'Primary phone number.' },
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
    logger.warn('Unknown contacts tool', { tool: toolName });
    return errorResult(`Unknown tool: ${toolName}`);
  }
  const client = await getClient();

  switch (toolName) {
    case 'clio_contacts_list': {
      let listArgs = args as ContactListParams;
      if (hasNoFilters(listArgs)) {
        const term = await elicitText(
          'No filters were provided, which would list every contact in the account. Enter a search term ' +
            '(matches name, email, phone, or address), or leave blank to list all contacts anyway.'
        );
        if (term) listArgs = { ...listArgs, query: term };
      }
      const page = await client.contacts.list(listArgs);
      return jsonResult(page);
    }

    case 'clio_contacts_get': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');
      const contact = await client.contacts.get(id, { fields: args.fields as string | undefined });
      return jsonResult(contact);
    }

    case 'clio_contacts_create': {
      let name = typeof args.name === 'string' ? args.name : undefined;
      if (!name) {
        name = (await elicitText('What is the name for this new contact (person or company)?')) ?? undefined;
      }
      if (!name) return errorResult('Cannot create a contact without a name.');

      let type: ContactType | undefined = CONTACT_TYPES.includes(args.type as ContactType)
        ? (args.type as ContactType)
        : undefined;
      if (!type) {
        const choice = await elicitSelection('Is this contact a Person or a Company?', CONTACT_TYPES);
        type = CONTACT_TYPES.includes(choice as ContactType) ? (choice as ContactType) : undefined;
      }
      if (!type) return errorResult('Cannot create a contact without a type (Person or Company).');

      const data: ContactCreateData = {
        name,
        type,
        first_name: args.first_name as string | undefined,
        last_name: args.last_name as string | undefined,
        company: typeof args.company_id === 'number' ? { id: args.company_id } : undefined,
        email_addresses: typeof args.email === 'string' ? [{ name: 'Work', address: args.email, default_email: true }] : undefined,
        phone_numbers: typeof args.phone === 'string' ? [{ name: 'Work', number: args.phone, default_number: true }] : undefined,
      };
      const created = await client.contacts.create(data);
      return jsonResult(created);
    }

    case 'clio_contacts_update': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');

      const data: ContactUpdateData = {
        name: args.name as string | undefined,
        first_name: args.first_name as string | undefined,
        last_name: args.last_name as string | undefined,
        email_addresses: typeof args.email === 'string' ? [{ name: 'Work', address: args.email, default_email: true }] : undefined,
        phone_numbers: typeof args.phone === 'string' ? [{ name: 'Work', number: args.phone, default_number: true }] : undefined,
      };
      const updated = await client.contacts.update(id, data);
      return jsonResult(updated);
    }

    default:
      logger.warn('Unknown contacts tool', { tool: toolName });
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

export const contactsHandler: DomainHandler = { getTools, handleCall };
