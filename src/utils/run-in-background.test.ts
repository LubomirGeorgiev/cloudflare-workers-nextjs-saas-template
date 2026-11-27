import { afterEach, describe, expect, test, vi } from "vitest";

const { waitUntilMock } = vi.hoisted(() => ({ waitUntilMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("cloudflare:workers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("cloudflare:workers")>()),
  waitUntil: waitUntilMock,
}));

const { runInBackground } = await import("@/utils/run-in-background");

const OPERATION = "test.background_task";

describe("runInBackground", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    waitUntilMock.mockReset();
  });

  test("logs one structured line with the operation and no error text", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = "user@example.com";

    runInBackground({ operation: OPERATION, promise: Promise.reject(new TypeError(secret)) });
    await waitUntilMock.mock.calls[0]?.[0];

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const [line] = consoleErrorSpy.mock.calls[0] ?? [];
    expect(JSON.parse(String(line))).toMatchObject({ operation: OPERATION, errorName: "TypeError" });
    expect(String(line)).not.toContain(secret);
  });

  test("logs nothing when the task succeeds", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    runInBackground({ operation: OPERATION, promise: Promise.resolve() });
    await waitUntilMock.mock.calls[0]?.[0];

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test("does not throw without a request context", () => {
    waitUntilMock.mockImplementation(() => {
      throw new Error("no request context");
    });

    expect(() => runInBackground({ operation: OPERATION, promise: Promise.resolve() })).not.toThrow();
  });
});
