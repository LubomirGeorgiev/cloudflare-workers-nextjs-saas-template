import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "@typescript/typescript6";
import { describe, expect, test } from "vitest";

import { isDocumentSource } from "./openapi-document";

// A dependency the watcher misses leaves `pnpm dev` serving a stale openapi.json, docs page, and
// MCP tool surface until restart. So walk the generator's real import graph and fail on anything
// the matcher does not cover — including dependencies added long after this was written.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = "scripts/generate-openapi.mjs";
/** Order matters: a bare directory must resolve to its index, not to a sibling file. */
const RESOLUTION_SUFFIXES = ["", ".ts", ".tsx", ".mjs", ".js", ".json", "/index.ts", "/index.tsx"];

/** The modules the generator loads by path; a new one is picked up without touching this test. */
function generatorEntryPoints(): string[] {
  const source = fs.readFileSync(path.join(ROOT, GENERATOR), "utf8");

  return [...source.matchAll(/ssrLoadModule\(\s*["']([^"']+)["']/g)].map(([, id]) =>
    path.join(ROOT, id),
  );
}

/** Mirrors the generator's `@/` alias; bare specifiers are packages and cannot be watched. */
function resolveImport({
  specifier,
  importer,
}: {
  specifier: string;
  importer: string;
}): string | null {
  let target: string;

  if (specifier.startsWith("@/")) target = path.join(ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) target = path.resolve(path.dirname(importer), specifier);
  else return null;

  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = `${target}${suffix}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }

  return null;
}

// Static over-approximation of what the generator evaluates: dynamic imports and type-only imports
// come along too, which only makes the assertion stricter.
function documentImportGraph(): string[] {
  const seen = new Set<string>();
  const queue = generatorEntryPoints();

  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;

    seen.add(file);
    if (file.endsWith(".json")) continue;

    const { importedFiles } = ts.preProcessFile(fs.readFileSync(file, "utf8"), true, true);
    for (const { fileName } of importedFiles) {
      const resolved = resolveImport({ specifier: fileName, importer: file });
      if (resolved) queue.push(resolved);
    }
  }

  return [...seen].map((file) => path.relative(ROOT, file)).sort();
}

describe("openapi document invalidation", () => {
  const graph = documentImportGraph();

  test("walks a real graph rather than passing vacuously", () => {
    expect(graph.length).toBeGreaterThan(20);
    expect(graph).toContain("src/constants.ts");
    expect(graph.some((file) => file.startsWith("src/schemas/"))).toBe(true);
  });

  test("watches every source the generated document depends on", () => {
    expect(graph.filter((file) => !isDocumentSource(file))).toEqual([]);
  });

  test("leaves files outside the dependency set alone", () => {
    expect(isDocumentSource("src/components/ui/button.tsx")).toBe(false);
    expect(isDocumentSource("README.md")).toBe(false);
  });
});
