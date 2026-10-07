import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  requireVerifiedEmailMock,
  updateAllSessionsOfUserMock,
  batchMock,
  invalidateCmsAuthorMock,
  runInBackgroundMock,
} = vi.hoisted(() => ({
  requireVerifiedEmailMock: vi.fn(),
  updateAllSessionsOfUserMock: vi.fn(),
  batchMock: vi.fn(),
  invalidateCmsAuthorMock: vi.fn(),
  runInBackgroundMock: vi.fn(),
}));

const setMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("@/db/schema", () => ({ userTable: { id: "user.id" } }));
vi.mock("@/db", () => ({
  getDB: () => ({
    batch: batchMock,
    select: () => ({ from: () => ({ where: () => "select" }) }),
    update: () => ({
      set: setMock.mockReturnValue({ where: () => ({ returning: () => "update" }) }),
    }),
  }),
}));
vi.mock("@/lib/action-error", () => ({
  ActionError: class extends Error {
    constructor(public code: string, public details?: { key?: string }) {
      super(code);
    }
  },
}));
vi.mock("@/utils/auth", () => ({ requireVerifiedEmail: requireVerifiedEmailMock }));
vi.mock("@/utils/kv-session", () => ({ updateAllSessionsOfUser: updateAllSessionsOfUserMock }));
vi.mock("@/lib/cms/cms-author-cache-invalidation", () => ({
  invalidateCmsAuthorAfterUserWrite: invalidateCmsAuthorMock,
}));
vi.mock("@/utils/run-in-background", () => ({ runInBackground: runInBackgroundMock }));

const { updateUserProfile } = await import("./profile");
// Real schema so the test tracks the profile fields the template actually accepts.
const { userSettingsSchema } = await import("@/schemas/settings.schema");
const { v } = await import("@/lib/validation");

const USER_ID = "usr_test";
const input = v.parse(userSettingsSchema, { firstName: "Ada", lastName: "Lovelace" });
const updatedRow = { id: USER_ID, ...input, email: "ada@example.com" };
const previousRow = { ...updatedRow, firstName: "Old" };

describe("updateUserProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireVerifiedEmailMock.mockResolvedValue({ user: { id: USER_ID } });
    batchMock.mockResolvedValue([[previousRow], [updatedRow]]);
    updateAllSessionsOfUserMock.mockResolvedValue(undefined);
    invalidateCmsAuthorMock.mockResolvedValue(undefined);
  });

  test("returns the post-write row from D1, not the submitted input", async () => {
    const result = await updateUserProfile(input);

    expect(setMock).toHaveBeenCalledWith(input);
    expect(result).toEqual({ success: true, user: updatedRow });
  });

  test("hands the row before and after the write to the CMS author purge", async () => {
    await updateUserProfile(input);

    expect(batchMock).toHaveBeenCalledWith(["select", "update"]);
    expect(invalidateCmsAuthorMock).toHaveBeenCalledWith({
      userId: USER_ID,
      before: previousRow,
      after: updatedRow,
    });
  });

  test("runs the CMS author purge in the background and does not wait for it", async () => {
    const pendingPurge = new Promise<void>(() => {});
    invalidateCmsAuthorMock.mockReturnValue(pendingPurge);

    await expect(updateUserProfile(input)).resolves.toEqual({ success: true, user: updatedRow });
    expect(runInBackgroundMock).toHaveBeenCalledWith(pendingPurge);
  });

  test("still succeeds when the post-commit session refresh throws", async () => {
    // The D1 write is already durable (no transactions on D1), so a KV failure afterwards must
    // not be reported to the caller as a failed update.
    updateAllSessionsOfUserMock.mockRejectedValue(new Error("kv unavailable"));

    await expect(updateUserProfile(input)).resolves.toEqual({ success: true, user: updatedRow });
  });

  test("fails when the D1 update itself throws", async () => {
    batchMock.mockRejectedValue(new Error("d1 unavailable"));

    await expect(updateUserProfile(input)).rejects.toThrow();
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
    expect(invalidateCmsAuthorMock).not.toHaveBeenCalled();
    expect(runInBackgroundMock).not.toHaveBeenCalled();
  });

  test("fails when the row vanished before the update landed", async () => {
    batchMock.mockResolvedValue([[], []]);

    await expect(updateUserProfile(input)).rejects.toThrow();
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
    expect(invalidateCmsAuthorMock).not.toHaveBeenCalled();
    expect(runInBackgroundMock).not.toHaveBeenCalled();
  });
});
