import type { CallToolResult as SdkCallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

/** The eight Clio domains this server exposes, one file each under src/domains/. */
export type DomainName =
  | 'matters'
  | 'contacts'
  | 'activities'
  | 'communications'
  | 'tasks'
  | 'documents'
  | 'calendar-entries'
  | 'bills';

export const DOMAIN_NAMES: DomainName[] = [
  'matters',
  'contacts',
  'activities',
  'communications',
  'tasks',
  'documents',
  'calendar-entries',
  'bills',
];

/** Re-exported so domain handlers don't need to reach into the SDK directly. */
export type CallToolResult = SdkCallToolResult;

/** Every domain file exports a handler with this shape (skill 2.7). */
export interface DomainHandler {
  getTools(): Tool[];
  handleCall(
    toolName: string,
    args: Record<string, unknown>,
    extra?: unknown
  ): Promise<CallToolResult>;
}

/** Per-session decision-tree navigation state (skill 2.6). */
export interface NavigationState {
  currentDomain: DomainName | null;
}

/** Shared result-formatting helpers used by every domain handler. */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
