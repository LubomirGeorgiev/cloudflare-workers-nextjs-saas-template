import "server-only";

interface BoundedRequestBody {
  /** True when the body was larger than the cap; nothing past the cap was ever buffered. */
  exceededLimit: boolean;
  /** Decoded UTF-8, or null when the body was over the cap or is not valid UTF-8. */
  text: string | null;
}

/**
 * Reads at most `maxBytes` of an attacker-controlled request body. The declared `content-length` is
 * only a fast path — a chunked request can omit or lie about it, so the streamed read is the actual
 * bound. Operates on a clone, leaving the caller's request body intact.
 */
export async function readBoundedRequestBody({
  request,
  maxBytes,
}: {
  request: Request;
  maxBytes: number;
}): Promise<BoundedRequestBody> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { exceededLimit: true, text: null };
  }

  const body = request.clone().body;
  if (!body) {
    return { exceededLimit: false, text: "" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      void reader.cancel().catch(() => undefined);
      return { exceededLimit: true, text: null };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { exceededLimit: false, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { exceededLimit: false, text: null };
  }
}
