import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isInvitationPending } = await import("./team-writes");

const NOW = new Date("2026-06-01T12:00:00.000Z");
const SECOND = 1000;

// The SQL form compares unix seconds with `"expiresAt" > now`, so these cases pin the JS form to it.
describe("isInvitationPending", () => {
  test.each([
    { name: "an unaccepted invitation before its expiry", acceptedAt: null, expiresAt: new Date(NOW.getTime() + SECOND), pending: true },
    { name: "an invitation that expires this second", acceptedAt: null, expiresAt: new Date(NOW.getTime() + SECOND - 1), pending: false },
    { name: "an invitation at its expiry", acceptedAt: null, expiresAt: NOW, pending: false },
    { name: "an expired invitation", acceptedAt: null, expiresAt: new Date(NOW.getTime() - SECOND), pending: false },
    { name: "an accepted invitation", acceptedAt: NOW, expiresAt: new Date(NOW.getTime() + SECOND), pending: false },
    { name: "an invitation with no expiry", acceptedAt: null, expiresAt: null, pending: false },
  ])("returns $pending for $name", ({ acceptedAt, expiresAt, pending }) => {
    expect(isInvitationPending({ invitation: { acceptedAt, expiresAt }, now: NOW })).toBe(pending);
  });
});
