import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClient = {
  matters: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
  contacts: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
  activities: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
  tasks: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
  communications: { list: vi.fn(), get: vi.fn() },
  documents: { list: vi.fn(), get: vi.fn() },
  calendarEntries: { list: vi.fn(), get: vi.fn() },
  bills: { list: vi.fn(), get: vi.fn() },
};

vi.mock('../utils/client.js', () => ({
  getClient: vi.fn(async () => mockClient),
}));

const elicitText = vi.fn(async (_msg: string) => null as string | null);
const elicitSelection = vi.fn(async (_msg: string, _opts: string[]) => null as string | null);
vi.mock('../utils/elicitation.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/elicitation.js')>('../utils/elicitation.js');
  return {
    ...actual,
    elicitText: (...args: [string]) => elicitText(...args),
    elicitSelection: (...args: [string, string[]]) => elicitSelection(...args),
  };
});

const { mattersHandler } = await import('../domains/matters.js');
const { contactsHandler } = await import('../domains/contacts.js');
const { tasksHandler } = await import('../domains/tasks.js');
const { activitiesHandler } = await import('../domains/activities.js');
const { billsHandler } = await import('../domains/bills.js');

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(mockClient).forEach((resource) =>
    Object.values(resource).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset())
  );
});

describe('matters handler', () => {
  it('list: zero filters triggers elicitText and merges the term into the query', async () => {
    elicitText.mockResolvedValueOnce('Acme');
    mockClient.matters.list.mockResolvedValueOnce({ data: [], hasMore: false });
    await mattersHandler.handleCall('clio_matters_list', {});
    expect(elicitText).toHaveBeenCalledOnce();
    expect(mockClient.matters.list).toHaveBeenCalledWith(expect.objectContaining({ query: 'Acme' }));
  });

  it('list: skips elicitation when a filter is already present', async () => {
    mockClient.matters.list.mockResolvedValueOnce({ data: [], hasMore: false });
    await mattersHandler.handleCall('clio_matters_list', { status: 'open' });
    expect(elicitText).not.toHaveBeenCalled();
    expect(mockClient.matters.list).toHaveBeenCalledWith({ status: 'open' });
  });

  it('list: elicitation declining (null) still lists unfiltered', async () => {
    elicitText.mockResolvedValueOnce(null);
    mockClient.matters.list.mockResolvedValueOnce({ data: [], hasMore: false });
    const result = await mattersHandler.handleCall('clio_matters_list', {});
    expect(result.isError).not.toBe(true);
    expect(mockClient.matters.list).toHaveBeenCalledWith({});
  });

  it('get: requires a numeric id', async () => {
    const result = await mattersHandler.handleCall('clio_matters_get', {});
    expect(result.isError).toBe(true);
    expect(mockClient.matters.get).not.toHaveBeenCalled();
  });

  it('create: missing description elicits it, then proceeds', async () => {
    elicitText.mockResolvedValueOnce('New matter description');
    mockClient.matters.create.mockResolvedValueOnce({ id: 1 });
    const result = await mattersHandler.handleCall('clio_matters_create', { client_id: 42 });
    expect(result.isError).not.toBe(true);
    expect(mockClient.matters.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'New matter description', client: { id: 42 } })
    );
  });

  it('create: missing description and declined elicitation returns isError without calling the SDK', async () => {
    elicitText.mockResolvedValueOnce(null);
    const result = await mattersHandler.handleCall('clio_matters_create', { client_id: 42 });
    expect(result.isError).toBe(true);
    expect(mockClient.matters.create).not.toHaveBeenCalled();
  });

  it('create: resolves client_name to a single matching contact', async () => {
    mockClient.contacts.list.mockResolvedValueOnce({ data: [{ id: 7, name: 'Acme Corp' }], hasMore: false });
    mockClient.matters.create.mockResolvedValueOnce({ id: 1 });
    await mattersHandler.handleCall('clio_matters_create', { description: 'd', client_name: 'Acme' });
    expect(mockClient.matters.create).toHaveBeenCalledWith(expect.objectContaining({ client: { id: 7 } }));
  });

  it('create: ambiguous client_name elicits a selection and parses the chosen id', async () => {
    mockClient.contacts.list.mockResolvedValueOnce({
      data: [
        { id: 7, name: 'Acme Corp' },
        { id: 8, name: 'Acme Industries' },
      ],
      hasMore: false,
    });
    elicitSelection.mockResolvedValueOnce('Acme Industries (id: 8)');
    mockClient.matters.create.mockResolvedValueOnce({ id: 1 });
    await mattersHandler.handleCall('clio_matters_create', { description: 'd', client_name: 'Acme' });
    expect(elicitSelection).toHaveBeenCalledOnce();
    expect(mockClient.matters.create).toHaveBeenCalledWith(expect.objectContaining({ client: { id: 8 } }));
  });

  it('create: no client_id/client_name and declined elicitation returns isError', async () => {
    elicitText.mockResolvedValueOnce('description text').mockResolvedValueOnce(null);
    const result = await mattersHandler.handleCall('clio_matters_create', {});
    expect(result.isError).toBe(true);
    expect(mockClient.matters.create).not.toHaveBeenCalled();
  });

  it('update: requires a numeric id', async () => {
    const result = await mattersHandler.handleCall('clio_matters_update', { description: 'x' });
    expect(result.isError).toBe(true);
  });

  it('unknown tool returns isError without touching the SDK', async () => {
    const result = await mattersHandler.handleCall('clio_matters_teleport', {});
    expect(result.isError).toBe(true);
    expect(mockClient.matters.list).not.toHaveBeenCalled();
  });
});

