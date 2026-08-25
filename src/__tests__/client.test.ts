import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const constructorCalls: Array<Record<string, unknown>> = [];

vi.mock('@wyre-ai/node-clio', () => {
  class MockClioClient {
    config: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      constructorCalls.push(config);
    }
  }
  return { ClioClient: MockClioClient };
});

const { credentialsFromHeaders, getClient, getCredentials, resetClient, runWithCredentials } = await import(
  '../utils/client.js'
);

describe('credentialsFromHeaders', () => {
  it('returns null when X-Clio-Access-Token is absent', () => {
    expect(credentialsFromHeaders({})).toBeNull();
    expect(credentialsFromHeaders({ 'x-clio-region': 'ca' })).toBeNull();
  });

  it('parses the required access token and defaults region to us', () => {
    const creds = credentialsFromHeaders({ 'x-clio-access-token': 'tok-123' });
    expect(creds).toEqual({
      accessToken: 'tok-123',
      refreshToken: undefined,
      clientId: undefined,
      clientSecret: undefined,
      region: 'us',
    });
  });

  it('parses all optional headers when present', () => {
    const creds = credentialsFromHeaders({
      'x-clio-access-token': 'tok-123',
      'x-clio-refresh-token': 'refresh-456',
      'x-clio-client-id': 'client-id',
      'x-clio-client-secret': 'client-secret',
      'x-clio-region': 'eu',
    });
    expect(creds).toEqual({
      accessToken: 'tok-123',
      refreshToken: 'refresh-456',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      region: 'eu',
    });
  });

  it('falls back to us for an invalid region value', () => {
    const creds = credentialsFromHeaders({ 'x-clio-access-token': 'tok', 'x-clio-region': 'mars' });
    expect(creds?.region).toBe('us');
  });

  it('accepts array-valued headers (takes the first entry)', () => {
    const creds = credentialsFromHeaders({ 'x-clio-access-token': ['tok-a', 'tok-b'] });
    expect(creds?.accessToken).toBe('tok-a');
  });

  it('treats a whitespace-only token as absent', () => {
    expect(credentialsFromHeaders({ 'x-clio-access-token': '   ' })).toBeNull();
  });
});

describe('getClient / getCredentials', () => {
  beforeEach(() => {
    constructorCalls.length = 0;
    resetClient();
    delete process.env.CLIO_ACCESS_TOKEN;
  });
  afterEach(() => {
    resetClient();
    delete process.env.CLIO_ACCESS_TOKEN;
  });

  it('throws a clear error when no credentials are configured anywhere', async () => {
    await expect(getClient()).rejects.toThrow(/No Clio credentials configured/);
  });

  it('falls back to CLIO_ACCESS_TOKEN env vars outside a request scope (stdio mode)', async () => {
    process.env.CLIO_ACCESS_TOKEN = 'env-token';
    process.env.CLIO_REGION = 'ca';
    const creds = getCredentials();
    expect(creds).toMatchObject({ accessToken: 'env-token', region: 'ca' });
    delete process.env.CLIO_REGION;
  });

  it('constructs a ClioClient from request-scoped credentials', async () => {
    await runWithCredentials({ accessToken: 'scoped-token', region: 'us' }, async () => {
      const client = await getClient();
      expect(client).toBeDefined();
    });
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0]).toMatchObject({ accessToken: 'scoped-token', region: 'us' });
  });

  it('reuses the cached client for the same credentials (no duplicate construction)', async () => {
    await runWithCredentials({ accessToken: 'same-token', region: 'us' }, async () => {
      await getClient();
      await getClient();
    });
    expect(constructorCalls).toHaveLength(1);
  });

  it('constructs a new client when the access token changes (invalidation)', async () => {
    await runWithCredentials({ accessToken: 'token-a', region: 'us' }, async () => {
      await getClient();
    });
    await runWithCredentials({ accessToken: 'token-b', region: 'us' }, async () => {
      await getClient();
    });
    expect(constructorCalls).toHaveLength(2);
  });

  it('does not let two concurrent requests with different credentials clobber each other', async () => {
    const seen: string[] = [];
    await Promise.all([
      runWithCredentials({ accessToken: 'tenant-a', region: 'us' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        const creds = getCredentials();
        seen.push(`a:${creds?.accessToken}`);
      }),
      runWithCredentials({ accessToken: 'tenant-b', region: 'eu' }, async () => {
        const creds = getCredentials();
        seen.push(`b:${creds?.accessToken}`);
      }),
    ]);
    expect(seen.sort()).toEqual(['a:tenant-a', 'b:tenant-b']);
  });

  it('resetClient() clears the cache so the next getClient() reconstructs', async () => {
    await runWithCredentials({ accessToken: 'token-a', region: 'us' }, async () => {
      await getClient();
    });
    resetClient();
    await runWithCredentials({ accessToken: 'token-a', region: 'us' }, async () => {
      await getClient();
    });
    expect(constructorCalls).toHaveLength(2);
  });
});
