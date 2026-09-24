import { beforeEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "./config";
import type { TranslatorNamespace } from "./translator";

// What the mocked `getUserLocale` answers, reset per test.
let userLocale: Locale;

vi.mock("server-only", () => ({}));

vi.mock("./locale", () => ({ getUserLocale: vi.fn(async () => userLocale) }));

const { getLocale, getTranslations } = await import("./server");

const OTHER_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

async function loadCatalog(locale: Locale): Promise<Record<string, unknown>> {
  return (await import(`./messages/${locale}.json`)).default;
}

function readPath(catalog: Record<string, unknown>, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (node, key) => (node as Record<string, unknown> | undefined)?.[key],
    catalog,
  );
}

// The first plain string leaf — no ICU placeholder, no rich-text tag — that the two catalogs
// translate differently. Derived from the catalogs so a fork that rewrites its copy stays green.
function findDivergentLeaf(
  node: unknown,
  other: Record<string, unknown>,
  path: string[] = [],
): string[] | null {
  if (typeof node === "string") {
    const isPlain = !node.includes("{") && !node.includes("<");

    return isPlain && path.length > 1 && readPath(other, path) !== node ? path : null;
  }

  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    const found = findDivergentLeaf(value, other, [...path, key]);
    if (found) {
      return found;
    }
  }

  return null;
}

const defaultCatalog = await loadCatalog(DEFAULT_LOCALE);
const otherCatalog = OTHER_LOCALE ? await loadCatalog(OTHER_LOCALE) : {};
const leafPath = findDivergentLeaf(defaultCatalog, otherCatalog) ?? [];
const namespace = leafPath.slice(0, -1).join(".") as TranslatorNamespace;
const key = leafPath.at(-1) ?? "";

beforeEach(() => {
  userLocale = DEFAULT_LOCALE;
});

// The precedence itself is pinned in `locale.test.ts`; this only proves there is no second rule here.
describe("getLocale", () => {
  test.each(ENABLED_LOCALES)("answers what getUserLocale answers (%s)", async (locale) => {
    userLocale = locale;

    await expect(getLocale()).resolves.toBe(locale);
  });
});

describe.runIf(OTHER_LOCALE && leafPath.length > 1)("getTranslations", () => {
  test("binds a namespace to the locale of the request", async () => {
    userLocale = OTHER_LOCALE!;
    const t = await getTranslations(namespace);

    expect(t(key as never)).toBe(readPath(otherCatalog, leafPath));
  });

  test("serves the whole catalog when no namespace is given", async () => {
    userLocale = OTHER_LOCALE!;
    const t = await getTranslations();

    expect(t(leafPath.join(".") as never)).toBe(readPath(otherCatalog, leafPath));
  });

  test("an explicit locale overrides the request", async () => {
    userLocale = OTHER_LOCALE!;
    const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace });

    expect(t(key as never)).toBe(readPath(defaultCatalog, leafPath));
  });
});
