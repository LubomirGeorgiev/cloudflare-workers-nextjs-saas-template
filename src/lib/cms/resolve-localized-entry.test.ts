import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resolveLocalizedEntry } = await import("./resolve-localized-entry");

describe("resolveLocalizedEntry", () => {
  test("returns the active-locale entry with isFallback=false when it exists", async () => {
    const activeEntry = { title: "Hola", locale: "es" };
    const getEntry = vi.fn(async ({ locale }: { locale: string }) =>
      locale === "es" ? activeEntry : { title: "Hello", locale: "en" }
    );

    const result = await resolveLocalizedEntry({
      locale: "es",
      defaultLocale: "en",
      getEntry,
    });

    expect(result).toEqual({ entry: activeEntry, isFallback: false });
    expect(getEntry).toHaveBeenCalledTimes(1);
    expect(getEntry).toHaveBeenCalledWith({ locale: "es" });
  });

  test("falls back to the default-locale entry and flags isFallback=true when the active locale is missing", async () => {
    const defaultEntry = { title: "Hello", locale: "en" };
    const getEntry = vi.fn(async ({ locale }: { locale: string }) =>
      locale === "en" ? defaultEntry : null
    );

    const result = await resolveLocalizedEntry({
      locale: "es",
      defaultLocale: "en",
      getEntry,
    });

    expect(result).toEqual({ entry: defaultEntry, isFallback: true });
    expect(getEntry).toHaveBeenCalledTimes(2);
    expect(getEntry).toHaveBeenNthCalledWith(1, { locale: "es" });
    expect(getEntry).toHaveBeenNthCalledWith(2, { locale: "en" });
  });

  test("returns null when neither the active nor the default locale has an entry", async () => {
    const getEntry = vi.fn(async () => null);

    const result = await resolveLocalizedEntry({
      locale: "es",
      defaultLocale: "en",
      getEntry,
    });

    expect(result).toBeNull();
  });

  test("does not re-fetch when the active locale already is the default locale", async () => {
    const getEntry = vi.fn(async () => null);

    const result = await resolveLocalizedEntry({
      locale: "en",
      defaultLocale: "en",
      getEntry,
    });

    expect(result).toBeNull();
    expect(getEntry).toHaveBeenCalledTimes(1);
  });
});
