import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  MIXED_LOCALIZATION_PATH_SEGMENTS,
  NON_LOCALIZED_PATH_SEGMENTS,
  shouldLocalizePathname,
} from "./localized-paths";

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));
const LOCALE_SEGMENT_DIR = "[locale]";
const ROUTABLE_FILES = ["page.tsx", "route.ts"];

function isRouteGroup(dirName: string): boolean {
  return dirName.startsWith("(") && dirName.endsWith(")");
}

// Route groups are URL-transparent, so their children are the real top-level segments.
// A directory only counts once it actually serves something.
function collectTopLevelSegments(dir: string): Set<string> {
  const segments = new Set<string>();

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === LOCALE_SEGMENT_DIR) {
      continue;
    }

    if (isRouteGroup(entry.name)) {
      for (const nested of collectTopLevelSegments(`${dir}/${entry.name}`)) {
        segments.add(nested);
      }
      continue;
    }

    if (hasRoutableDescendant(`${dir}/${entry.name}`)) {
      segments.add(entry.name);
    }
  }

  return segments;
}

function hasRoutableDescendant(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? hasRoutableDescendant(`${dir}/${entry.name}`)
      : ROUTABLE_FILES.includes(entry.name)
  );
}

const rootSegments = collectTopLevelSegments(APP_DIR);
const localizedSegments = collectTopLevelSegments(`${APP_DIR}/${LOCALE_SEGMENT_DIR}`);
const declaredSegments: readonly string[] = [
  ...NON_LOCALIZED_PATH_SEGMENTS,
  ...MIXED_LOCALIZATION_PATH_SEGMENTS,
];

// This is the guard the hand-maintained matcher regex never had: add a section outside
// `app/[locale]` and forget to declare it, and the locale rewrite silently 404s it.
describe("non-localized segment declarations", () => {
  test("every top-level app segment outside [locale] is declared", () => {
    expect([...rootSegments].filter((segment) => !declaredSegments.includes(segment))).toEqual([]);
  });

  test("declared non-localized segments are not also served under [locale]", () => {
    const overlapping = NON_LOCALIZED_PATH_SEGMENTS.filter((segment) =>
      localizedSegments.has(segment)
    );

    expect(overlapping).toEqual([]);
  });

  test("mixed segments really are served from both trees", () => {
    const missingFromRoot = MIXED_LOCALIZATION_PATH_SEGMENTS.filter(
      (segment) => !rootSegments.has(segment)
    );
    const missingFromLocale = MIXED_LOCALIZATION_PATH_SEGMENTS.filter(
      (segment) => !localizedSegments.has(segment)
    );

    expect({ missingFromRoot, missingFromLocale }).toEqual({
      missingFromRoot: [],
      missingFromLocale: [],
    });
  });

  // Catches entries kept alive by habit: a path a Worker handler intercepts before Next
  // never reaches the proxy, so declaring it here is dead weight.
  test("no declared segment is missing from the app tree", () => {
    expect(declaredSegments.filter((segment) => !rootSegments.has(segment))).toEqual([]);
  });
});

describe("shouldLocalizePathname", () => {
  test("localizes public pages", () => {
    const pathnames = ["/", "/blog", "/blog/some-post", "/es/blog", "/sign-in"];

    expect(pathnames.filter((pathname) => !shouldLocalizePathname(pathname))).toEqual([]);
  });

  test("skips every declared non-localized segment, including nested paths", () => {
    const pathnames = NON_LOCALIZED_PATH_SEGMENTS.flatMap((segment) => [
      `/${segment}`,
      `/${segment}/nested/path`,
    ]);

    expect(pathnames.filter(shouldLocalizePathname)).toEqual([]);
  });

  test("skips assets and machine endpoints", () => {
    const pathnames = ["/favicon.ico", "/robots.txt", "/sitemap.xml", "/docs/llms.txt"];

    expect(pathnames.filter(shouldLocalizePathname)).toEqual([]);
  });

  // `.md` resolves to a /markdown/* redirect on the page itself, so it has to be
  // rewritten onto a locale first — unlike every other dotted path.
  test("localizes .md page requests regardless of case", () => {
    expect(shouldLocalizePathname("/docs/core-concepts/billing.md")).toBe(true);
    expect(shouldLocalizePathname("/blog/some-post.MD")).toBe(true);
    expect(shouldLocalizePathname("/es/docs/core-concepts/billing.md")).toBe(true);
  });

  test("does not localize .md under a non-localized segment", () => {
    expect(shouldLocalizePathname("/markdown/docs/introduction.md")).toBe(false);
  });
});