describe('contacts handler', () => {
  it('create: missing type elicits a Person/Company selection', async () => {
    elicitSelection.mockResolvedValueOnce('Company');
    mockClient.contacts.create.mockResolvedValueOnce({ id: 1 });
    await contactsHandler.handleCall('clio_contacts_create', { name: 'Acme Corp' });
    expect(mockClient.contacts.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'Company' }));
  });

  it('create: missing name and declined elicitation returns isError', async () => {
    elicitText.mockResolvedValueOnce(null);
    const result = await contactsHandler.handleCall('clio_contacts_create', { type: 'Person' });
    expect(result.isError).toBe(true);
    expect(mockClient.contacts.create).not.toHaveBeenCalled();
  });
});

describe('activities handler', () => {
  it('create: missing type elicits a selection from the activity type enum', async () => {
    elicitSelection.mockResolvedValueOnce('ExpenseEntry');
    mockClient.activities.create.mockResolvedValueOnce({ id: 1 });
    await activitiesHandler.handleCall('clio_activities_create', { date: '2026-07-15' });
    expect(elicitSelection).toHaveBeenCalledWith(expect.any(String), [
      'TimeEntry',
      'ExpenseEntry',
      'HardCostEntry',
      'SoftCostEntry',
    ]);
    expect(mockClient.activities.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'ExpenseEntry' }));
  });

  it('has no update tool (the SDK has none)', () => {
    const names = activitiesHandler.getTools().map((t) => t.name);
    expect(names).not.toContain('clio_activities_update');
  });
});

describe('tasks handler', () => {
  it('create: missing assignee_id prompts for it and defaults type to User when unspecified', async () => {
    elicitText.mockResolvedValueOnce('55');
    elicitSelection.mockResolvedValueOnce('User');
    mockClient.tasks.create.mockResolvedValueOnce({ id: 1 });
    await tasksHandler.handleCall('clio_tasks_create', { name: 'n', description: 'd' });
    expect(mockClient.tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ assignee: { id: 55, type: 'User' } })
    );
  });
});

describe('bills handler (read-only)', () => {
  it('list: zero filters elicits a state selection', async () => {
    elicitSelection.mockResolvedValueOnce('paid');
    mockClient.bills.list.mockResolvedValueOnce({ data: [], hasMore: false });
    await billsHandler.handleCall('clio_bills_list', {});
    expect(mockClient.bills.list).toHaveBeenCalledWith(expect.objectContaining({ state: 'paid' }));
  });

  it('exposes no create/update tools', () => {
    const names = billsHandler.getTools().map((t) => t.name);
    expect(names.every((n) => /_(list|get)$/.test(n))).toBe(true);
  });
});
