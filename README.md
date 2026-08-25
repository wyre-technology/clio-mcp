# clio-mcp

MCP (Model Context Protocol) server for [Clio Manage](https://www.clio.com/) -- matters, contacts,
activities, communications, tasks, documents, calendar entries, and bills. Built on
[`@wyre-ai/node-clio`](https://github.com/WYRE-AI/node-clio).

> **Compliance note.** This server proxies access to attorney-client privileged data (matters,
> communications, documents). It does not log or persist any request or response content anywhere --
> the structured stderr logger (`src/utils/logger.ts`) only ever emits level, timestamp, and a small
> context object such as a tool name or an error message, never tool arguments or result bodies. Document
> tools (`clio_documents_list` / `clio_documents_get`) return **metadata only** -- name, filename, size,
> content type, parent folder, associated matter/contact -- and never document content; the underlying SDK
> has no download/upload capability.

## Install

```bash
npm install
npm run build
```

Requires Node.js >= 20. This package depends on `@wyre-ai/node-clio`, published to GitHub
Packages -- see `.npmrc` (registry + token) if installing outside CI.

## Running

```bash
npm run start        # stdio transport, reads CLIO_* env vars
npm run start:http    # HTTP streaming transport (gateway mode), reads X-Clio-* headers per request
```

### Credentials

Clio is **OAuth-only** -- there is no static API key. This server never performs the OAuth
authorize/token dance itself; something upstream (the WYRE MCP gateway, or your own OAuth client) does
that and hands this server a bearer access token.

**Gateway mode** (`AUTH_MODE=gateway`, `MCP_TRANSPORT=http` -- the Docker image's default): credentials
are read from request headers, per request:

| Header | Required | Description |
|---|---|---|
| `X-Clio-Access-Token` | Yes | OAuth bearer access token. |
| `X-Clio-Refresh-Token` | No | Enables automatic refresh-on-401. |
| `X-Clio-Client-Id` | No | Required if `X-Clio-Refresh-Token` is present -- Clio's refresh flow needs the app's client id. |
| `X-Clio-Client-Secret` | No | Required if `X-Clio-Refresh-Token` is present. |
| `X-Clio-Region` | No | One of `us` \| `ca` \| `eu` \| `au`. Defaults to `us`. |

A request with no `X-Clio-Access-Token` header is not rejected outright -- `initialize` and `tools/list`
still work (so the gateway can discover tools before a user has connected), but any `tools/call` will
fail with a clear "No Clio credentials configured" error.

**stdio mode** (local/CLI use, a single set of credentials for the whole process): set environment
variables instead:

```bash
export CLIO_ACCESS_TOKEN=...
export CLIO_REFRESH_TOKEN=...   # optional
export CLIO_CLIENT_ID=...       # optional, required alongside a refresh token
export CLIO_CLIENT_SECRET=...   # optional, required alongside a refresh token
export CLIO_REGION=us           # optional, defaults to us
```

Clio runs four separate regional deployments (`us`/`ca`/`eu`/`au`) -- a token minted for one region is
not valid against another, and a Clio developer app registration is itself region-specific. Get an
access token via the [Clio OAuth flow](https://docs.developers.clio.com/api-docs/clio-manage/authorization/)
for the region you need; `@wyre-ai/node-clio` exports `buildAuthorizationUrl` /
`exchangeAuthorizationCode` helpers for that.

## Tool navigation

This server uses decision-tree navigation instead of exposing all tools flat. Initially only two tools
are visible:

- **`clio_navigate`** -- switch into one of the eight domains below; the domain's tools (plus
  `clio_back`) then appear in the next `tools/list`.
- **`clio_status`** -- check credential/connection status and see the list of domains.

Once inside a domain, **`clio_back`** returns to the navigation menu.

## Tool reference

Every tool is named `clio_{entity}_{operation}`. Read-only tools (`_list`/`_get`) never mutate Clio data
and are marked `readOnlyHint: true`. Tools that create or update records are marked `readOnlyHint: false`.
No tool in this server is destructive/irreversible -- the underlying SDK has no `delete()` on any
resource, so there is nothing to warn about at that tier.

Every `_list` tool called with no filters at all will ask (via MCP elicitation) for a search term, date
range, or similar before running what would otherwise be an unbounded query across the whole account. If
the client doesn't support elicitation, or the user doesn't answer, the tool proceeds unfiltered anyway --
elicitation is purely additive and never blocks the call.

### matters

| Tool | Description |
|---|---|
| `clio_matters_list` | List matters, filterable by client, status, practice area, responsible attorney, free-text query. |
| `clio_matters_get` | Get a single matter by ID. |
| `clio_matters_create` | Create a matter. Requires `description` and a client -- pass `client_id`, or `client_name` to resolve it by search (asks you to pick if the name is ambiguous). |
| `clio_matters_update` | Update a matter. Only the fields you pass are changed. |

### contacts

| Tool | Description |
|---|---|
| `clio_contacts_list` | List contacts (people and companies), filterable by type, client-only, free-text query. |
| `clio_contacts_get` | Get a single contact by ID. |
| `clio_contacts_create` | Create a contact. Requires `name` and `type` (`Person` or `Company`). |
| `clio_contacts_update` | Update a contact. Only the fields you pass are changed. |

### activities

Time entries and expense entries logged against matters.

| Tool | Description |
|---|---|
| `clio_activities_list` | List activities, filterable by matter, user, task, type, billing status, date range. |
| `clio_activities_get` | Get a single activity by ID. |
| `clio_activities_create` | Create a time or expense entry. Requires `date` and `type`. |

There is no `clio_activities_update` -- the SDK has no `activities.update()`.

### communications (read-only)

Logged emails and phone calls. **Read-only in the underlying SDK** -- there is no create/update/delete,
by design, since this data routinely contains privileged attorney-client content.

| Tool | Description |
|---|---|
| `clio_communications_list` | List communications, filterable by matter, contact, user, type, date. |
| `clio_communications_get` | Get a single communication by ID. |

### tasks

| Tool | Description |
|---|---|
| `clio_tasks_list` | List tasks, filterable by matter, assignee, status, priority, due date range. |
| `clio_tasks_get` | Get a single task by ID. |
| `clio_tasks_create` | Create a task. Requires `name`, `description`, and an assignee (`assignee_id` + `assignee_type`). |
| `clio_tasks_update` | Update a task. Only the fields you pass are changed. |

### documents (read-only, metadata only)

**Metadata only -- does not return document content.** The underlying SDK deliberately does not
implement document upload/download; documents are the highest-sensitivity object in a legal
practice-management system and content transfer is out of scope pending its own dedicated review.

| Tool | Description |
|---|---|
| `clio_documents_list` | List document metadata, filterable by matter, contact, category, parent folder. |
| `clio_documents_get` | Get metadata for a single document by ID. |

### calendar-entries (read-only)

| Tool | Description |
|---|---|
| `clio_calendar_entries_list` | List calendar entries, filterable by matter, calendar, date range. |
| `clio_calendar_entries_get` | Get a single calendar entry by ID. |

### bills (read-only)

Invoices. Billing/trust-accounting mutations touch regulated funds-handling workflows and are out of
scope for the underlying SDK.

| Tool | Description |
|---|---|
| `clio_bills_list` | List bills, filterable by client, matter, state, type, due/issued date range. |
| `clio_bills_get` | Get a single bill by ID. |

## Architecture

```
src/
├── index.ts          # Entry point -- picks stdio or HTTP transport
├── server.ts          # Server setup, decision-tree tool routing
├── http.ts            # HTTP streaming transport (gateway mode)
├── utils/
│   ├── client.ts       # Credential parsing + ClioClient cache/invalidation
│   ├── logger.ts        # Structured stderr-only logger
│   ├── server-ref.ts     # Shared Server reference for elicitation
│   ├── elicitation.ts     # elicitText / elicitSelection / elicitConfirmation
│   └── types.ts           # DomainHandler interface, shared result helpers
├── domains/            # One file per Clio SDK resource
│   ├── index.ts          # Lazy-loaded domain registry
│   ├── navigation.ts      # clio_navigate / clio_status / clio_back
│   ├── matters.ts
│   ├── contacts.ts
│   ├── activities.ts
│   ├── communications.ts
│   ├── tasks.ts
│   ├── documents.ts
│   ├── calendar-entries.ts
│   └── bills.ts
└── __tests__/
```

Every HTTP request gets a fresh `Server` + `StreamableHTTPServerTransport` pair (stateless, no session
ID) -- the gateway sends separate requests for `initialize`, `tools/list`, and `tools/call`, and a shared
server would reject the second `initialize`. Per-request tenant credentials are carried in an
`AsyncLocalStorage` context opened for the duration of that one request, so two concurrent requests
bearing different tenants' tokens can never see each other's credentials.

## Testing

```bash
npm test
```

Tests mock the `@wyre-ai/node-clio` client and the MCP server's `elicitInput` -- no live Clio
credentials are needed. Coverage: every domain's tool-definition shape (valid `inputSchema`, correct
`readOnlyHint` per read vs. mutate), credential header parsing and client cache invalidation, and
handler routing/elicitation behavior for representative tools in each domain.

## License

Apache-2.0. See [LICENSE](./LICENSE).
