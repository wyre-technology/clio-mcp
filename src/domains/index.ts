import type { DomainHandler, DomainName } from '../utils/types.js';

/**
 * Lazy-loaded domain registry (skill 2.2). Each domain's module (and its
 * transitive imports) is only loaded the first time a caller navigates into
 * it, keeping the initial `tools/list` response (navigation tools only)
 * cheap.
 */
export async function getDomainHandler(domain: DomainName): Promise<DomainHandler> {
  switch (domain) {
    case 'matters':
      return (await import('./matters.js')).mattersHandler;
    case 'contacts':
      return (await import('./contacts.js')).contactsHandler;
    case 'activities':
      return (await import('./activities.js')).activitiesHandler;
    case 'communications':
      return (await import('./communications.js')).communicationsHandler;
    case 'tasks':
      return (await import('./tasks.js')).tasksHandler;
    case 'documents':
      return (await import('./documents.js')).documentsHandler;
    case 'calendar-entries':
      return (await import('./calendar-entries.js')).calendarEntriesHandler;
    case 'bills':
      return (await import('./bills.js')).billsHandler;
    default: {
      const exhaustive: never = domain;
      throw new Error(`Unknown domain: ${exhaustive}`);
    }
  }
}
