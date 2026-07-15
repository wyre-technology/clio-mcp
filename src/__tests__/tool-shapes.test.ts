import { describe, expect, it } from 'vitest';
import { DOMAIN_NAMES } from '../utils/types.js';
import { getDomainHandler } from '../domains/index.js';
import { getNavigationTools, getBackTool } from '../domains/navigation.js';

/**
 * Every domain's tool-definition shape: valid inputSchema, and correct
 * annotations for the read-only vs mutation distinction described in the
 * brief -- every `_list`/`_get` tool must be `readOnlyHint: true` and carry
 * no destructive warning; every `_create`/`_update` tool must be
 * `readOnlyHint: false`. No tool in this server is destructive (the SDK has
 * no delete()), so `destructiveHint` must never be true anywhere.
 */
describe('domain tool shapes', () => {
  for (const domain of DOMAIN_NAMES) {
    describe(domain, () => {
      it('every tool has a valid inputSchema and description', async () => {
        const handler = await getDomainHandler(domain);
        const tools = handler.getTools();
        expect(tools.length).toBeGreaterThan(0);
        for (const tool of tools) {
          expect(tool.name).toMatch(/^clio_/);
          expect(typeof tool.description).toBe('string');
          expect(tool.description!.length).toBeGreaterThan(0);
          expect(tool.inputSchema).toBeDefined();
          expect(tool.inputSchema.type).toBe('object');
        }
      });

      it('read-only tools (_list/_get) are readOnlyHint: true with no destructive annotation', async () => {
        const handler = await getDomainHandler(domain);
        const tools = handler.getTools();
        const readOnlyTools = tools.filter((t) => /_(list|get)$/.test(t.name));
        expect(readOnlyTools.length).toBeGreaterThan(0);
        for (const tool of readOnlyTools) {
          expect(tool.annotations?.readOnlyHint).toBe(true);
          expect(tool.annotations?.destructiveHint).not.toBe(true);
          expect(tool.description).not.toMatch(/DESTRUCTIVE|HIGH-IMPACT/);
        }
      });

      it('mutating tools (_create/_update) are readOnlyHint: false and non-destructive', async () => {
        const handler = await getDomainHandler(domain);
        const tools = handler.getTools();
        const mutatingTools = tools.filter((t) => /_(create|update)$/.test(t.name));
        for (const tool of mutatingTools) {
          expect(tool.annotations?.readOnlyHint).toBe(false);
          expect(tool.annotations?.destructiveHint).not.toBe(true);
        }
      });

      it('no tool exposes a delete operation (the SDK has none)', async () => {
        const handler = await getDomainHandler(domain);
        const tools = handler.getTools();
        expect(tools.some((t) => /_delete$/.test(t.name))).toBe(false);
      });
    });
  }

  it('read-only domains (communications, documents, calendar-entries, bills) expose no mutating tools', async () => {
    for (const domain of ['communications', 'documents', 'calendar-entries', 'bills'] as const) {
      const handler = await getDomainHandler(domain);
      const tools = handler.getTools();
      expect(tools.every((t) => /_(list|get)$/.test(t.name))).toBe(true);
    }
  });

  it('documents tool descriptions explicitly state metadata-only scope', async () => {
    const handler = await getDomainHandler('documents');
    const tools = handler.getTools();
    for (const tool of tools) {
      expect(tool.description).toMatch(/metadata only/i);
    }
  });

  it("unknown tool name returns an isError result rather than throwing", async () => {
    const handler = await getDomainHandler('matters');
    await expect(
      handler.handleCall('clio_matters_frobnicate', {})
    ).resolves.toMatchObject({ isError: true });
  });
});

describe('navigation tools', () => {
  it('exposes exactly clio_navigate and clio_status at the root', () => {
    const tools = getNavigationTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['clio_navigate', 'clio_status']);
  });

  it('clio_navigate enumerates every domain', () => {
    const tools = getNavigationTools();
    const navigate = tools.find((t) => t.name === 'clio_navigate')!;
    const domainProp = (navigate.inputSchema.properties as Record<string, { enum?: string[] }>).domain;
    expect(domainProp.enum?.sort()).toEqual([...DOMAIN_NAMES].sort());
  });

  it('navigation tools are read-only', () => {
    for (const tool of [...getNavigationTools(), getBackTool()]) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });
});
