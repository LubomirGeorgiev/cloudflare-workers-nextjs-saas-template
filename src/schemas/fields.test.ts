import { describe, expect, test } from "vitest";

import { RETURN_TO_MAX_LENGTH, TEAM_INVITE_PATH } from "@/constants";
import { v } from "@/lib/validation";
import { returnToField } from "@/schemas/fields";
import { signUpSchema } from "@/schemas/signup.schema";

const INVITE_RETURN_PATH = `${TEAM_INVITE_PATH}?token=invite-token`;

function pathOfLength(length: number): string {
  return `/${"a".repeat(length - 1)}`;
}

describe("returnToField", () => {
  test("keeps a path at the maximum length", () => {
    const path = pathOfLength(RETURN_TO_MAX_LENGTH);

    expect(v.parse(returnToField(), path)).toBe(path);
  });

  test("drops a path over the maximum length instead of failing", () => {
    expect(v.parse(returnToField(), pathOfLength(RETURN_TO_MAX_LENGTH + 1))).toBeUndefined();
  });

  test("drops a value that is not a string", () => {
    expect(v.parse(returnToField(), 42)).toBeUndefined();
  });

  test("leaves an absent value absent", () => {
    expect(v.parse(returnToField(), undefined)).toBeUndefined();
  });
});

describe("signUpSchema returnTo", () => {
  const signUpInput = {
    email: "return-to@example.com",
    firstName: "Return",
    lastName: "Path",
    password: "correct horse battery staple",
  };

  test("passes the return path through", () => {
    const result = v.safeParse(signUpSchema, { ...signUpInput, returnTo: INVITE_RETURN_PATH });

    expect(result.success && result.output.returnTo).toBe(INVITE_RETURN_PATH);
  });

  test("still accepts a sign-up with an oversized return path", () => {
    const result = v.safeParse(signUpSchema, {
      ...signUpInput,
      returnTo: pathOfLength(RETURN_TO_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(true);
    expect(result.success && result.output.returnTo).toBeUndefined();
  });
});
