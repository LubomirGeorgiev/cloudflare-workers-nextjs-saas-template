import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

import { PREGENERATED_OPENAPI_ENV, runOpenApiGenerator } from "../scripts/utils/openapi-generator.mjs";

// Serves the OpenAPI document as a virtual module built during the build, so no isolate ever runs
// the Valibot -> JSON Schema conversion at runtime. Regeneration needs no trigger of its own: any
// build, dev server, or test run that imports the module generates it once for that process.
//
// The module exports the document as a *string*, not an object literal: the public route answers
// with those bytes verbatim, and only readers that walk the document pay a parse.

// Kept in sync by hand with the declarations in `virtual-modules.d.ts` — a virtual id has no module
// to import the constant from.
//
// Two modules, one generator run. The generator evaluates the whole service layer in its own Vite
// server, so producing the internal document in a second spawn would double the cost of every build
// and every dev-server invalidation for a document that is derived from the same module graph.
const MODULE_IDS = {
  "virtual:api-openapi-document": "public",
  "virtual:admin-openapi-document": "admin",
} as const;

type DocumentHalf = (typeof MODULE_IDS)[keyof typeof MODULE_IDS];

const RESOLVED_PREFIX = "\0";

function resolvedId(moduleId: string): string {
  return `${RESOLVED_PREFIX}${moduleId}`;
}

function halfForResolvedId(id: string): DocumentHalf | null {
  if (!id.startsWith(RESOLVED_PREFIX)) {
    return null;
  }

  return MODULE_IDS[id.slice(RESOLVED_PREFIX.length) as keyof typeof MODULE_IDS] ?? null;
}
// Project-relative sources that can change the document, so a dev server regenerates instead of
// serving a stale one. Much wider than `src/api/`: the generator evaluates the whole API app, so
// routes drag in feature schemas, service code, i18n, and the constants the info block reads.
// `src/app/enums.ts` is here because schemas read it; the test below walks the graph and fails when
// that set changes.
const DOCUMENT_SOURCES =
  /^(?:cms\.config\.ts|src\/app\/enums\.ts|src\/(?:api|constants|db|i18n|lib|mcp|schemas|types|utils)(?:\.ts$|\/))/;
/**
 * Whether editing this file can change the document. Kept in step with the generator's real import
 * graph by `tools/openapi-document.test.ts`, which walks it and fails on anything not covered.
 */
export function isDocumentSource(projectRelativePath: string): boolean {
  return DOCUMENT_SOURCES.test(projectRelativePath.split(path.sep).join("/"));
}

/** The generator's stdout envelope, split into the JSON text each virtual module exports. */
type DocumentTexts = Record<DocumentHalf, string>;

export function openApiDocument(): Plugin {
  let documents: Promise<DocumentTexts> | null = null;
  // The runner wrote the file before this process started, so a source edit makes it stale.
  let pregeneratedFile = process.env[PREGENERATED_OPENAPI_ENV];

  return {
    name: "api-openapi-document",
    configureServer(server) {
      server.watcher.on("change", (file) => {
        if (!isDocumentSource(path.relative(server.config.root, file))) return;

        documents = null;
        pregeneratedFile = undefined;
        for (const environment of Object.values(server.environments)) {
          for (const moduleId of Object.keys(MODULE_IDS)) {
            const module = environment.moduleGraph.getModuleById(resolvedId(moduleId));
            if (module) environment.moduleGraph.invalidateModule(module);
          }
        }
      });
    },
    resolveId(id) {
      return id in MODULE_IDS ? resolvedId(id) : null;
    },
    async load(id) {
      const half = halfForResolvedId(id);
      if (!half) return null;

      // The generator spawns its own Vite server, so it runs out-of-process: doing it inline would
      // nest a module graph inside this one and inherit these plugins, including this one.
      documents ??= (pregeneratedFile ? readFile(pregeneratedFile, "utf8") : runOpenApiGenerator()).then((stdout) => {
        const envelope = JSON.parse(stdout) as Record<DocumentHalf, unknown>;

        // Re-serialized per half rather than sliced out of `stdout`: each module exports the exact
        // bytes its route answers with, and `JSON.stringify` is what makes those bytes canonical.
        return {
          public: JSON.stringify(envelope.public),
          admin: JSON.stringify(envelope.admin),
        };
      });

      return `export default ${JSON.stringify((await documents)[half])};`;
    },
  };
}
