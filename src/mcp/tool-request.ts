import { JSON_CONTENT_TYPE } from "@/lib/api/openapi-walk";
import type { McpToolDescriptor } from "@/mcp/derive-tools";
import { WRAPPED_BODY_ARGUMENT } from "@/mcp/derive-tools";

// Translation between one flat tool-argument object and the HTTP request the REST layer expects,
// plus the reverse mapping of a response into MCP content. Kept pure and runtime-free so the whole
// wire contract is unit-testable without a Worker.

interface ToolContentBlock {
  type: "text";
  text: string;
}

interface ToolCallResult {
  content: ToolContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function fillPathTemplate({
  path,
  pathParams,
  args,
}: {
  path: string;
  pathParams: string[];
  args: Record<string, unknown>;
}): string {
  return pathParams.reduce(
    (filled, name) => filled.replace(`{${name}}`, encodeURIComponent(String(args[name] ?? ""))),
    path,
  );
}

function bodyFor({
  descriptor,
  args,
}: {
  descriptor: McpToolDescriptor;
  args: Record<string, unknown>;
}): string | undefined {
  if (descriptor.wrapsBody) {
    return JSON.stringify(args[WRAPPED_BODY_ARGUMENT] ?? null);
  }

  if (descriptor.bodyParams.length === 0) {
    return undefined;
  }

  const body = Object.fromEntries(
    descriptor.bodyParams.filter((name) => args[name] !== undefined).map((name) => [name, args[name]]),
  );

  // A method with a documented body always sends one, even when every field is optional and
  // omitted: the route's validator expects a JSON document, not an empty request.
  return JSON.stringify(body);
}

export function buildToolRequest({
  descriptor,
  args,
  origin,
}: {
  descriptor: McpToolDescriptor;
  args: Record<string, unknown>;
  origin: string;
}): Request {
  const url = new URL(fillPathTemplate({ path: descriptor.path, pathParams: descriptor.pathParams, args }), origin);

  for (const name of descriptor.queryParams) {
    const value = args[name];
    if (value !== undefined && value !== null) {
      url.searchParams.set(name, String(value));
    }
  }

  const body = bodyFor({ descriptor, args });

  return new Request(url, {
    method: descriptor.method,
    headers: body === undefined ? {} : { "content-type": JSON_CONTENT_TYPE },
    body,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Machine-facing text, deliberately untranslated: the agent reading it is not a locale.
function retryAfterSentence(retryAfter: unknown): string | undefined {
  if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter)) {
    return undefined;
  }

  return `Retry after ${retryAfter} ${retryAfter === 1 ? "second" : "seconds"}.`;
}

// Problem documents keep their stable `code` in the text an agent reads, so a model can react to
// a missing scope or a rate limit instead of guessing from prose.
function describeProblem({ status, payload }: { status: number; payload: unknown }): string {
  if (!isPlainObject(payload)) {
    return `Request failed with HTTP ${status}.`;
  }

  const parts = [`${payload.code ?? "ERROR"} (HTTP ${status})`];

  // The retry delay continues the detail sentence rather than becoming its own `: ` segment.
  const message = [
    typeof payload.detail === "string" ? payload.detail : undefined,
    retryAfterSentence(payload.retryAfter),
  ]
    .filter((sentence) => sentence !== undefined)
    .join(" ");
  if (message) {
    parts.push(message);
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    parts.push(`Invalid fields: ${JSON.stringify(payload.errors)}`);
  }

  return parts.join(": ");
}

export async function toToolResult({
  descriptor,
  response,
}: {
  descriptor: McpToolDescriptor;
  response: Response;
}): Promise<ToolCallResult> {
  const raw = await response.text();
  let payload: unknown = raw;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    // A non-JSON body can only come from an unexpected failure; surface it verbatim.
  }

  if (!response.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: describeProblem({ status: response.status, payload }) }],
    };
  }

  return {
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }],
    // Declared output schemas are validated by the SDK before the result leaves the server, so
    // structured content is attached only where the operation documents an object response.
    ...(descriptor.outputSchema && isPlainObject(payload) ? { structuredContent: payload } : {}),
  };
}
