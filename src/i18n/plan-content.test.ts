import { describe, expect, test } from "vitest";
import { createTranslator } from "next-intl";

import { DEFAULT_LOCALE } from "./config";
import { TEAM_PLAN_IDS } from "@/constants/plans";
import { TEAM_ADDON_IDS } from "@/constants/addons";

// Cross-catalog parity between locales is covered by messages.test.ts; this checks the
// plan catalog against the DEFAULT locale copy, exercising the same t.has()/t.raw()
// access pattern the billing plan cards use. Template-safe: derived from TEAM_PLAN_IDS,
// so renaming or adding a plan fails here until its planContent copy exists (or the
// downstream project deliberately drops this test to rely on the limits-only fallback).
const messages = (await import(`./messages/${DEFAULT_LOCALE}.json`)).default;

const t = createTranslator({
  locale: DEFAULT_LOCALE,
  messages,
  namespace: "Client.Dashboard.Billing",
});

describe("plan marketing copy", () => {
  test.each(TEAM_PLAN_IDS)("plan %s has a description and feature bullets", (planId) => {
    expect(t.has(`planContent.${planId}.description`)).toBe(true);
    expect(t(`planContent.${planId}.description`).trim().length).toBeGreaterThan(0);

    expect(t.has(`planContent.${planId}.features`)).toBe(true);
    const features = t.raw(`planContent.${planId}.features`);
    expect(Array.isArray(features)).toBe(true);
    expect((features as string[]).length).toBeGreaterThan(0);
    for (const feature of features as string[]) {
      expect(typeof feature).toBe("string");
      expect(feature.trim().length).toBeGreaterThan(0);
    }
  });

  test("limit lines are localized with plural-aware placeholders", () => {
    expect(t("seatsFeature", { seats: 1 })).not.toContain("{");
    expect(t("seatsFeature", { seats: 10 })).not.toBe(t("seatsFeature", { seats: 1 }));
    expect(t("projectsFeature", { projects: 20 })).not.toContain("{");
  });
});

describe("add-on marketing copy", () => {
  // Descriptions are optional for add-ons (the card renders without one), but every
  // add-on the template ships should have copy in the default locale.
  test.each(TEAM_ADDON_IDS)("add-on %s has a description", (addonId) => {
    const key = `addonContent.${addonId}.description` as Parameters<typeof t.has>[0];
    expect(t.has(key)).toBe(true);
    expect(t(key).trim().length).toBeGreaterThan(0);
  });

  test("grant lines are localized with plural-aware placeholders", () => {
    expect(t("addonSeatsGrant", { seats: 1 })).not.toContain("{");
    expect(t("addonSeatsGrant", { seats: 5 })).not.toBe(t("addonSeatsGrant", { seats: 1 }));
    expect(t("addonProjectsGrant", { projects: 10 })).not.toContain("{");
  });
});
