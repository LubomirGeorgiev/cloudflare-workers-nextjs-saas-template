import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { useRefreshActionToasts } from "./use-refresh-action-toasts";

const MESSAGES = { successMessage: "done", errorMessage: "fallback" };

describe("useRefreshActionToasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows the success toast and refreshes", () => {
    useRefreshActionToasts(MESSAGES).onSuccess();

    expect(mocks.toastSuccess).toHaveBeenCalledWith(MESSAGES.successMessage);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  test("refreshes after a refusal, so the page shows the state the action saved", () => {
    useRefreshActionToasts(MESSAGES).onError({ error: { serverError: { message: "refused" } } });

    expect(mocks.toastError).toHaveBeenCalledWith("refused");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  test("uses the fallback message when the error has no server message", () => {
    useRefreshActionToasts(MESSAGES).onError({ error: {} });

    expect(mocks.toastError).toHaveBeenCalledWith(MESSAGES.errorMessage);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
