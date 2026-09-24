import { createTranslator } from "use-intl/core";
import { describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE, ENABLED_LOCALES } from "./config";
import { getTranslator } from "./translator";

vi.mock("use-intl/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("use-intl/core")>();

  return { ...actual, createTranslator: vi.fn(actual.createTranslator) };
});

const NAMESPACE = "Client.Common";

// No other test here asks for it, so every build it sees comes from the memo test.
const MEMO_NAMESPACE = "Client.Validation";

describe("getTranslator", () => {
  test("holds one translator per locale and namespace", async () => {
    const [first, second, root] = await Promise.all([
      getTranslator({ locale: DEFAULT_LOCALE, namespace: NAMESPACE }),
      getTranslator({ locale: DEFAULT_LOCALE, namespace: NAMESPACE }),
      getTranslator({ locale: DEFAULT_LOCALE }),
    ]);

    expect(second).toBe(first);
    expect(root).not.toBe(first);
  });

  test("builds a translator once for repeated calls", async () => {
    const first = await getTranslator({ locale: DEFAULT_LOCALE, namespace: MEMO_NAMESPACE });
    const second = await getTranslator({ locale: DEFAULT_LOCALE, namespace: MEMO_NAMESPACE });

    const builds = vi
      .mocked(createTranslator)
      .mock.calls.filter(
        ([options]) => options.locale === DEFAULT_LOCALE && options.namespace === MEMO_NAMESPACE,
      );

    expect(second).toBe(first);
    expect(builds).toHaveLength(1);
  });

  test("formats in the same time zone as the client provider", async () => {
    await getTranslator({ locale: DEFAULT_LOCALE, namespace: NAMESPACE });

    expect(createTranslator).toHaveBeenCalledWith(
      expect.objectContaining({ timeZone: DEFAULT_TIME_ZONE }),
    );
  });

  test.each(ENABLED_LOCALES)("resolves a scoped key like the root does in %s", async (locale) => {
    const [scoped, root] = await Promise.all([
      getTranslator({ locale, namespace: NAMESPACE }),
      getTranslator({ locale }),
    ]);

    expect(scoped("cancel")).toBe(root(`${NAMESPACE}.cancel`));
    expect(scoped("cancel")).not.toBe(`${NAMESPACE}.cancel`);
  });
});
