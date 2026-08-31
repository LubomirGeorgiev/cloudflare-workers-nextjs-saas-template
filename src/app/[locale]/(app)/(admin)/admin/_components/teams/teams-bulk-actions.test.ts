import { describe, expect, it } from "vitest"

import type { Team } from "./columns"
import { toTeamsCsv } from "./teams-bulk-actions"

function buildTeam(overrides: Partial<Team>): Team {
  return {
    id: "team_1",
    name: "Acme",
    slug: "acme",
    description: null,
    planId: "free",
    subscriptionStatus: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    memberCount: 2,
    members: [],
    ...overrides,
  }
}

describe("toTeamsCsv", () => {
  it("writes the column header and one row per team", () => {
    const csv = toTeamsCsv([buildTeam({ id: "team_1", name: "Acme", memberCount: 3 })])

    expect(csv.split("\n")).toEqual([
      '"id","name","slug","members","plan","subscriptionStatus"',
      '"team_1","Acme","acme","3","free",""',
    ])
  })

  it("neutralizes a formula in a customer-chosen team name", () => {
    const csv = toTeamsCsv([buildTeam({ name: "=1+1" })])

    expect(csv).toContain('"\'=1+1"')
    expect(csv).not.toContain('"=1+1"')
  })
})
