import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE } from "@/i18n/config";
import { getTeamInvitePath, getTeamInviteSignInPath, isTeamInviteRedirect } from "./team-invite-links";

describe("team invite links", () => {
  test("the sign-in path returns to the invite with its token", () => {
    const signInPath = getTeamInviteSignInPath("tok+en/1");
    const redirect = new URL(signInPath, "https://example.test").searchParams.get("redirect");

    expect(redirect).toBe(getTeamInvitePath("tok+en/1"));
    expect(new URL(redirect ?? "", "https://example.test").searchParams.get("token")).toBe("tok+en/1");
  });

  test("detects an invite return path, also with a locale prefix", () => {
    expect(isTeamInviteRedirect(getTeamInvitePath("abc"))).toBe(true);
    expect(isTeamInviteRedirect(`/${DEFAULT_LOCALE}${getTeamInvitePath("abc")}`)).toBe(true);
    expect(isTeamInviteRedirect("/dashboard")).toBe(false);
    expect(isTeamInviteRedirect("/team-invite-other")).toBe(false);
  });
});
