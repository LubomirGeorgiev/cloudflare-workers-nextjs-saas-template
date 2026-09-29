import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "@typescript/typescript6";
import { describe, expect, test } from "vitest";

import { INTEGRATION_OPTIMIZED_DEPENDENCIES } from "./integration-optimized-dependencies";

// An unlisted subpath of a pre-bundled package still passes every test, while the code under test
// holds two copies of the package. So fail on the import itself, before anything depends on it.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED_PATHS = ["src", "tests/integration", "worker-entrypoint.ts", "cms.config.ts"];
const SOURCE_FILE = /\.(?:ts|tsx|mts|mjs|js)$/;

describe("integration optimized dependencies", () => {
  test("list every subpath the code imports from a pre-bundled package", () => {
    const optimizedPackages = new Set(INTEGRATION_OPTIMIZED_DEPENDENCIES.map(packageName));
    const unlisted = new Set<string>();

    for (const file of SCANNED_PATHS.flatMap((scanned) => sourceFiles(path.join(ROOT, scanned)))) {
      const { importedFiles } = ts.preProcessFile(fs.readFileSync(file, "utf8"), true, true);

      for (const { fileName: specifier } of importedFiles) {
        if (
          optimizedPackages.has(packageName(specifier))
          && !INTEGRATION_OPTIMIZED_DEPENDENCIES.includes(specifier)
        ) {
          unlisted.add(`${specifier} (${path.relative(ROOT, file)})`);
        }
      }
    }

    expect([...unlisted]).toEqual([]);
  });
});

function packageName(specifier: string): string {
  const segments = specifier.split("/");

  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0] ?? specifier;
}

function sourceFiles(target: string): string[] {
  if (!fs.statSync(target).isDirectory()) {
    return [target];
  }

  return fs
    .readdirSync(target, { recursive: true, encoding: "utf8" })
    .filter((entry) => SOURCE_FILE.test(entry))
    .map((entry) => path.join(target, entry));
}
