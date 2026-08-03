# Keeping the Worker fast: hot path, startup, bundle

Three separate budgets. Know which one your change spends.

| Budget | What spends it | How to check |
| --- | --- | --- |
| **Startup CPU** (400 ms limit) | Modules the entry reaches by *static* import — parsed and evaluated on every cold isolate | Trace static imports from `dist/server/index.js` |
| **Request CPU** | Work inside a handler | Read the handler |
| **Upload size** (3 MiB gzip) | Every module in `dist/`, imported or not | `pnpm build && pnpm exec wrangler deploy --dry-run` |

Uploaded is not the same as evaluated. A 250 KiB chunk behind `await import()` costs upload only, and only on the route that reaches it.

## Rules

**Nothing goes on the startup path unless every request needs it.** `worker-entrypoint.ts` is imported for every request — a marketing page, a health check, an asset. It reaches the API and MCP through lazy handlers for exactly this reason:

```ts
const apiHandler = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    (await import("./src/api")).apiApp.fetch(request, env, ctx),
};
```

Do the same for anything the entry needs only on some invocations — a callback that runs only when a bearer token is present, an outbound mirror that runs on one endpoint, the `scheduled` and `queue` handlers (their own entrypoints; a fetch never needs the job graph). One `await import()` per isolate is free next to evaluating the module on every cold start.

**Watch what a static import drags in.** Importing the Hono app once pulled the Stripe billing service (211 KiB) and a user-agent parser onto the cold path. Follow the chain, not the file.

**Precompute anything deterministic at build time.** The OpenAPI document is built by `scripts/generate-openapi.mjs` and served as a virtual module (`tools/openapi-document.ts`), so no isolate runs the Valibot→JSON Schema conversion. If a value depends only on static schemas and build-time constants, it does not belong in a runtime memo.

**Memoize per isolate what you cannot precompute, at module scope, lazily.** `let x: T | null = null; x ??= build()`. Compiled schema validators in `src/mcp/index.ts` work this way — the MCP transport is stateless, so every JSON-RPC POST rebuilds the server, and without the memo it would recompile every tool schema each time.

**Serve prebuilt bytes.** A route that answers with a fixed payload should ship the serialized string, not an object it re-serializes per request — `c.json(bigObject)` is JSON.stringify on every hit. `openapi.json` returns the generated document verbatim for this reason, and the parsed form is a separate lazy export so requests that never read it skip building the objects at all.

**Never `import()` inside a per-request loop.** Hoist it to the handler.

## Known, not yet done

**Lazy per-locale message catalogs.** `src/i18n/message-catalogs.ts` statically imports every locale, so all of them are evaluated on every cold isolate — 118.6 KiB today, and roughly +70 KiB per locale added. The fix is loading only the active locale (plus `DEFAULT_LOCALE` for the fallback merge), which makes `loadMessages` async and ripples into `getTranslator`, email rendering, and the next-intl request config. Not worth that at two locales; clearly worth it past about four. Revisit when adding one.

## Measure before and after

Cheap and worth it for anything touching the entry, a shared service, or a dependency:

```bash
pnpm build && pnpm exec wrangler deploy --dry-run 2>&1 | grep "Total Upload"
```

For the startup budget, walk the static-import closure from `dist/server/index.js` (skip `import(...)` — those are lazy) and total the bytes. Compare against the same number built from `main`; a regression there is paid by every cold request, including ones that never touch your feature. Real startup time in milliseconds is reported by Cloudflare on deploy.
