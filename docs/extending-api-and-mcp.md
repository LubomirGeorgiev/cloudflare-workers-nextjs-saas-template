# Extending the API and MCP in your fork

The REST API, the OpenAPI document, and the agent tool surface are one pipeline: describe an
endpoint once and it appears in all three. This page is the map of where each kind of change
belongs.

Related surfaces on the deployed site: `/docs/authentication` for how credentials work, and
`GET /api/v1/openapi.json` for the generated OpenAPI document.

## Adding an endpoint

Mount your own router on the API registry's extension seam and it inherits the whole chain: bearer
authentication, the bridge that lets the existing service layer authorize a bearer caller,
per-credential rate limiting, and problem+json errors. Handlers should call the same service
functions the app's own server actions call, rather than reimplementing the rules.

Declare the operation itself with the `apiOperation` helper, spread ahead of the route's validators:

```ts
router.post(
  "/widgets",
  ...apiOperation({
    operationId: "createWidget",
    tags: [API_TAGS.widgets],
    summary: "Create a widget",
    description: "What the operation does, changes, and returns.",
    scope: "widgets:write",
    audience: "account",
    responses: { 201: jsonResponse({ description: "The created widget.", schema: widgetSchema }) },
  }),
  validator("json", createWidgetSchema, validationHook),
  async (c) => c.json(await createWidget(c.req.valid("json")), 201),
);
```

The policy is stated once. From it the helper emits the OpenAPI `security` metadata, the shared
failure responses every operation documents, and the guard that enforces the scope and the audience
— in that order, ahead of any validator, so a caller that may not call the operation at all never
learns its request schema from a 400. Only success responses go in `responses`.

## Schemas and scopes

Request and response schemas are Valibot, live with the other API schemas, and are converted to
JSON Schema for the document — so one definition validates the request, documents it, and types the
agent tool. Every operation declares the scope it needs; new scopes go in the catalog, which the
consent screen, the security schemes, and the tool filter all read.

## Audience

An API key created for a team may only ever act on that team. Every operation therefore declares an
audience alongside its scope: `"account"` for account-level operations (profile, sessions, key
management, creating a team), `"team"` for anything addressing a team through a `teamId` path
parameter, and `"any"` for the few that serve both and narrow their own result. A route that
declares none fails the route-table audit in the API integration tests, so this cannot be forgotten
rather than decided. Like a scope, an audience only ever narrows the credential owner's live
permissions; team permissions are still checked against D1 on every request.

The declaration also reaches the generated document as `x-audience`, which is how `tools/list`
hides account-level tools from a team-scoped credential. An operation that reaches the document
some other way, without `apiOperation`, fails closed and is read as `"account"` — so a custom team
route must go through the helper to stay visible to team credentials.

## Trusted OAuth client identity

Prefer a stable identity for an integration you intend to trust. A Client ID Metadata Document
(CIMD) uses an HTTPS document URL as the client ID, binds the displayed identity to that domain,
and has no expiring DCR record to renew. An operator-created client is also stable: create it with
the provider's `createClient()` helper and mirror its public metadata in D1 with
`registrationSource: "portal"`. Store and deliver any returned secret through an appropriate
secret-management flow; the D1 mirror is not secret storage.

Keep open dynamic client registration for clients that do not support either stable path. A DCR
client gets a generated ID and a time-limited provider record; approving that exact ID enrolls it
in renewal. Never merge registrations by name, logo, or redirect URI, and never copy verification
between similar registrations: those fields are self-asserted and can be duplicated by another
client. The admin OAuth-apps page therefore presents CIMD and operator-issued clients as preferred
stable sources and dynamic registration as the compatibility fallback.

## Tools follow endpoints

There is no hand-written tool list. Each documented operation becomes one MCP tool named after its
`operationId`, with input and output schemas taken from the document, which is why an operation's
summary and description are agent-facing text rather than decoration. Keep `operationId`s stable:
renaming one renames a tool that clients may already be configured against.

Path, query, and body fields flatten into one argument object, so they must not share a name (nor
claim the reserved `body` argument a non-object request body rides in): derivation refuses such an
operation with an error naming it and the colliding fields, rather than silently dropping the
field. Generation derives the tool surface and throws it away for exactly this reason, so the
collision fails `pnpm build` — and `pnpm run test:integration`, which generates the document too.

## Where to make each change

Each of these files is a deliberate seam, so a fork can add its own surface without editing
anything else.

| File | What it owns |
| --- | --- |
| `src/api/index.ts` | Mount extra routers on `registerCustomRoutes`; they inherit auth, rate limiting, and error handling. |
| `src/api/operation.ts` | `apiOperation`, the one place a route declares its scope, audience, and document metadata. |
| `src/schemas/api/` | Valibot request and response schemas for the API routes. |
| `src/lib/api/scopes.ts` | The scope catalog, its descriptions, and the ceiling applied to self-registered OAuth clients. |
| `src/mcp/tool-overrides.ts` | Rename, re-describe, or hide a derived tool, keyed by `operationId`. |
| `src/mcp/index.ts` | `registerCustomTools`, for agent tools that have no REST equivalent. |
| `src/constants/agent-clients.ts` | The connect-your-agent registry rendered in settings and in the MCP docs page; add or update a client here. |

## Keeping it agent-readable

Write route descriptions for a model that has nothing but the document to go on: what the operation
does, what it changes, and what it returns. Machine responses stay untranslated on purpose — errors
carry stable codes instead of localized prose — so human copy belongs in the message catalogs and
the contract belongs in the schemas.
