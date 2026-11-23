import { afterEach, describe, expect, test, vi } from "vitest";

const { fakeSpan, waitUntilMock } = vi.hoisted(() => ({
  fakeSpan: { isTraced: true, recordException: vi.fn(), setAttribute: vi.fn() },
  waitUntilMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

// The real `withSpan` runs on a fake span, so the test sees what reaches the trace.
vi.mock("cloudflare:workers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("cloudflare:workers")>()),
  tracing: {
    enterSpan: (_name: string, callback: (span: unknown) => unknown) => callback(fakeSpan),
  },
  waitUntil: waitUntilMock,
}));

const { writeKvInBackground } = await import("@/utils/background-kv-write");

const OPERATION = "test.write";

describe("writeKvInBackground", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    waitUntilMock.mockReset();
  });

  test("starts the write at once and logs nothing when it lands", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const write = vi.fn(async () => undefined);

    writeKvInBackground({ operation: OPERATION, write });

    expect(write).toHaveBeenCalledOnce();
    await settleBackgroundWrite();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
  });

  test("logs and traces a failed write as an upstream error, without the error message", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secretText = "key rate-limit:session:203.0.113.7";

    writeKvInBackground({ operation: OPERATION, write: () => Promise.reject(new TypeError(secretText)) });
    await settleBackgroundWrite();

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const line = String(consoleErrorSpy.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({
      provider: "kv",
      operation: OPERATION,
      outcome: "upstream_error",
      statusCode: null,
      errorName: "TypeError",
    });
    expect(line).not.toContain(secretText);
    expect(fakeSpan.setAttribute).toHaveBeenCalledWith("app.kv.outcome", "upstream_error");
    expect(fakeSpan.recordException).toHaveBeenCalledOnce();
    const exception = fakeSpan.recordException.mock.calls[0][0];
    expect(exception).toMatchObject({ name: "TypeError" });
    expect(JSON.stringify(exception)).not.toContain(secretText);
  });
});

async function settleBackgroundWrite(): Promise<void> {
  expect(waitUntilMock).toHaveBeenCalledOnce();
  await waitUntilMock.mock.calls[0][0];
}
