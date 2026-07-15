import { getServerRef } from './server-ref.js';
import { logger } from './logger.js';

/**
 * Elicitation infrastructure (skill 2.8, REQUIRED).
 *
 * All three helpers are wrapped in try/catch and return `null` on any
 * failure (client doesn't support elicitation, user declined/cancelled, a
 * malformed response, etc). Elicitation is purely additive: every call site
 * MUST treat `null` the same as "proceed with the original, unfiltered
 * behavior" -- never treat a failed elicitation as an error.
 */

/** Ask the user to pick one option from a fixed list. Returns the chosen string, or null. */
export async function elicitSelection(message: string, options: string[]): Promise<string | null> {
  const server = getServerRef();
  if (!server || options.length === 0) return null;
  try {
    const result = await server.elicitInput({
      message,
      requestedSchema: {
        type: 'object',
        properties: {
          choice: {
            type: 'string',
            title: 'Selection',
            enum: options,
          },
        },
        required: ['choice'],
      },
    });
    if (result.action !== 'accept' || !result.content) return null;
    const value = result.content['choice'];
    return typeof value === 'string' ? value : null;
  } catch (err) {
    logger.debug('elicitSelection failed, proceeding without elicitation', { error: String(err) });
    return null;
  }
}

/** Ask the user for freeform text (a search term, a date, a name). Returns the text, or null. */
export async function elicitText(message: string, opts?: { title?: string }): Promise<string | null> {
  const server = getServerRef();
  if (!server) return null;
  try {
    const result = await server.elicitInput({
      message,
      requestedSchema: {
        type: 'object',
        properties: {
          value: {
            type: 'string',
            title: opts?.title ?? 'Value',
          },
        },
        required: ['value'],
      },
    });
    if (result.action !== 'accept' || !result.content) return null;
    const value = result.content['value'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch (err) {
    logger.debug('elicitText failed, proceeding without elicitation', { error: String(err) });
    return null;
  }
}

/**
 * Ask the user to confirm a destructive/high-impact action. Returns true/false,
 * or null if elicitation isn't available/failed (callers should treat null the
 * same as "not confirmed" for anything destructive).
 *
 * Not currently wired to any tool in this server -- the Clio SDK has no
 * delete() on any resource, so there is no Tier-A/Tier-B destructive tool to
 * gate (see skill 2.7b). Included per skill 2.8's "every MCP server MUST
 * include elicitation infrastructure" requirement, and so any destructive
 * tool added in a future SDK version has this ready to use.
 */
export async function elicitConfirmation(message: string): Promise<boolean | null> {
  const server = getServerRef();
  if (!server) return null;
  try {
    const result = await server.elicitInput({
      message,
      requestedSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            title: 'Confirm',
          },
        },
        required: ['confirm'],
      },
    });
    if (result.action !== 'accept' || !result.content) return null;
    const value = result.content['confirm'];
    return typeof value === 'boolean' ? value : null;
  } catch (err) {
    logger.debug('elicitConfirmation failed, proceeding without elicitation', { error: String(err) });
    return null;
  }
}

/**
 * Pagination/field-selection params that don't count as a "filter" for the
 * purposes of the zero-filter elicitation rule below.
 */
const NON_FILTER_KEYS = new Set(['fields', 'limit', 'page_token', 'order']);

/**
 * True when `args` (a `*_list` tool's arguments) carries no real filter --
 * i.e. it would run an unbounded query across every record in the account.
 * Per skill 2.8's default rules table, list/search tools called with zero
 * filters should elicit a search term or date range before running.
 */
export function hasNoFilters(args: Record<string, unknown>): boolean {
  return Object.entries(args).every(([key, value]) => {
    if (NON_FILTER_KEYS.has(key)) return true;
    return value === undefined || value === null || value === '';
  });
}
