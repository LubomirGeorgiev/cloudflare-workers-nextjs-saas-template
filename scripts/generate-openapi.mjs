// Generates the OpenAPI document at build time so no isolate ever pays the Valibot -> JSON Schema
// conversion at runtime. The document is deterministic: every input is a static schema or a
// build-time constant, so generating it here produces exactly what the app would have produced.
//
// The API app is imported outside workerd, which cannot provide `cloudflare:workers`. Only module
// evaluation happens here — no handler runs — so the stubs in ./utils are enough.
//
// Prints BOTH documents to stdout as one JSON envelope, `{"public": {...}, "admin": {...}}`, or the
// reason it refused to stderr with a non-zero exit. One process for two documents because each run
// spawns its own Vite server and evaluates the whole service layer; the plugin in tools/ splits the
// envelope into two virtual modules. Runnable by hand (`node scripts/generate-openapi.mjs`) when
// you want to eyeball the output.
//
// The public half is asserted to contain no trace of the internal surface before it is printed.
// That check lives here, at the one point both documents exist in the same process, because this
// is where a leak would actually be introduced — a route mounted on the wrong app, or an admin
// scope added to the public catalog.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const openApiViteCacheDir = path.join(root, "node_modules/.vite-openapi", String(process.pid));

/**
 * Fails the build if anything internal reached the published document. Cheap and total: the whole
 * document is serialized once and searched for each admin scope name and for the admin base path,
 * so a leak through any key — a path, a `security` requirement, a scope map, a description, an
 * example — is caught, not just the shapes this check knows to look at.
 */
function assertPublicDocumentIsClean({ document, adminScopeNames, adminBasePath }) {
  const serialized = JSON.stringify(document);
  const leaked = [...adminScopeNames, adminBasePath].filter((needle) => serialized.includes(needle));

  if (leaked.length > 0) {
    throw new Error(
      `The published OpenAPI document contains internal identifiers: ${leaked.join(", ")}. ` +
        "An admin route must be mounted on `adminApiApp` (src/api/admin/index.ts) with " +
        "`adminOperation`, and an admin scope must stay in `ADMIN_SCOPES`, never `API_SCOPES`.",
    );
  }
}

async function generate() {
  const server = await createServer({
    root,
    cacheDir: openApiViteCacheDir,
    configFile: false,
    logLevel: "error",
    resolve: {
      alias: [
        { find: /^@\//, replacement: `${root}/src/` },
        { find: "cloudflare:workers", replacement: path.join(here, "utils/workers-runtime-stub.mjs") },
        { find: /^server-only$/, replacement: path.join(here, "utils/noop-module.mjs") },
      ],
    },
  });

  try {
    const [
      { apiApp },
      { openApiGeneratorOptions },
      { adminApiApp },
      { adminOpenApiGeneratorOptions },
      { ADMIN_SCOPE_NAMES },
      { ADMIN_API_BASE_PATH },
      { deriveMcpTools },
      { generateSpecs },
    ] = await Promise.all([
      server.ssrLoadModule("/src/api/index.ts"),
      server.ssrLoadModule("/src/api/openapi.ts"),
      server.ssrLoadModule("/src/api/admin/index.ts"),
      server.ssrLoadModule("/src/api/admin/openapi.ts"),
      server.ssrLoadModule("/src/lib/api/admin-scopes.ts"),
      server.ssrLoadModule("/src/constants.ts"),
      server.ssrLoadModule("/src/mcp/derive-tools.ts"),
      import("hono-openapi"),
    ]);

    const [publicDocument, adminDocument] = await Promise.all([
      generateSpecs(apiApp, openApiGeneratorOptions()),
      generateSpecs(adminApiApp, adminOpenApiGeneratorOptions()),
    ]);

    assertPublicDocumentIsClean({
      document: publicDocument,
      adminScopeNames: ADMIN_SCOPE_NAMES,
      adminBasePath: ADMIN_API_BASE_PATH,
    });

    // Derivation is the one step that can reject a document this generator happily produced (two
    // arguments flattened onto one name), so run and discard it here: a collision fails the build
    // rather than every agent calling the tool. Both surfaces derive tools, so both are checked.
    deriveMcpTools({ document: publicDocument });
    deriveMcpTools({ document: adminDocument });

    return { public: publicDocument, admin: adminDocument };
  } finally {
    await server.close();
  }
}

try {
  process.stdout.write(JSON.stringify(await generate()));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
