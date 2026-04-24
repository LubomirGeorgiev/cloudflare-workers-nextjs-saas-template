/**
 * Custom Cloudflare Worker entry — set `wrangler.jsonc` → `"main": "./worker-entrypoint.ts"`.
 *
 * vinext resolves `vinext/server/app-router-entry` in the RSC build; this file wraps it so you
 * can add edge-only behavior (security headers, auth, routing) before the App Router runs.
 *
 * @see https://github.com/vinext/vinext/blob/main/packages/vinext/src/server/app-router-entry.ts
 */
import handler from "vinext/server/app-router-entry";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
  IMAGE_OPTIMIZATION_PATH,
} from "vinext/server/image-optimization";
import { CF_CONTEXT_FIELDS } from "./src/utils/cf-context-fields";

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
  const cf = request.cf;
  if (!cf) return request;

  const forwarded = new Request(request);
  for (const { key, header } of CF_CONTEXT_FIELDS) {
    forwarded.headers.delete(header);
    const value = cf[key];
    if (value !== undefined && value !== null && value !== "") {
      forwarded.headers.set(header, String(value));
    }
  }

  return forwarded;
}

export default worker;
