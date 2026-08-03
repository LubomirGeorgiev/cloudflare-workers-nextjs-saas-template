// Generates the OpenAPI document at build time so no isolate ever pays the Valibot -> JSON Schema
// conversion at runtime. The document is deterministic: every input is a static schema or a
// build-time constant, so generating it here produces exactly what the app would have produced.
//
// The API app is imported outside workerd, which cannot provide `cloudflare:workers`. Only module
// evaluation happens here — no handler runs — so the stubs in ./utils are enough.
//
// Prints the document to stdout as JSON, or the reason it refused to stderr with a non-zero exit.
// Consumed by the vite plugin in tools/, and runnable by hand (`node scripts/generate-openapi.mjs`)
// when you want to eyeball the output.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

async function generate() {
  const server = await createServer({
    root,
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
    const [{ apiApp }, { openApiGeneratorOptions }, { deriveMcpTools }, { generateSpecs }] =
      await Promise.all([
        server.ssrLoadModule("/src/api/index.ts"),
        server.ssrLoadModule("/src/api/openapi.ts"),
        server.ssrLoadModule("/src/mcp/derive-tools.ts"),
        import("hono-openapi"),
      ]);

    const document = await generateSpecs(apiApp, openApiGeneratorOptions());

    // Derivation is the one step that can reject a document this generator happily produced (two
    // arguments flattened onto one name), so run and discard it here: a collision fails the build
    // rather than every agent calling the tool.
    deriveMcpTools({ document });

    return document;
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
