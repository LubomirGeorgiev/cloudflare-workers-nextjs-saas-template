import { describe, expect, test } from "vitest";
import { createTranslator } from "next-intl";

import { DEFAULT_LOCALE } from "./config";
import { TEAM_PLAN_IDS } from "@/constants/plans";

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
