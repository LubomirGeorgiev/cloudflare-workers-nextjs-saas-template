/// <reference types="vite/client" />

import { expect, test } from "vitest";

import { v } from "@/lib/validation";
import {
  apiKeyIdParamSchema,
  listApiKeysQuerySchema,
  updateApiKeyScopesBodySchema,
} from "@/schemas/api/api-keys.schema";
import { createInvitationSchema } from "@/schemas/api/invitations.schema";
import { sessionIdParamSchema } from "@/schemas/api/me.schema";
import { updateTeamSchema } from "@/schemas/api/teams.schema";
import { teamIdParamSchema } from "@/schemas/fields";

// Every string a caller can send needs a ceiling: without one, a single request decides how much
// CPU, D1 row, and KV value budget it spends. This walks the real schema graph rather than
// grepping, so a field added tomorrow — anywhere, at any nesting depth — is caught here.
//
// Only *input* schemas are in scope. `src/schemas/api/` is mostly response shapes, which document
// what we emit and are never validated at runtime; its request halves are listed explicitly below,
// and a new one belongs in that list.
const inputSchemaModules = import.meta.glob("./*.schema.ts", { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

const serviceSchemaModules = import.meta.glob("../lib/cms/entry/schemas.ts", {
  eager: true,
}) as Record<string, Record<string, unknown>>;

// The request schemas that live under `src/schemas/api/` rather than in a globbed file above.
// Every other schema an API route validates (`createTeamSchema`, `removeMemberSchema`,
// `userSettingsSchema`, `createApiKeySchema`, ...) is shared with a form and already covered.
const apiRequestSchemas: Record<string, unknown> = {
  apiKeyIdParamSchema,
  listApiKeysQuerySchema,
  updateApiKeyScopesBodySchema,
  createInvitationSchema,
  sessionIdParamSchema,
  updateTeamSchema,
  teamIdParamSchema,
};

interface PipeItem {
  readonly type?: string;
}

interface SchemaNode {
  readonly type?: string;
  readonly pipe?: readonly PipeItem[];
  readonly entries?: Record<string, unknown>;
  readonly wrapped?: unknown;
  readonly item?: unknown;
  readonly key?: unknown;
  readonly value?: unknown;
  readonly options?: readonly unknown[];
}

function asSchemaNode(value: unknown): SchemaNode | undefined {
  return typeof value === "object" && value !== null && "~standard" in value && "type" in value
    ? (value as SchemaNode)
    : undefined;
}

function hasAction(node: SchemaNode, actionType: string): boolean {
  return (node.pipe ?? []).some((item) => item.type === actionType);
}

function collectUnbounded({
  value,
  path,
  seen,
  found,
}: {
  value: unknown;
  path: string;
  seen: Set<unknown>;
  found: string[];
}): void {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return;
  }

  seen.add(value);

  const node = asSchemaNode(value);

  // A module can export a bag of entries rather than a schema (`cmsTranslationTargetFields`);
  // spread into an object it is still an input surface, so walk its values too.
  if (!node) {
    for (const [key, entry] of Object.entries(value)) {
      collectUnbounded({ value: entry, path: `${path}.${key}`, seen, found });
    }

    return;
  }

  if (node.type === "string" && !hasAction(node, "max_length")) {
    found.push(`${path} (string with no maxLength)`);
  }

  // An unbounded array is unbounded work per request, the same failure as an unbounded string.
  if (node.type === "array" && !hasAction(node, "max_length")) {
    found.push(`${path} (array with no maxLength)`);
  }

  if (node.entries) {
    for (const [key, entry] of Object.entries(node.entries)) {
      collectUnbounded({ value: entry, path: `${path}.${key}`, seen, found });
    }
  }

  for (const [suffix, child] of [
    ["", node.wrapped],
    ["[]", node.item],
    ["{key}", node.key],
    ["{value}", node.value],
  ] as const) {
    collectUnbounded({ value: child, path: `${path}${suffix}`, seen, found });
  }

  for (const [index, option] of (node.options ?? []).entries()) {
    collectUnbounded({ value: option, path: `${path}|${index}`, seen, found });
  }
}

function unboundedFieldsIn(modules: Record<string, Record<string, unknown>>): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();

  for (const [file, module] of Object.entries(modules)) {
    for (const [name, exported] of Object.entries(module)) {
      collectUnbounded({ value: exported, path: `${file} → ${name}`, seen, found });
    }
  }

  return found;
}

test("the walker actually rejects an unbounded string", () => {
  const found: string[] = [];

  collectUnbounded({
    value: v.object({ nested: v.object({ open: v.string() }) }),
    path: "probe",
    seen: new Set(),
    found,
  });

  expect(found).toEqual(["probe.nested.open (string with no maxLength)"]);
});

test("the walker accepts a bounded one", () => {
  const found: string[] = [];

  collectUnbounded({
    value: v.object({ closed: v.pipe(v.string(), v.maxLength(10)) }),
    path: "probe",
    seen: new Set(),
    found,
  });

  expect(found).toEqual([]);
});

test("every form and action schema bounds its strings and arrays", () => {
  expect(unboundedFieldsIn(inputSchemaModules)).toEqual([]);
});

test("every CMS service param schema bounds its strings and arrays", () => {
  expect(unboundedFieldsIn(serviceSchemaModules)).toEqual([]);
});

test("every public API request schema bounds its strings and arrays", () => {
  expect(unboundedFieldsIn({ "api requests": apiRequestSchemas })).toEqual([]);
});
