import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Plugin } from "vite";

// Serves the OpenAPI document as a virtual module built during the build, so no isolate ever runs
// the Valibot -> JSON Schema conversion at runtime. Regeneration needs no trigger of its own: any
// build, dev server, or test run that imports the module generates it once for that process.
//
// The module exports the document as a *string*, not an object literal: the public route answers
// with those bytes verbatim, and only readers that walk the document pay a parse.

// Kept in sync by hand with the declaration in `virtual-modules.d.ts` — a virtual id has no module
// to import the constant from.
const MODULE_ID = "virtual:api-openapi-document";

const RESOLVED_ID = `\0${MODULE_ID}`;
const GENERATOR = "scripts/generate-openapi.mjs";
// Project-relative sources that can change the document, so a dev server regenerates instead of
// serving a stale one. Much wider than `src/api/`: the generator evaluates the whole API app, so
// routes drag in feature schemas, service code, i18n, and the constants the info block reads.
const DOCUMENT_SOURCES =
  /^(?:cms\.config\.ts|src\/app\/enums\.ts|src\/(?:api|constants|db|i18n|lib|mcp|schemas|types|utils)(?:\.ts$|\/))/;
/** The document is small and generation is ~1s; anything slower means the generator is stuck. */
const GENERATE_TIMEOUT_MS = 60_000;
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;

const run = promisify(execFile);

/**
 * Whether editing this file can change the document. Kept in step with the generator's real import
 * graph by `tools/openapi-document.test.ts`, which walks it and fails on anything not covered.
 */
export function isDocumentSource(projectRelativePath: string): boolean {
  return DOCUMENT_SOURCES.test(projectRelativePath.split(path.sep).join("/"));
}

export function openApiDocument(): Plugin {
  let document: Promise<string> | null = null;

  return {
    name: "api-openapi-document",
    configureServer(server) {
      server.watcher.on("change", (file) => {
        if (!isDocumentSource(path.relative(server.config.root, file))) return;

        document = null;
        for (const environment of Object.values(server.environments)) {
          const module = environment.moduleGraph.getModuleById(RESOLVED_ID);
          if (module) environment.moduleGraph.invalidateModule(module);
        }
      });
    },
    resolveId(id) {
      return id === MODULE_ID ? RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;

      // The generator spawns its own Vite server, so it runs out-of-process: doing it inline would
      // nest a module graph inside this one and inherit these plugins, including this one.
      document ??= run(process.execPath, [GENERATOR], {
        maxBuffer: MAX_DOCUMENT_BYTES,
        timeout: GENERATE_TIMEOUT_MS,
      }).then(({ stdout }) => stdout);

      return `export default ${JSON.stringify(await document)};`;
    },
  };
}
