// Worker entry for edge-only behavior before vinext's App Router handles the request.
import handler from "vinext/server/fetch-handler";
import type { ScheduledQueueMessage } from "./src/lib/scheduler/jobs";
import {
  handleSchedulerCron,
  handleSchedulerQueue,
} from "./src/lib/scheduler/worker";
import { __INTERNAL_CF_CONTEXT_FIELDS } from "./src/utils/cf-context-fields";
import {
  __INTERNAL_CLIENT_IP_HEADERS_TO_STRIP,
  __INTERNAL_TRUSTED_CLIENT_IP_HEADER,
} from "./src/utils/trusted-client-ip";
import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "./src/utils/request-protocol";

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

    // `/_next/image` optimization is handled inside the wrapped fetch-handler
    // via the Cloudflare Images adapter configured in vite.config.ts (vinext({ images })).
    return handler.fetch(withForwardedCfHeaders(request), env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleSchedulerCron({
      env,
      now: new Date(controller.scheduledTime),
    }));
  },

  async queue(batch: MessageBatch<ScheduledQueueMessage>, __env: Env, __ctx: ExecutionContext): Promise<void> {
    await handleSchedulerQueue(batch);
  },
} satisfies ExportedHandler<Env, ScheduledQueueMessage>;

// Only set here (never trusted from the inbound request) to prevent client spoofing.
function withForwardedCfHeaders(request: Request): Request {
  const forwarded = new Request(request);
  forwarded.headers.delete(__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER);
  forwarded.headers.set(
    __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER,
    new URL(request.url).protocol.slice(0, -1),
  );

  for (const header of __INTERNAL_CLIENT_IP_HEADERS_TO_STRIP) {
    forwarded.headers.delete(header);
  }

  for (const { header } of __INTERNAL_CF_CONTEXT_FIELDS) {
    forwarded.headers.delete(header);
  }

  const trustedClientIp = request.headers.get("cf-connecting-ip");
  if (trustedClientIp) {
    forwarded.headers.set(__INTERNAL_TRUSTED_CLIENT_IP_HEADER, trustedClientIp);
  }

  const cf = request.cf;
  if (!cf) return forwarded;

  for (const { key, header } of __INTERNAL_CF_CONTEXT_FIELDS) {
    const value = cf[key];
    if (value !== undefined && value !== null && value !== "") {
      forwarded.headers.set(header, String(value));
    }
  }

  return forwarded;
}

export default worker;
