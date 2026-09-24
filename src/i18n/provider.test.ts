import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { useFormatter } from "./client";
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE } from "./config";
import { AppIntlProvider } from "./provider";

// Noon UTC on New Year's Day: every zone east of UTC+12 already reads the next day, so a provider
// that forgets `timeZone` and falls back to the runtime zone formats a different date.
const INSTANT = new Date("2026-01-01T12:00:00.000Z");
const FAR_EAST_TIME_ZONE = "Pacific/Kiritimati";

function FormattedDate() {
  const format = useFormatter();
  return createElement("span", null, format.dateTime(INSTANT, { dateStyle: "short" }));
}

function renderUnderProvider(): string {
  const props = {
    locale: DEFAULT_LOCALE,
    messages: {},
    children: createElement(FormattedDate),
  };

  return renderToStaticMarkup(createElement(AppIntlProvider, props));
}

function formatIn(timeZone: string): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone, dateStyle: "short" }).format(INSTANT);
}

describe("AppIntlProvider", () => {
  test("pins the time zone so a formatted date ignores the runtime zone", () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = FAR_EAST_TIME_ZONE;

    try {
      // Guards the guard: without a real zone shift the assertion below proves nothing.
      expect(formatIn(FAR_EAST_TIME_ZONE)).not.toBe(formatIn(DEFAULT_TIME_ZONE));
      expect(renderUnderProvider()).toContain(formatIn(DEFAULT_TIME_ZONE));
    } finally {
      process.env.TZ = originalTimeZone;
    }
  });
});
