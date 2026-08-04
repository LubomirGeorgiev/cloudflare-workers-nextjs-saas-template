# Keeping the Worker fast: hot path, startup, bundle

Three separate budgets. Know which one your change spends.

| Budget | What spends it | How to check |
| --- | --- | --- |
| **Startup CPU** (1 s limit, raised from 400 ms in Oct 2025) | Modules the entry reaches by *static* import — parsed and evaluated on every cold isolate | `pnpm run check:startup` |
| **Request CPU** | Work inside a handler | Read the handler |
| **Upload size** (3 MiB gzip) | Every module in `dist/`, imported or not | `pnpm build && pnpm exec wrangler deploy --dry-run` |

Uploaded is not the same as evaluated. A 250 KiB chunk behind `await import()` costs upload only, and only on the route that reaches it.

**Why an `import()` is nearly free here.** The build runs `no_bundle: true` with an `ESModule` rule over `**/*.js`, so wrangler uploads every chunk as its own module in the Worker bundle — 639 files today, and `Total Upload` matches the bytes on disk exactly. There is no filesystem and no runtime fetch: `import()` resolves against modules the isolate already holds. What it actually costs is compiling and evaluating that module's top level, once per isolate. That is the whole reason moving a static import to a dynamic one shifts cost off the startup budget instead of merely relocating a download.

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

**Metadata routes are startup cost.** Pages, route handlers, and server actions are reached through `import()` in the built Worker, so their closures cost upload only. Vinext registers `sitemap.ts` and `robots.ts` as *static* imports in the entry's route table — the one exception. A body left in `sitemap.ts` put the CMS repositories and the whole Drizzle schema on every cold isolate, health checks included. Keep those files thin and `await import()` the work, as `src/app/sitemap.ts` does with `build-sitemap.ts`; `robots.ts` reads one constant and is fine as-is.

**A request-scoped helper on the entry's graph drags its whole tail.** `src/proxy.ts` runs on nearly every path, so next-intl's request config sits on the startup graph with it. That config reaching `getCurrentSession` statically was enough to put the session/D1 layer — the entire schema — on every cold isolate, for requests that never read a session. When a module the entry reaches only *might* need an expensive dependency, the `import()` goes at the point of need, not the top of the file.

**Precompute anything deterministic at build time.** The OpenAPI document is built by `scripts/generate-openapi.mjs` and served as a virtual module (`tools/openapi-document.ts`), so no isolate runs the Valibot→JSON Schema conversion. If a value depends only on static schemas and build-time constants, it does not belong in a runtime memo.

**Memoize per isolate what you cannot precompute, at module scope, lazily.** For synchronous work, `let x: T | null = null; x ??= build()` — compiled schema validators in `src/mcp/index.ts` work this way, since the MCP transport is stateless and every JSON-RPC POST would otherwise recompile every tool schema. For async work, `lazyValue`/`lazyValueByKey` from `src/utils/lazy-value.ts` rather than a hand-rolled `let`/`Map`: they cache the in-flight promise so concurrent callers on a cold isolate share one evaluation, and drop it on rejection so a transient failure cannot disable a code path for the life of the isolate. Read that file's header before reaching for either — a promise that touches KV, D1, R2, or a request-scoped `fetch` must not be memoized at all, because it belongs to the request that created it.

**Serve prebuilt bytes.** A route that answers with a fixed payload should ship the serialized string, not an object it re-serializes per request — `c.json(bigObject)` is JSON.stringify on every hit. `openapi.json` returns the generated document verbatim for this reason, and the parsed form is a separate lazy export so requests that never read it skip building the objects at all.

**Route a constant answer past the app that would build itself to serve it.** The entry answers `openapi.json` from `src/api/generated-document` directly: reaching it through the Hono app evaluated 27 modules and 332 KiB — every router and the services behind them, Stripe included — to hand back bytes that were already on disk. The app keeps its own route; that is the contract when it is mounted directly, and the integration tests exercise it there. A fast path that mirrors a route is a contract in two places, so keep the two from drifting: both answer with the same `apiDocumentResponse()` producer, both serve exactly `API_OPENAPI_SPEC_METHODS`, and every other method falls through to the auth chain the route sits behind.

**Per-locale data loads per locale.** `src/i18n/message-catalogs.ts` holds one `import()` per locale behind `loadCatalog`, which is `lazyValueByKey` — one entry per locale, so serving `es` never evaluates `en`'s catalog unless the fallback merge asks for it. A static catalog import is ~66 KiB evaluated on every cold isolate whether or not that language is ever served. Adding a locale adds a line there and costs the startup budget nothing.

**Never `import()` inside a per-request loop.** Hoist it to the handler.

## Measure before and after

Cheap and worth it for anything touching the entry, a shared service, or a dependency:

```bash
pnpm build && pnpm exec wrangler deploy --dry-run 2>&1 | grep "Total Upload"
```

For the startup budget, `pnpm run check:startup` builds the Worker, evaluates it once locally, and reports bundle size alongside the time the isolate spent active, idle, and in GC:

```
Bundle: 6326.88 KiB / gzip: 1587.13 KiB
Local startup profile:
  Profile window: 157.2 ms
  Sampled time: 150.1 ms
  Active: 25.1 ms (including 2.5 ms garbage collection)
  Idle: 125.0 ms
  Samples: 21
```

Of those, only `Active` is CPU actually burned evaluating modules, which is what the 1 s startup limit measures. But at ~25 ms the sampler collects about 20 samples at ~1.3 ms each, so run-to-run noise is larger than most single changes: a rewrite that provably removed 200 KiB from the graph read *slower* on one run. Treat `Active` as a trend over many runs, never as the before/after for one change. The run also writes `worker-startup.cpuprofile`; open it in Chrome DevTools or VS Code to see *which* module paid.

Its `Bundle:` line is wrangler bundling the built Worker itself, so it does not match `Total Upload` from a deploy. Compare each against its own history, never against the other.

**Attribute with the closure, not the clock.** Walk the static-import graph from `dist/server/index.js`, following relative `from "..."` and skipping `import(...)`, and total the bytes. It is deterministic, it moves the moment a chain changes, and each chunk's `.js.map` names the source files inside it — which is how you find *what* joined the graph. A regression there is paid by every cold request, including ones that never touch your feature.

`tools/startup-import-closure.test.ts` runs that same walk over the sources on every unit run, with no build: it declares the exact closure of each startup entry (`worker-entrypoint.ts`, `src/proxy.ts`, `src/i18n/request.ts`, `sitemap.ts`, `robots.ts`) and fails on anything new. Every `await import()` above is load-bearing, and the timing numbers are too noisy to notice when one quietly turns back into a static import. Adding a module to a closure list is how a change says every cold isolate should now evaluate it — do that deliberately, not to make the test green.

## History

Every deploy appends one row to `metrics/*-deploy-size-history.jsonl` via `scripts/record-metrics.mjs`: upload sizes at the top level, plus the startup profile above under `startup*` keys when profiling succeeded (sizes in bytes, timings in ms). CI runners are noisy — read the trend, not one row, and profile locally to find the cause.

`pnpm metrics:report` renders that history to `metrics/*-metrics-report.html` — a self-contained page with size, per-deploy change, biggest-mover, cadence, and startup charts. Drag across a time chart to zoom every chart to that window; hovering a point names the commit.
