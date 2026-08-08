import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, test } from "vitest";

import { APP_KV_PREFIXES, OAUTH_RESERVED_KV_PREFIXES } from "@/constants/kv-prefixes";

/**
 * Namespace-shaped literals in the provider bundle that are not KV key spaces: URL schemes, grant
 * type URNs, module specifiers. Adding an entry is the audit — it records "looked, not a key space".
 */
const NON_KV_NAMESPACE_LITERALS = [
  "blob:",
  "cloudflare:",
  "data:",
  "file:",
  "http:",
  "https:",
  "javascript:",
  "mailto:",
  "urn:",
  "vbscript:",
  "workers-oauth-provider:",
] as const;

/** Inline literals at a KV accessor, `list({ prefix })` options, and `*PREFIX*` constants. */
const KV_KEY_LITERAL_PATTERNS = [
  /\.(?:get|put|delete|list)\(\s*[`"']([^`"']*)/g,
  /prefix:\s*[`"']([^`"']*)/g,
  /\w*PREFIX\w*\s*=\s*[`"']([^`"']*)/g,
];
const ANY_NAMESPACE_LITERAL = /[`"']([a-z][a-z0-9-]*):/g;
const NAMESPACE_HEAD = /^([a-z][a-z0-9-]*):/;

// Resolved by package name, never by a versioned path, so a fork's install layout still works.
function readProviderBundle(): string {
  return readFileSync(
    createRequire(import.meta.url).resolve("@cloudflare/workers-oauth-provider"),
    "utf8",
  );
}

function namespaceOf(literal: string): string | null {
  const matched = NAMESPACE_HEAD.exec(literal);

  return matched ? `${matched[1]}:` : null;
}

// `OAUTH_KV` is a second binding onto the namespace the rest of the app already uses, so the
// safety property is entirely about prefix disjointness. Both sides are asserted against the
// registries the key builders themselves consume — a prefix added to app code without a matching
// entry here cannot exist, because there is no second list to fall out of sync with.
describe("OAuth KV prefix reservation", () => {
  const appPrefixes = Object.values(APP_KV_PREFIXES);

  test("no app prefix overlaps a prefix reserved by the OAuth provider", () => {
    for (const appPrefix of appPrefixes) {
      for (const reserved of OAUTH_RESERVED_KV_PREFIXES) {
        expect(appPrefix.startsWith(reserved)).toBe(false);
        expect(reserved.startsWith(appPrefix)).toBe(false);
      }
    }
  });

  // Two app prefixes where one is a prefix of the other would make a `list()` sweep of the shorter
  // one silently enumerate the longer one's keys.
  test("no app prefix is a prefix of another app prefix", () => {
    for (const prefix of appPrefixes) {
      const others = appPrefixes.filter((candidate) => candidate !== prefix);

      expect(others.filter((other) => other.startsWith(prefix))).toEqual([]);
    }
  });

});

// Replaces the manual "re-audit on every upgrade" step: the reserved list is checked against what
// the installed bundle actually reaches for (`client:`, `grant:`, `token:` for OAuth records,
// `enterprise-jti:` for EMA replay markers), so an upgrade that adds a key space fails here.
describe("key spaces the installed OAuth provider actually uses", () => {
  const bundle = readProviderBundle();

  const reviewed = new Set<string>([
    ...OAUTH_RESERVED_KV_PREFIXES,
    ...NON_KV_NAMESPACE_LITERALS,
  ]);

  // Exact both ways on purpose: an unreserved prefix fails, and so does the extraction silently
  // finding nothing because a future bundle stopped matching these shapes.
  test("the reserved list matches the prefixes found at the library's KV call sites", () => {
    const discovered = new Set<string>();
    for (const pattern of KV_KEY_LITERAL_PATTERNS) {
      for (const [, literal] of bundle.matchAll(pattern)) {
        const namespace = namespaceOf(literal);
        if (namespace && !NON_KV_NAMESPACE_LITERALS.includes(namespace as never)) {
          discovered.add(namespace);
        }
      }
    }

    expect([...discovered].sort()).toEqual([...OAUTH_RESERVED_KV_PREFIXES].sort());
  });

  // Recall backstop for a key built in a shape the patterns above miss. A failure means: decide
  // whether the literal is a new key space (reserve it) or not (list it as non-KV).
  test("no unreviewed namespace-shaped literal appears in the bundle", () => {
    const unreviewed = new Set<string>();
    for (const [, namespace] of bundle.matchAll(ANY_NAMESPACE_LITERAL)) {
      if (!reviewed.has(`${namespace}:`)) {
        unreviewed.add(`${namespace}:`);
      }
    }

    expect([...unreviewed].sort()).toEqual([]);
  });
});
