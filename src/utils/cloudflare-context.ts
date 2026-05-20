import "server-only";

import { env as workerEnv } from "cloudflare:workers";
import { headers } from "next/headers";
import { cache } from "react";

import { CF_CONTEXT_FIELDS, type CloudflareRequestContext } from "./cf-context-fields";

export interface CloudflareContext {
  cf?: CloudflareRequestContext;
  env: typeof workerEnv;
}

function parseCfBooleanHeader(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}

function getRequestContextFromHeaders(headersList: Headers): CloudflareRequestContext | undefined {
  const cf: CloudflareRequestContext = {};
  const writableCf = cf as Record<string, string | boolean | undefined>;
  let hasAny = false;

  for (const row of CF_CONTEXT_FIELDS) {
    const { key, header } = row;
    const valueKind = "valueKind" in row ? row.valueKind : undefined;
    const value = headersList.get(header);
    if (!value) continue;

    if (valueKind === "boolean") {
      const parsed = parseCfBooleanHeader(value);
      if (parsed !== undefined) {
        writableCf[key] = parsed;
        hasAny = true;
      }
      continue;
    }

    writableCf[key] = value;
    hasAny = true;
  }

  return hasAny ? cf : undefined;
}

export const getCloudflareContext = cache(async (): Promise<CloudflareContext> => {
  try {
    return {
      cf: getRequestContextFromHeaders(await headers()),
      env: workerEnv,
    };
  } catch {
    return { env: workerEnv };
  }
});
