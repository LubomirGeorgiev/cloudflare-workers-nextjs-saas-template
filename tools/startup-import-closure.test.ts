import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { collectStaticImportClosure } from "./startup-import-closure";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

interface StartupEntry {
  /** Repo-relative module the Worker evaluates before it can serve anything. */
  entry: string;
  /** Every source module that entry reaches by static import, itself included. */
  closure: readonly string[];
}

// The exact startup graph of each entry, declared rather than measured: adding a line here is how a
// change says "yes, every cold isolate should now evaluate this". See
// `docs/worker-hot-path-and-bundle-size.md` for what each budget costs.
const STARTUP_ENTRIES: readonly StartupEntry[] = [
  {
    entry: "worker-entrypoint.ts",
    closure: [
      "worker-entrypoint.ts",
      "src/constants.ts",
      "src/constants/oauth.ts",
      "src/lib/api/scopes.ts",
      "src/lib/oauth/provider-config.ts",
      "src/utils/api-key-format.ts",
      "src/utils/cf-context-fields.ts",
      "src/utils/random-token.ts",
      "src/utils/request-protocol.ts",
      "src/utils/trusted-client-ip.ts",
    ],
  },
  {
    entry: "src/proxy.ts",
    closure: [
      "src/proxy.ts",
      "src/constants.ts",
      "src/constants/oauth.ts",
      "src/i18n/config.ts",
      "src/i18n/localized-paths.ts",
      "src/i18n/routing.ts",
    ],
  },
  // next-intl's request config is reached from the proxy above, so its tail is startup cost too.
  {
    entry: "src/i18n/request.ts",
    closure: [
      "src/i18n/request.ts",
      "src/constants.ts",
      "src/constants/oauth.ts",
      "src/i18n/config.ts",
      "src/i18n/load-messages.ts",
      "src/i18n/locale.ts",
      "src/i18n/message-catalogs.ts",
      "src/i18n/routing.ts",
      "src/lib/action-error.ts",
      "src/lib/api/principal.ts",
      "src/utils/lazy-value.ts",
      "src/utils/name-initials.ts",
    ],
  },
  // Vinext registers these two as static imports in the entry's route table — the one exception to
  // metadata routes costing upload only.
  {
    entry: "src/app/sitemap.ts",
    closure: ["src/app/sitemap.ts"],
  },
  {
    entry: "src/app/robots.ts",
    closure: ["src/app/robots.ts", "src/constants.ts", "src/constants/oauth.ts"],
  },
];

interface ForbiddenSpecifier {
  /** Repo-relative path prefix (trailing slash) or exact file, matched against the closure. */
  specifier: string;
  /** What a cold isolate would evaluate if this ever joined the graph. */
  cost: string;
}

// Defense in depth behind the allowlists: the specific tails this codebase has already paid for
// once. Pasting a new closure in above without thinking still trips these.
const FORBIDDEN_MODULES: readonly ForbiddenSpecifier[] = [
  { specifier: "src/api/", cost: "the Hono app, every router, and the services behind them" },
  { specifier: "src/mcp/", cost: "the MCP SDK, which builds its protocol schema set at import time" },
  { specifier: "src/db/", cost: "the whole Drizzle schema" },
  { specifier: "src/lib/cms/", cost: "the CMS repositories" },
  { specifier: "src/lib/oauth/edge/", cost: "the KV rate-limiter chain" },
  { specifier: "src/lib/scheduler/", cost: "the scheduler job graph" },
  { specifier: "src/i18n/messages/", cost: "a ~66 KiB message catalog per locale" },
  { specifier: "src/app/build-sitemap.ts", cost: "the CMS repositories and the Drizzle schema" },
  { specifier: "src/lib/stripe.ts", cost: "the Stripe billing client" },
  { specifier: "src/utils/auth.ts", cost: "the session/D1 layer" },
  { specifier: "src/utils/email.tsx", cost: "the react-email renderer and every template" },
];

