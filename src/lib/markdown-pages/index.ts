import { applyLlmsDescribedByLink, withLlmsDescribedByLinkHeader } from "./discovery-links";
import { resolveMdRequestTarget, type MdRequestTarget } from "./resolve-target";

export { resolveMdRequestTarget } from "./resolve-target";
export type { MdRequestTarget } from "./resolve-target";

/** The bare download flag, as `buildMarkdownPagePath` writes it into a `.md` URL. */
export const MARKDOWN_DOWNLOAD_PARAM = "download";

interface HandleMarkdownRequestParams {
  ctx: ExecutionContext;
  env: Env;
  render: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
  request: Request;
}

export interface MarkdownBranchParams extends HandleMarkdownRequestParams {
  wantsDownload: boolean;
}

async function serveCmsMarkdown({
  target,
  request,
  env,
  ctx,
  render,
  wantsDownload,
}: MarkdownBranchParams & { target: Extract<MdRequestTarget, { type: "cms" }> }) {
  const url = new URL(request.url);
  url.pathname = `/markdown/${target.collection}/${target.path}`;
  // The route handler reads both flags off its own URL, so the rewrite must keep the download one.
  url.search = wantsDownload
    ? `?locale=${target.locale}&${MARKDOWN_DOWNLOAD_PARAM}`
    : `?locale=${target.locale}`;

  return render(new Request(url, { headers: request.headers, method: "GET" }), env, ctx);
}

export async function handleMarkdownRequest({
  request,
  env,
  ctx,
  render,
}: HandleMarkdownRequestParams): Promise<Response | null> {
  const url = new URL(request.url);
  const target = resolveMdRequestTarget(url.pathname);
  if (!target) {
    return null;
  }

  // Read once, here: both branches rewrite the URL for their internal request and lose the query.
  const wantsDownload = url.searchParams.has(MARKDOWN_DOWNLOAD_PARAM);

  // Only the CMS branch charges a rate-limit bucket, and it does so in its own route handler. The
  // page branch needs no charge: `resolveMdRequestTarget` accepts an allowlist, so a flood reaches
  // warm keys instead of new work. Do not "fix" the asymmetry in either direction.

  // Both branches build a full GET response; the body is dropped once, here, so neither branch
  // carries its own HEAD rule.
  const response =
    target.type === "cms"
      ? await serveCmsMarkdown({ target, request, env, ctx, render, wantsDownload })
      : await (
          await import("./serve-page")
        ).servePageMarkdown({ target, request, env, ctx, render, wantsDownload });

  if (request.method === "HEAD") {
    // The body is dropped anyway, so the discovery relation goes straight onto the headers this
    // branch already has to build.
    const headers = new Headers(response.headers);
    applyLlmsDescribedByLink(headers);

    return new Response(null, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return withLlmsDescribedByLinkHeader({ response });
}
