import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { STATIC_PUBLIC_ROUTES } from "./public-routes";

const LOCALE_ROOT_DIR = fileURLToPath(new URL("../app/[locale]", import.meta.url));

// The walk starts at the locale root and excludes by name, so a new route group is covered by
// default instead of opting in. `(app)` is session-gated and `(auth)` is a credential flow, so no
// public surface may list either; `blog` and `docs` are route families declared in their own lists.
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set(["(app)", "(auth)", "blog", "docs"]);

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

function collectStaticPagePathnames({
  dir,
  segments = [],
  skip = new Set<string>(),
}: {
  dir: string;
  segments?: string[];
  // Matched against a directory name at any depth, because an excluded route family such as `blog`
  // sits below the route group that holds it.
  skip?: ReadonlySet<string>;
}): string[] {
  const pathnames: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") {
      pathnames.push(segments.length === 0 ? "/" : `/${segments.join("/")}`);
      continue;
    }

    if (!entry.isDirectory() || isDynamicSegment(entry.name) || skip.has(entry.name)) {
      continue;
    }

    pathnames.push(
      ...collectStaticPagePathnames({
        dir: `${dir}/${entry.name}`,
        segments: isRouteGroup(entry.name) ? segments : [...segments, entry.name],
        skip,
      })
    );
  }

  return pathnames;
}

const staticPagePathnames = collectStaticPagePathnames({
  dir: LOCALE_ROOT_DIR,
  skip: EXCLUDED_DIRECTORIES,
});
const declaredPathnames: readonly string[] = STATIC_PUBLIC_ROUTES.map(({ pathname }) => pathname);

describe("STATIC_PUBLIC_ROUTES", () => {
  test("declares every static public JSX page", () => {
    expect(staticPagePathnames.filter((pathname) => !declaredPathnames.includes(pathname))).toEqual(
      []
    );
  });

  test("does not declare a route without a static public JSX page", () => {
    expect(declaredPathnames.filter((pathname) => !staticPagePathnames.includes(pathname))).toEqual(
      []
    );
  });
});