const FORBIDDEN_PACKAGES: readonly ForbiddenSpecifier[] = [
  { specifier: "@modelcontextprotocol/server", cost: "the MCP protocol schema set" },
  { specifier: "agents", cost: "the MCP agent runtime" },
  { specifier: "drizzle-orm", cost: "the query builder" },
  { specifier: "hono", cost: "the API framework" },
  { specifier: "hono-openapi", cost: "the API framework's spec layer" },
  { specifier: "stripe", cost: "the Stripe SDK" },
  { specifier: "ua-parser-js", cost: "the user-agent parser tables" },
];

function matchesSpecifier({ candidate, specifier }: { candidate: string; specifier: string }): boolean {
  return (
    candidate === specifier ||
    candidate.startsWith(specifier.endsWith("/") ? specifier : `${specifier}/`)
  );
}

function findForbidden({
  candidates,
  forbidden,
}: {
  candidates: ReadonlySet<string>;
  forbidden: readonly ForbiddenSpecifier[];
}): string[] {
  return [...candidates].flatMap((candidate) =>
    forbidden
      .filter((rule) => matchesSpecifier({ candidate, specifier: rule.specifier }))
      .map((rule) => `${candidate} — pulls in ${rule.cost}`)
  );
}

// This is the guard the doc's "walk the closure" procedure never had: every `await import()` on a
// startup path is load-bearing, and nothing else notices when one turns back into a static import.
describe.each(STARTUP_ENTRIES)("startup import closure of $entry", ({ entry, closure }) => {
  const { modules, packages } = collectStaticImportClosure({ entries: [entry], repoRoot: REPO_ROOT });

  test("reaches exactly the modules declared for it", () => {
    expect([...modules].sort()).toEqual([...closure].sort());
  });

  test("reaches no module that must stay behind an import()", () => {
    expect(findForbidden({ candidates: modules, forbidden: FORBIDDEN_MODULES })).toEqual([]);
  });

  test("reaches no package that must stay behind an import()", () => {
    expect(findForbidden({ candidates: packages, forbidden: FORBIDDEN_PACKAGES })).toEqual([]);
  });
});

// The positive control the assertions above cannot give themselves: they only prove absence, which
// is also what a walker that silently parses nothing would report.
describe("collectStaticImportClosure", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "startup-closure-"));

  function writeFixture(path: string, source: string): void {
    const target = join(fixtureRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }

  writeFixture(
    "entry.ts",
    [
      `import "./side-effect";`,
      `import type { Erased } from "./type-only";`,
      `import { value } from "./static-dep";`,
      `export { reexported } from "./reexport";`,
      `import bare from "some-package";`,
      `export const load = async () => (await import("./dynamic")).lazy;`,
      `export const used = [value, bare, load] as unknown as Erased;`,
    ].join("\n")
  );
  writeFixture("side-effect.ts", "globalThis.touched = true;");
  writeFixture("type-only.ts", "export interface Erased { a: string }");
  writeFixture("static-dep.ts", `export { value } from "@/aliased";`);
  writeFixture("src/aliased.ts", "export const value = 1;");
  writeFixture("reexport/index.ts", "export const reexported = 2;");
  writeFixture("dynamic.ts", "export const lazy = 3;");

  const { modules, packages } = collectStaticImportClosure({
    entries: ["entry.ts"],
    repoRoot: fixtureRoot,
  });

  test("follows side-effect, named, re-exported, and @/-aliased static imports", () => {
    expect([...modules].sort()).toEqual([
      "entry.ts",
      "reexport/index.ts",
      "side-effect.ts",
      "src/aliased.ts",
      "static-dep.ts",
    ]);
  });

  test("skips import() and erased type-only imports, and does not walk into packages", () => {
    expect([...packages]).toEqual(["some-package"]);
  });

  test("throws rather than silently skipping a relative import it cannot resolve", () => {
    writeFixture("broken.ts", `import { gone } from "./missing";`);

    expect(() =>
      collectStaticImportClosure({ entries: ["broken.ts"], repoRoot: fixtureRoot })
    ).toThrow(/Unresolvable static import/);
  });
});
