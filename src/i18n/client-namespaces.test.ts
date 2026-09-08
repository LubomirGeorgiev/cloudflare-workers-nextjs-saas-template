import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { CLIENT_MESSAGE_SCOPES } from "./client-namespaces";

// Proves the per-route-group `NextIntlClientProvider` lists in `client-namespaces.ts` match what the
// source tree actually reads. A nested provider REPLACES its parent's messages, so a namespace a
// scope forgets renders its raw key path in the browser — and a namespace it keeps but no longer
// needs ships dead copy in every RSC payload for that group.
//
// The scan walks the import graph from each scope's entry paths, which over-approximates (it follows
// type-only and server-side imports too). That is deliberate: it can only ever ask a provider for
// more than it needs, never less.

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

// `@/x` resolves to `src/x`; every other bare specifier is a package, which carries no namespaces.
const ALIAS_PREFIX = "@/";

// Static, dynamic, re-export, and side-effect import forms.
const IMPORT_PATTERN =
  /(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;
const USE_TRANSLATIONS_PATTERN = /useTranslations\(\s*["']([^"']+)["']/g;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    if (!/\.(tsx?|jsx?)$/.test(entry.name) || /\.(test|spec|d)\.(tsx?|jsx?)$/.test(entry.name)) {
      return [];
    }
    return [fullPath];
  });
}

function resolveImport({ specifier, fromFile }: { specifier: string; fromFile: string }): string | null {
  let base: string;
  if (specifier.startsWith(ALIAS_PREFIX)) {
    base = path.join(SRC_DIR, specifier.slice(ALIAS_PREFIX.length));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  for (const extension of ["", ...MODULE_EXTENSIONS]) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  for (const extension of MODULE_EXTENSIONS) {
    const candidate = path.join(base, `index${extension}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

interface FileFacts {
  imports: string[];
  namespaces: string[];
}

const factsByFile = new Map<string, FileFacts>();

function readFacts(file: string): FileFacts {
  const cached = factsByFile.get(file);
  if (cached) {
    return cached;
  }

  const content = readFileSync(file, "utf-8");
  const imports: string[] = [];
  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const resolved = resolveImport({ specifier: match[1] ?? match[2] ?? match[3], fromFile: file });
    if (resolved) {
      imports.push(resolved);
    }
  }
  const namespaces = [...content.matchAll(USE_TRANSLATIONS_PATTERN)]
    .map((match) => match[1])
    .filter((namespace) => namespace.startsWith("Client."))
    .map((namespace) => namespace.slice("Client.".length));

  const facts: FileFacts = { imports, namespaces };
  factsByFile.set(file, facts);
  return facts;
}

/** Every module reachable from `entries`, the entries included. */
function reachableFiles(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const pending = [...entries];

  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    for (const imported of readFacts(file).imports) {
      if (!seen.has(imported)) {
        pending.push(imported);
      }
    }
  }

  return seen;
}

const scopeNames = Object.keys(CLIENT_MESSAGE_SCOPES) as Array<keyof typeof CLIENT_MESSAGE_SCOPES>;
const scopeDirectories = scopeNames.flatMap((name) =>
  CLIENT_MESSAGE_SCOPES[name].entryPaths
    .map((entryPath) => path.join(SRC_DIR, entryPath))
    .filter((absolute) => existsSync(absolute) && statSync(absolute).isDirectory()),
);

// A file belongs to the innermost scope that contains it: `(marketing)/docs` owns its own provider,
// so its files are not entries of the `(marketing)` one.
function entryFilesFor(scopeName: keyof typeof CLIENT_MESSAGE_SCOPES): string[] {
  return CLIENT_MESSAGE_SCOPES[scopeName].entryPaths.flatMap((entryPath) => {
    const absolute = path.join(SRC_DIR, entryPath);
    if (!existsSync(absolute)) {
      return [];
    }
    if (!statSync(absolute).isDirectory()) {
      return [absolute];
    }
    return listSourceFiles(absolute).filter(
      (file) =>
        !scopeDirectories.some(
          (directory) =>
            directory.length > absolute.length && file.startsWith(`${directory}${path.sep}`),
        ),
    );
  });
}

function usedNamespaces(scopeName: keyof typeof CLIENT_MESSAGE_SCOPES): string[] {
  const used = new Set<string>();
  for (const file of reachableFiles(entryFilesFor(scopeName))) {
    for (const namespace of readFacts(file).namespaces) {
      used.add(namespace);
    }
  }
  return [...used].sort();
}

/** A declared parent path (e.g. "Sidebar") also supplies every namespace below it. */
function isCoveredBy({ declared, namespace }: { declared: readonly string[]; namespace: string }) {
  return declared.some((entry) => entry === namespace || namespace.startsWith(`${entry}.`));
}

describe("client message scopes", () => {
  test("every scope resolves to source files", () => {
    for (const scopeName of scopeNames) {
      expect(entryFilesFor(scopeName).length, `scope "${scopeName}" matched no files`).toBeGreaterThan(0);
    }
  });

  test.each(scopeNames)("the %s provider supplies every namespace its subtree reads", (scopeName) => {
    const declared = CLIENT_MESSAGE_SCOPES[scopeName].namespaces;
    const missing = usedNamespaces(scopeName).filter(
      (namespace) => !isCoveredBy({ declared, namespace }),
    );

    const failure = missing.length
      ? `Add these to CLIENT_MESSAGE_SCOPES.${scopeName}.namespaces in src/i18n/client-namespaces.ts, ` +
        `or the copy renders as raw key paths:\n${missing.join("\n")}`
      : "";
    expect(failure).toBe("");
  });

  test.each(scopeNames)("the %s provider supplies nothing its subtree stopped reading", (scopeName) => {
    const used = usedNamespaces(scopeName);
    const unused = CLIENT_MESSAGE_SCOPES[scopeName].namespaces.filter(
      (declared) => !used.some((namespace) => isCoveredBy({ declared: [declared], namespace })),
    );

    const failure = unused.length
      ? `Remove these from CLIENT_MESSAGE_SCOPES.${scopeName}.namespaces in src/i18n/client-namespaces.ts; ` +
        `they ship in every RSC payload for this group and nothing reads them:\n${unused.join("\n")}`
      : "";
    expect(failure).toBe("");
  });

  // Without this a client component added outside every scope would silently render raw key paths:
  // no provider names its namespace, and the per-scope checks above would never see the file.
  test("every useTranslations call site sits under a scope", () => {
    const covered = new Set(scopeNames.flatMap((scopeName) => [...reachableFiles(entryFilesFor(scopeName))]));
    const orphans = listSourceFiles(SRC_DIR)
      .filter((file) => !covered.has(file) && readFacts(file).namespaces.length > 0)
      .map((file) => path.relative(SRC_DIR, file));

    const failure = orphans.length
      ? `No client message scope reaches these files, so no provider supplies their namespaces — ` +
        `add the route group to CLIENT_MESSAGE_SCOPES:\n${orphans.join("\n")}`
      : "";
    expect(failure).toBe("");
  });
});
