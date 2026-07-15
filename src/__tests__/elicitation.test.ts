import { afterEach, describe, expect, it, vi } from 'vitest';
import { elicitConfirmation, elicitSelection, elicitText, hasNoFilters } from '../utils/elicitation.js';
import { setServerRef } from '../utils/server-ref.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

function fakeServer(elicitInput: (...args: unknown[]) => unknown): Server {
  return { elicitInput } as unknown as Server;
}

describe('elicitText / elicitSelection / elicitConfirmation', () => {
  afterEach(() => {
    setServerRef(null as unknown as Server);
  });

  it('returns null when no server is registered', async () => {
    setServerRef(null as unknown as Server);
    expect(await elicitText('prompt')).toBeNull();
    expect(await elicitSelection('prompt', ['a', 'b'])).toBeNull();
    expect(await elicitConfirmation('prompt')).toBeNull();
  });

  it('elicitText returns the accepted value', async () => {
    setServerRef(fakeServer(async () => ({ action: 'accept', content: { value: 'hello' } })));
    expect(await elicitText('prompt')).toBe('hello');
  });

  it('elicitText returns null when declined', async () => {
    setServerRef(fakeServer(async () => ({ action: 'decline' })));
    expect(await elicitText('prompt')).toBeNull();
  });

  it('elicitText returns null when the transport throws', async () => {
    setServerRef(fakeServer(async () => { throw new Error('client does not support elicitation'); }));
    expect(await elicitText('prompt')).toBeNull();
  });

  it('elicitSelection returns the chosen option', async () => {
    setServerRef(fakeServer(async () => ({ action: 'accept', content: { choice: 'Person' } })));
    expect(await elicitSelection('prompt', ['Person', 'Company'])).toBe('Person');
  });

  it('elicitSelection returns null for an empty options list without calling the server', async () => {
    const spy = vi.fn();
    setServerRef(fakeServer(spy));
    expect(await elicitSelection('prompt', [])).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('elicitConfirmation returns a boolean on accept', async () => {
    setServerRef(fakeServer(async () => ({ action: 'accept', content: { confirm: true } })));
    expect(await elicitConfirmation('prompt')).toBe(true);
  });

  it('elicitConfirmation returns null on cancel', async () => {
    setServerRef(fakeServer(async () => ({ action: 'cancel' })));
    expect(await elicitConfirmation('prompt')).toBeNull();
  });
});

describe('hasNoFilters', () => {
  it('is true for an empty args object', () => {
    expect(hasNoFilters({})).toBe(true);
  });

  it('is true when only pagination/field-selection keys are present', () => {
    expect(hasNoFilters({ fields: 'id,etag', limit: 50, page_token: 'abc', order: 'id(asc)' })).toBe(true);
  });

  it('is true when filter keys are present but undefined/empty', () => {
    expect(hasNoFilters({ query: undefined, status: '', client_id: undefined })).toBe(true);
  });

  it('is false when any real filter is set', () => {
    expect(hasNoFilters({ query: 'Acme Corp' })).toBe(false);
    expect(hasNoFilters({ status: 'open' })).toBe(false);
    expect(hasNoFilters({ client_id: 42 })).toBe(false);
  });
});
