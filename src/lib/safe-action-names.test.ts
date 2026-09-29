/// <reference types="vite/client" />

import { expect, test } from "vitest";

// The type system forces `.metadata()` on every action, but not that the name is right. A copied
// action keeps the old name, and its spans then join the wrong action in every trace query.
const sources = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  eager: true,
  import: "default",
  query: "?raw",
});

const ACTION_DECLARATION = /export const (\w+) = actionClient\s*\.metadata\(\{ actionName: "(\w+)" \}\)/g;
const ANY_ACTION_DECLARATION = /= actionClient\b(?!\s*\.use)/g;

const declarations = Object.entries(sources).flatMap(([file, source]) =>
  [...source.matchAll(ACTION_DECLARATION)].map(([, exportName, actionName]) => ({
    file,
    exportName,
    actionName,
  })),
);

test("every action declares its name right after `actionClient`", () => {
  const declared = Object.values(sources).reduce(
    (count, source) => count + (source.match(ANY_ACTION_DECLARATION)?.length ?? 0),
    0,
  );

  expect(declarations.length).toBeGreaterThan(0);
  expect(declarations.length).toBe(declared);
});

// A prefix is allowed only to tell apart two modules that export the same name.
test("every action name ends with its export name", () => {
  const mismatches = declarations.filter(
    ({ exportName, actionName }) => !actionName.toLowerCase().endsWith(exportName.toLowerCase()),
  );

  expect(mismatches).toEqual([]);
});

test("every action name is unique", () => {
  const seen = new Map<string, string>();
  const duplicates = declarations.filter(({ file, actionName }) => {
    const first = seen.get(actionName);
    seen.set(actionName, first ?? file);

    return first !== undefined;
  });

  expect(duplicates).toEqual([]);
});
