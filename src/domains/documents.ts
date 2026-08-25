import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DocumentListParams } from '@wyre-ai/node-clio';
import type { CallToolResult, DomainHandler } from '../utils/types.js';
import { errorResult, jsonResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { elicitText, hasNoFilters } from '../utils/elicitation.js';
import { logger } from '../utils/logger.js';

function getTools(): Tool[] {
  return [
    {
      name: 'clio_documents_list',
      description:
        'List document metadata (name, filename, size, content type, parent folder, associated matter/contact). ' +
        'Metadata only -- does not return document content. The SDK has no download/upload for document bytes.',
      annotations: { title: 'List document metadata', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Wildcard search on name.' },
          matter_id: { type: 'number' },
          contact_id: { type: 'number' },
          document_category_id: { type: 'number' },
          parent_id: { type: 'number', description: 'Folder ID.' },
          scope: { type: 'string', enum: ['children', 'descendants'], description: 'Defaults to children.' },
          include_deleted: { type: 'boolean' },
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
      name: 'clio_documents_get',
      description:
        'Get metadata for a single document by its numeric Clio ID. Metadata only -- does not return ' +
        'document content.',
      annotations: { title: 'Get document metadata', readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The document ID.' },
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
    logger.warn('Unknown documents tool', { tool: toolName });
    return errorResult(`Unknown tool: ${toolName}`);
  }
  const client = await getClient();

  switch (toolName) {
    case 'clio_documents_list': {
      let listArgs = args as DocumentListParams;
      if (hasNoFilters(listArgs)) {
        const term = await elicitText(
          'No filters were provided, which would list metadata for every document in the account. Enter a ' +
            'matter ID or a search term for the document name, or leave blank to list all document metadata anyway.'
        );
        if (term) listArgs = { ...listArgs, query: term };
      }
      const page = await client.documents.list(listArgs);
      return jsonResult(page);
    }

    case 'clio_documents_get': {
      const id = args.id;
      if (typeof id !== 'number') return errorResult('id is required and must be a number.');
      const document = await client.documents.get(id, { fields: args.fields as string | undefined });
      return jsonResult(document);
    }

    default:
      logger.warn('Unknown documents tool', { tool: toolName });
      return errorResult(`Unknown tool: ${toolName}`);
  }
}

export const documentsHandler: DomainHandler = { getTools, handleCall };
