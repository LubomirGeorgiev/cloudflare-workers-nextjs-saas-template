import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

// `src/lib/**` and `src/utils/**` are shared by two runtimes: the App Router (pages, server
// actions) and the plain Worker handlers behind `/api/v1` and `/mcp`. Only the first has a
// request scope, so `next-intl/server` there resolves to next-intl's client build and throws
// "`getTranslations` is not supported in Client Components" — a 500 an agent cannot diagnose.
// Shared services must use `getTranslator` from `@/i18n/translator`, which needs no request.
//
// `next/headers` is deliberately not part of this rule: `cookies()`/`headers()` are legitimate
// there when guarded by an ALS-principal check first (see `getUserLocale`, `getCurrentSession`).
const SCANNED_DIRS = ["lib", "utils"];

// Modules that only ever run inside the App Router, where the request scope is guaranteed.
const REQUEST_SCOPED_MODULES = [
  // The server-action boundary itself; the API never routes through it.
  "lib/safe-action.ts",
  // Page-level `generateMetadata` helpers.
  "utils/i18n-metadata.ts",
  // Wraps next/navigation's `redirect`, so it is App Router-only by construction.
  "utils/auth-redirect.ts",
];

const SRC_DIR = fileURLToPath(new URL("../..", import.meta.url));

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    if (!/\.tsx?$/.test(entry.name)) {
      return [];
    }
    if (/\.(test|d)\.tsx?$/.test(entry.name)) {
      return [];
    }
    return [fullPath];
  });
}

test("shared services never import next-intl/server", () => {
  const offenders = SCANNED_DIRS.flatMap((dir) => listSourceFiles(path.join(SRC_DIR, dir)))
    .map((file) => ({ file, relative: path.relative(SRC_DIR, file) }))
    .filter(({ relative }) => !REQUEST_SCOPED_MODULES.includes(relative.split(path.sep).join("/")))
    .filter(({ file }) => /from\s+["']next-intl\/server["']/.test(readFileSync(file, "utf8")))
    .map(({ relative }) => relative);

  expect(offenders).toEqual([]);
});
