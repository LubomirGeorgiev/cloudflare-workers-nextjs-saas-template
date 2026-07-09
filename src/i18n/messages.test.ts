import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE, LOCALES } from "./config";

function keyPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

// Flatten to [dotted-path, string] pairs for the value-level checks (placeholders, empties).
function stringLeaves(obj: unknown, prefix = ""): Array<[string, string]> {
  if (typeof obj === "string") return [[prefix, obj]];
  if (obj === null || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    stringLeaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

// Collect ICU argument names from a message: simple `{name}`, typed `{price, number}`, and the argument of
// `{count, plural, ...}` / `{sel, select, ...}`. We brace-walk instead of regex-matching `{word}` because a
// sub-message body like `other {Yes}` is literal text, not an argument — a naive regex would wrongly report `Yes` as a placeholder.
function icuPlaceholders(message: string): Set<string> {
  const args = new Set<string>();
  collectArgs(message, args);
  return args;
}

function collectArgs(message: string, out: Set<string>): void {
  for (const inner of topLevelGroups(message)) {
    const commaIndex = inner.indexOf(",");
    const name = (commaIndex === -1 ? inner : inner.slice(0, commaIndex)).trim();
    if (/^[a-zA-Z0-9_]+$/.test(name)) out.add(name);
    if (commaIndex === -1) continue;

    const rest = inner.slice(commaIndex + 1);
    const typeEnd = rest.indexOf(",");
    const type = (typeEnd === -1 ? rest : rest.slice(0, typeEnd)).trim();
    // For plural/select the tail is `selector {sub-message}` groups; recurse into the
    // sub-message bodies (they may hold nested args) but never treat them as args.
    if (typeEnd !== -1 && (type === "plural" || type === "selectordinal" || type === "select")) {
      for (const sub of topLevelGroups(rest.slice(typeEnd + 1))) collectArgs(sub, out);
    }
  }
}

// Yield the contents of each balanced, top-level `{...}` group in `text`.
function topLevelGroups(text: string): string[] {
  const groups: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) break;
    }
    groups.push(text.slice(i + 1, j));
    i = j;
  }
  return groups;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

async function loadCatalog(locale: string): Promise<unknown> {
  return (await import(`./messages/${locale}.json`)).default;
}

// The default catalog is the source of truth: at runtime every non-default locale is deep-merged under it,
// so a translation may omit keys (they fall back) but must never contain keys the default lacks — an
// unknown key is a typo or an orphaned translation left behind after the default copy was renamed/removed. Looping over LOCALES keeps this coverage automatic for any locale a downstream template adds.
const defaultCatalog = await loadCatalog(DEFAULT_LOCALE);
const defaultKeyList = keyPaths(defaultCatalog);
const defaultKeys = new Set(defaultKeyList);
const defaultLeaves = new Map(stringLeaves(defaultCatalog));
const nonDefaultLocales = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

describe("message catalogs", () => {
  if (nonDefaultLocales.length === 0) {
    test("default locale is the only catalog", () => {
      expect(LOCALES).toEqual([DEFAULT_LOCALE]);
    });
  }

  test.each(nonDefaultLocales)(
    "%s.json only contains keys present in the default catalog",
    async (locale) => {
      const unknownKeys = keyPaths(await loadCatalog(locale)).filter(
        (key) => !defaultKeys.has(key),
      );
      expect(unknownKeys).toEqual([]);
    },
  );

  // The fallback silently backfills untranslated keys at runtime, so a missing translation
  // never errors — this inspects the raw catalogs to enforce full coverage. Downstream
  // projects with intentionally partial translations should drop this test.
  test.each(nonDefaultLocales)(
    "%s.json defines every key in the default catalog",
    async (locale) => {
      const localeKeys = new Set(keyPaths(await loadCatalog(locale)));
      const missingKeys = [...defaultKeys].filter((key) => !localeKeys.has(key));

      expect(missingKeys).toEqual([]);
    },
  );

  // Same key set is not enough: catalogs are hand-edited JSON, and divergent nesting/order
  // makes diffs and reviews harder. Object key order is insertion order, so comparing the
  // flattened path lists catches both reordered siblings and structural drift.
  test.each(nonDefaultLocales)(
    "%s.json defines keys in the same order as the default catalog",
    async (locale) => {
      expect(keyPaths(await loadCatalog(locale))).toEqual(defaultKeyList);
    },
  );

  // Placeholder drift ({count} dropped or {name} renamed in a translation) makes next-intl
  // throw or render wrong at runtime; only compare keys the translation actually defines.
  test.each(nonDefaultLocales)(
    "%s.json keeps ICU placeholders in sync with the default catalog",
    async (locale) => {
      const mismatches = stringLeaves(await loadCatalog(locale)).flatMap(([path, value]) => {
        const defaultValue = defaultLeaves.get(path);
        if (defaultValue === undefined) return [];
        const expected = icuPlaceholders(defaultValue);
        const actual = icuPlaceholders(value);
        if (setsEqual(expected, actual)) return [];
        return [`${path}: expected {${[...expected].sort()}}, got {${[...actual].sort()}}`];
      });

      expect(mismatches).toEqual([]);
    },
  );

  // Empty values would override the default-locale fallback with blank text at runtime,
  // defeating the fallback. Check every catalog, the default included.
  test.each(LOCALES)("%s.json has no empty message values", async (locale) => {
    const emptyKeys = stringLeaves(await loadCatalog(locale))
      .filter(([, value]) => value.trim().length === 0)
      .map(([path]) => path);

    expect(emptyKeys).toEqual([]);
  });
});
