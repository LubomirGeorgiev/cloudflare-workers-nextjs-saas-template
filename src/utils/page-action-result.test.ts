import { beforeEach, describe, expect, test, vi } from "vitest";

// A page render that awaits a server action must distinguish "your session is gone" from every
// other failure. Conflating them sent a signed-in user to `/sign-in` whenever the settings rate
// limit was exhausted, which reads as a broken session rather than a throttled request.

const { redirectToSignInMock } = vi.hoisted(() => ({ redirectToSignInMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/utils/auth-redirect", () => ({ redirectToSignIn: redirectToSignInMock }));

const { resolvePageAction } = await import("@/utils/page-action-result");

beforeEach(() => {
  redirectToSignInMock.mockReset();
  // `redirectToSignIn` never returns in the app; throwing mirrors that and keeps a missed
  // redirect from silently falling through to the assertions below.
  redirectToSignInMock.mockImplementation(() => {
    throw new Error("REDIRECTED");
  });
});

describe("resolvePageAction", () => {
  test("returns the action data on success", async () => {
    await expect(resolvePageAction({ data: [{ id: "key_1" }] })).resolves.toEqual({
      ok: true,
      data: [{ id: "key_1" }],
    });
    expect(redirectToSignInMock).not.toHaveBeenCalled();
  });

  test("redirects to sign-in only when the caller is unauthenticated", async () => {
    await expect(
      resolvePageAction({ serverError: { code: "NOT_AUTHORIZED", message: "nope" } }),
    ).rejects.toThrow("REDIRECTED");

    expect(redirectToSignInMock).toHaveBeenCalledTimes(1);
  });

  test("hands a rate limit back to the page with its message intact", async () => {
    const outcome = await resolvePageAction({
      serverError: { code: "RATE_LIMITED", message: "Rate limit exceeded. Try again in 3 minutes." },
    });

    // The retry window is the whole value of the message — it must survive to the rendered page.
    expect(outcome).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      message: "Rate limit exceeded. Try again in 3 minutes.",
    });
    expect(redirectToSignInMock).not.toHaveBeenCalled();
  });

  test.each(["FORBIDDEN", "NOT_FOUND", "INTERNAL_SERVER_ERROR"])(
    "hands a %s failure back to the page instead of redirecting to sign-in",
    async (code) => {
      const outcome = await resolvePageAction({ serverError: { code, message: `failed: ${code}` } });

      expect(outcome).toEqual({ ok: false, code, message: `failed: ${code}` });
      expect(redirectToSignInMock).not.toHaveBeenCalled();
    },
  );

  test("throws rather than redirecting when an action resolves with neither data nor error", async () => {
    await expect(resolvePageAction({})).rejects.toThrow(/without data/);
    expect(redirectToSignInMock).not.toHaveBeenCalled();
  });
});
