import { describe, expect, test } from "vitest";

import { getTeamSeatUsage } from "./team-seats";

describe("getTeamSeatUsage", () => {
  test("counts pending invitations as used seats", () => {
    expect(getTeamSeatUsage({ activeMembers: 1, pendingInvitations: 1, seats: 2 })).toMatchObject({
      used: 2,
      limit: 2,
      isFull: true,
    });
  });

  test("has a free seat while usage is below the limit", () => {
    expect(getTeamSeatUsage({ activeMembers: 1, pendingInvitations: 0, seats: 2 }).isFull).toBe(false);
  });

  test("stays full when a lowered limit is below current usage", () => {
    expect(getTeamSeatUsage({ activeMembers: 3, pendingInvitations: 0, seats: 2 }).isFull).toBe(true);
  });
});
