/**
 * Custom Cloudflare Worker entry — set `wrangler.jsonc` → `"main": "./worker-entrypoint.ts"`.
 *
 * vinext resolves `vinext/server/app-router-entry` in the RSC build; this file wraps it so you
 * can add edge-only behavior (security headers, auth, routing) before the App Router runs.
 *
 * @see https://github.com/vinext/vinext/blob/main/packages/vinext/src/server/app-router-entry.ts
 */
import { KVCacheHandler } from "vinext/cloudflare";
import handler from "vinext/server/app-router-entry";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
  IMAGE_OPTIMIZATION_PATH,
} from "vinext/server/image-optimization";
import { setCacheHandler } from "vinext/shims/cache";
import { CF_CONTEXT_FIELDS } from "./src/utils/cf-context-fields";
import {
  CLIENT_IP_HEADERS_TO_STRIP,
  TRUSTED_CLIENT_IP_HEADER,
} from "./src/utils/trusted-client-ip";

const VINEXT_CACHE_PREFIX = "vinext-cache";

/**
 * Edge-only logic before vinext and `/_vinext/image`.
 * Return a `Response` to short-circuit; return `null` to continue.
 */
async function handleCustomEdge(
  request: Request,
  __env: Env,
  __ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/_worker/health") {
    return Response.json({ ok: true });
  }

  return null;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setCacheHandler(
      new KVCacheHandler(env.NEXT_INC_CACHE_KV, {
        appPrefix: VINEXT_CACHE_PREFIX,
      }),
    );

    const early = await handleCustomEdge(request, env, ctx);
    if (early) return early;

    const url = new URL(request.url);

    if (url.pathname === IMAGE_OPTIMIZATION_PATH) {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES
              .input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format: format as ImageOutputOptions["format"], quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(withForwardedCfHeaders(request), env, ctx);
  },
};

// Only set here (never trusted from the inbound request) to prevent client spoofing.
function withForwardedCfHeaders(request: Request): Request {
  const forwarded = new Request(request);
  for (const header of CLIENT_IP_HEADERS_TO_STRIP) {
    forwarded.headers.delete(header);
  }

  for (const { header } of CF_CONTEXT_FIELDS) {
    forwarded.headers.delete(header);
  }

  const trustedClientIp = request.headers.get("cf-connecting-ip");
  if (trustedClientIp) {
    forwarded.headers.set(TRUSTED_CLIENT_IP_HEADER, trustedClientIp);
  }

  const cf = request.cf;
  if (!cf) return forwarded;

  for (const { key, header } of CF_CONTEXT_FIELDS) {
    const value = cf[key];
    if (value !== undefined && value !== null && value !== "") {
      forwarded.headers.set(header, String(value));
    }
  }

  return forwarded;
}

export default worker;
