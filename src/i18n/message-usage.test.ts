import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE } from "./config";

// Guards the reverse direction of the typecheck: TypeScript (via next-intl.d.ts)
// proves every t("key") exists in the catalog, but nothing proves every catalog
// key is still referenced. This test scans src/ for translator usage and fails
// on orphaned keys so deleted features don't leave dead copy behind.
//
// The scan is lexical, not type-aware, and errs conservative: a translator that
// escapes static analysis (dynamic key, passed as a value) marks its whole
// namespace as used. A key reported unused here is safe to delete everywhere.

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

const TRANSLATOR_FACTORIES = ["useTranslations", "getTranslations", "createTranslator"];

function keyPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|d)\.tsx?$/.test(entry.name)) return [];
    return [fullPath];
  });
}

// Contents of the balanced (...) group starting at `openParen`.
function parenGroup(text: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(openParen + 1, i);
  }
  return text.slice(openParen + 1);
}

interface TranslatorBinding {
  name: string | null;
  namespace: string;
}

// Find translator bindings: `const t = useTranslations("Ns")`,
// `const t = await getTranslations({ locale, namespace: "Ns" })`,
// `t: createTranslator({ ..., namespace: "Ns" })`, or unbound inline calls.
function findBindings(content: string): TranslatorBinding[] {
  const bindingRe = new RegExp(
    String.raw`(?:\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?|\b(\w+)\s*:\s*)?\b(?:${TRANSLATOR_FACTORIES.join("|")})\s*\(`,
    "g",
  );
  const bindings: TranslatorBinding[] = [];
  for (const match of content.matchAll(bindingRe)) {
    const args = parenGroup(content, match.index + match[0].length - 1).trim();
    let namespace = "";
    if (args.startsWith('"') || args.startsWith("'")) {
      namespace = args.slice(1, args.indexOf(args[0], 1));
    } else {
      namespace = /\bnamespace\s*:\s*["']([^"']+)["']/.exec(args)?.[1] ?? "";
    }
    bindings.push({ name: match[1] ?? match[2] ?? null, namespace });
  }
  return bindings;
}

interface UsageCollector {
  // Exact keys (and their subtrees, for `t.raw` object reads).
  paths: Set<string>;
  // Prefixes from template-literal keys and escaped/dynamic translators.
  prefixes: Set<string>;
}

function markNamespace(namespace: string, usage: UsageCollector): void {
  // Never wildcard the root namespace: an escaped root translator (e.g. the
  // ActionError bridge in safe-action.ts) would mark the entire catalog used
  // and make this test vacuous. Its runtime keys are full catalog paths that
  // appear as string literals at throw sites, which the literal pass catches.
  if (namespace) usage.prefixes.add(`${namespace}.`);
}

// Classify every occurrence of one translator variable in a file and record
// which keys under `namespaces` it can reach.
function collectVariableUsage(
  { content, name, namespaces, usage }: {
    content: string;
    name: string;
    namespaces: string[];
    usage: UsageCollector;
  },
): void {
  const markKey = (key: string) => {
    for (const ns of namespaces) usage.paths.add(ns ? `${ns}.${key}` : key);
  };
  const markAll = () => {
    for (const ns of namespaces) markNamespace(ns, usage);
  };
  const markPrefix = (prefix: string) => {
    for (const ns of namespaces) {
      if (ns || prefix) usage.prefixes.add(ns ? `${ns}.${prefix}` : prefix);
      else markNamespace(ns, usage);
    }
  };

  for (const occurrence of content.matchAll(new RegExp(String.raw`\b${name}\b`, "g"))) {
    if (content[occurrence.index - 1] === ".") continue; // property access on another object
    let rest = content.slice(occurrence.index + name.length);
    const method = /^\s*\.\s*(?:rich|markup|raw|has)\s*\(/.exec(rest);
    if (method) rest = rest.slice(method[0].length - 1);
    if (method || /^\s*\(/.test(rest)) {
      const arg = parenGroup(rest, rest.indexOf("(")).trim();
      if (arg.startsWith('"') || arg.startsWith("'")) {
        const literal = arg.slice(1, arg.indexOf(arg[0], 1));
        // Concatenated key like t("errors." + code): the literal is a prefix, not a full path.
        if (literal.endsWith(".")) markPrefix(literal);
        else markKey(literal);
      } else if (arg.startsWith("`")) {
        // Template key: everything before the first interpolation is a stable prefix.
        const literalPrefix = arg.slice(1, arg.includes("${") ? arg.indexOf("${") : arg.indexOf("`", 1));
        markPrefix(literalPrefix);
      } else {
        markAll(); // fully dynamic key
      }
    } else if (/^\s*(=[^=]|:)/.test(rest)) {
      // The binding site itself (`const t =` / `t:`), not a usage.
    } else {
      // Translator escapes as a value (passed to a helper, returned, cast):
      // we can no longer see its keys, so treat its namespaces as fully used.
      markAll();
    }
  }
}

function collectFileUsage(content: string, usage: UsageCollector): void {
  const byName = new Map<string, string[]>();
  for (const binding of findBindings(content)) {
    if (binding.name === null) {
      // Inline call whose translator is never bound (or a mention in a comment):
      // no variable to trace, so conservatively mark the namespace used.
      markNamespace(binding.namespace, usage);
    } else {
      // Reuse of one variable name across scopes (e.g. `t` in generateMetadata
      // and in the component) can't be told apart lexically; attribute every
      // usage to all namespaces bound under that name in this file.
      byName.set(binding.name, [...(byName.get(binding.name) ?? []), binding.namespace]);
    }
  }
  for (const [name, namespaces] of byName) {
    collectVariableUsage({ content, name, namespaces, usage });
  }
}

// Runtime-built keys (ActionError messageKeys, validation wire format) originate
// as full dotted catalog paths in string literals; count those as usage too.
function collectLiteralPathUsage(content: string, catalogKeys: Set<string>, usage: UsageCollector): void {
  for (const match of content.matchAll(/["'`]([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)["'`]/g)) {
    if (catalogKeys.has(match[1])) usage.paths.add(match[1]);
  }
}

describe("message catalog usage", () => {
  const catalog: unknown = JSON.parse(
    readFileSync(path.join(SRC_DIR, "i18n", "messages", `${DEFAULT_LOCALE}.json`), "utf-8"),
  );
  const catalogKeys = keyPaths(catalog);
  const catalogKeySet = new Set(catalogKeys);
  const sourceFiles = listSourceFiles(SRC_DIR);

  const usage: UsageCollector = { paths: new Set(), prefixes: new Set() };
  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf-8");
    collectFileUsage(content, usage);
    collectLiteralPathUsage(content, catalogKeySet, usage);
  }

  test("scanner sees the source tree and stays non-vacuous", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(usage.paths.size + usage.prefixes.size).toBeGreaterThan(0);
    // A root wildcard would mark every key used and silently disable the test.
    expect(usage.prefixes.has("")).toBe(false);
  });

  test(`every key in ${DEFAULT_LOCALE}.json is referenced from src/`, () => {
    const prefixes = [...usage.prefixes];
    const unusedKeys = catalogKeys.filter(
      (key) =>
        !usage.paths.has(key) &&
        ![...usage.paths].some((used) => key.startsWith(`${used}.`)) &&
        !prefixes.some((prefix) => key.startsWith(prefix)),
    );

    const failure = unusedKeys.length
      ? `Unused message keys — delete them from every catalog in src/i18n/messages/, ` +
        `or reference them via a translator this scan can see:\n${unusedKeys.join("\n")}`
      : "";
    expect(failure).toBe("");
  });
});
