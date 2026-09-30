import { afterEach, describe, expect, test, vi } from "vitest";
import { notFound, permanentRedirect, redirect, RedirectType } from "next/navigation";

import { ActionError } from "@/lib/action-error";
import { v } from "@/lib/validation";

const { enteredSpans, fakeSpan, spanAttributes } = vi.hoisted(() => {
  const attributes = new Map<string, unknown>();
  const span = {
    isTraced: true,
    recordException: vi.fn(),
    setAttribute: vi.fn((key: string, value: unknown) => {
      attributes.set(key, value);

      return span;
    }),
  };

  return {
    enteredSpans: [] as string[],
    fakeSpan: span,
    spanAttributes: attributes,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/i18n/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

// Pass-through, like the runtime: the real `withSpan` runs, so its exception policy is under test.
vi.mock("cloudflare:workers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  tracing: {
    enterSpan: (name: string, callback: (span: unknown) => unknown) => {
      enteredSpans.push(name);

      return callback(fakeSpan);
    },
  },
}));

// The real module pulls in KV and header access; only the error class matters here.
vi.mock("@/utils/with-rate-limit", () => ({
  RateLimitError: class RateLimitError extends Error {
    readonly retryAfterSeconds: number;

    constructor(retryAfterSeconds: number) {
      super("Rate limit exceeded.");
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
}));

const { actionClient } = await import("@/lib/safe-action");
const { RateLimitError } = await import("@/utils/with-rate-limit");

const ACTION_SPAN_NAME = "app.action";
const OUTCOME_ATTRIBUTE = "app.action.outcome";
const NAME_ATTRIBUTE = "app.action.name";
const ACTION_EXPORT_NAME = "updateThingAction";
const namedClient = actionClient.metadata({ actionName: ACTION_EXPORT_NAME });

const inputSchema = v.object({ name: v.pipe(v.string(), v.minLength(1), v.maxLength(10)) });

describe("actionClient span", () => {
  afterEach(() => {
    enteredSpans.length = 0;
    spanAttributes.clear();
    vi.clearAllMocks();
  });

  test("tags a successful action with its metadata name and an ok outcome", async () => {
    const action = namedClient.inputSchema(inputSchema).action(async () => ({ saved: true }));

    await expect(action({ name: "a" })).resolves.toEqual({ data: { saved: true } });

    expect(enteredSpans).toEqual([ACTION_SPAN_NAME]);
    expect(spanAttributes.get(NAME_ATTRIBUTE)).toBe(ACTION_EXPORT_NAME);
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("ok");
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
  });

  test("tags invalid input as a validation error and keeps the client error shape", async () => {
    const action = namedClient.inputSchema(inputSchema).action(async () => ({ saved: true }));

    const result = await action({ name: "" });

    expect(result.serverError?.code).toBe("INPUT_PARSE_ERROR");
    expect(result.validationErrors).toBeUndefined();
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("validation_error");
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
  });

  test("tags an expected ActionError with its stable code, without an exception", async () => {
    const code = "NOT_AUTHORIZED";
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const action = namedClient.action(async () => {
      throw new ActionError(code, "denied");
    });

    const result = await action();

    expect(result.serverError?.code).toBe(code);
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(code);
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledOnce();
    expect(consoleWarn.mock.calls[0]?.[1]).toMatchObject({ action: ACTION_EXPORT_NAME, code });
    expect(consoleError).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  test("tags a rate limit as rate_limited, without an exception", async () => {
    const action = namedClient.action(async () => {
      throw new RateLimitError(60);
    });

    const result = await action();

    expect(result.serverError?.code).toBe("RATE_LIMITED");
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("rate_limited");
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
  });

  test("tags an unexpected error as internal_error and records it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new Error("database down");
    const action = namedClient.action(async () => {
      throw failure;
    });

    const result = await action();

    expect(result.serverError?.code).toBe("INTERNAL_SERVER_ERROR");
    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("internal_error");
    expect(fakeSpan.recordException).toHaveBeenCalledWith(
      expect.objectContaining({ name: failure.name, message: failure.message }),
    );
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  test("tags a thrown ActionError INTERNAL_SERVER_ERROR by its code, not as internal_error", async () => {
    const code = "INTERNAL_SERVER_ERROR";
    const action = namedClient.action(async () => {
      throw new ActionError(code, "wrapped");
    });

    await action();

    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe(code);
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
  });

  test("tags a navigation and still rethrows it", async () => {
    const action = namedClient.action(async () => {
      notFound();
    });

    await expect(action()).rejects.toHaveProperty("digest");

    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("navigation");
    expect(spanAttributes.get("app.action.navigation_kind")).toBe("notFound");
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
  });

  // vinext and next-safe-action each parse the redirect digest; both must agree it is a redirect.
  test.each([
    { name: "redirect()", navigate: () => redirect(REDIRECT_TARGET) },
    { name: "redirect(push)", navigate: () => redirect(REDIRECT_TARGET, RedirectType.push) },
    { name: "permanentRedirect()", navigate: () => permanentRedirect(REDIRECT_TARGET) },
  ])("tags $name as a redirect and still rethrows it", async ({ navigate }) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const action = namedClient.action(async () => {
      navigate();
    });

    await expect(action()).rejects.toHaveProperty(
      "digest",
      expect.stringMatching(/^NEXT_REDIRECT;/),
    );

    expect(spanAttributes.get(OUTCOME_ATTRIBUTE)).toBe("navigation");
    expect(spanAttributes.get("app.action.navigation_kind")).toBe("redirect");
    expect(fakeSpan.recordException).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

const REDIRECT_TARGET = "/dashboard";
