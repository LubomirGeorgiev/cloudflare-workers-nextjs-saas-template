import { describe, expect, it } from "vitest";

import { MAX_EMAIL_DOMAIN_LABELS } from "@/constants";
import {
  BLOCKED_EMAIL_KINDS,
  buildEmailMatchCandidates,
  buildUserEmailFilter,
  isValidEmailPattern,
  parseEmailPattern,
} from "@/utils/email-pattern";

describe("parseEmailPattern", () => {
  it("parses an exact address", () => {
    expect(parseEmailPattern("  Spam@Example.com ")).toEqual({
      kind: BLOCKED_EMAIL_KINDS.EMAIL,
      value: "spam@example.com",
      pattern: "spam@example.com",
    });
  });

  it("parses a whole domain", () => {
    expect(parseEmailPattern("*@Example.com")).toEqual({
      kind: BLOCKED_EMAIL_KINDS.DOMAIN,
      value: "example.com",
      pattern: "*@example.com",
    });
  });

  it("parses a domain and its subdomains, storing the apex", () => {
    expect(parseEmailPattern("*@*.example.com")).toEqual({
      kind: BLOCKED_EMAIL_KINDS.DOMAIN_SUFFIX,
      value: "example.com",
      pattern: "*@*.example.com",
    });
  });

  it.each([
    ["a bare domain", "example.com"],
    ["a partial local wildcard", "ad*@example.com"],
    ["a lone wildcard", "*"],
    ["a wildcard with no domain", "*@"],
    ["an empty local part", "@example.com"],
    ["a single-label domain", "*@localhost"],
    ["a single-label subdomain wildcard", "*@*.com"],
    ["an empty label", "*@example..com"],
    ["a domain-only wildcard in the middle", "*@mail.*.example.com"],
    ["empty input", "   "],
  ])("rejects %s", (_case, pattern) => {
    expect(parseEmailPattern(pattern)).toBeNull();
    expect(isValidEmailPattern(pattern)).toBe(false);
  });

  it("rejects a domain with more labels than the cap", () => {
    const tooDeep = `${Array.from({ length: MAX_EMAIL_DOMAIN_LABELS + 1 }, () => "a").join(".")}`;

    expect(parseEmailPattern(`*@${tooDeep}`)).toBeNull();
  });
});

describe("buildUserEmailFilter", () => {
  // The users list filters by substring, so each value must keep exactly the accounts the
  // matching-count query counted for that kind.
  it.each([
    ["an exact address, the whole address", "spam@example.com", "spam@example.com"],
    ["a whole domain, only after the @", "*@example.com", "@example.com"],
    ["a domain suffix, the apex so subdomains stay in", "*@*.example.com", "example.com"],
  ])("keeps %s", (_case, pattern, expected) => {
    const parsed = parseEmailPattern(pattern);

    expect(parsed).not.toBeNull();
    expect(buildUserEmailFilter(parsed!)).toBe(expected);
  });
});

describe("buildEmailMatchCandidates", () => {
  it("builds the address, the domain, and every parent suffix down to the apex", () => {
    expect(buildEmailMatchCandidates("Bob@Mail.EU.example.com")).toEqual({
      address: "bob@mail.eu.example.com",
      domain: "mail.eu.example.com",
      domainSuffixes: ["mail.eu.example.com", "eu.example.com", "example.com"],
    });
  });

  it("includes the apex itself for a two-label domain", () => {
    expect(buildEmailMatchCandidates("bob@example.com")?.domainSuffixes).toEqual(["example.com"]);
  });

  it("returns null for anything that is not an address", () => {
    expect(buildEmailMatchCandidates("not-an-address")).toBeNull();
    expect(buildEmailMatchCandidates("@example.com")).toBeNull();
  });

  it("never generates a suffix longer than a stored pattern could be", () => {
    const domain = Array.from({ length: MAX_EMAIL_DOMAIN_LABELS + 4 }, (_value, index) => `l${index}`)
      .join(".");
    const candidates = buildEmailMatchCandidates(`bob@${domain}`);

    expect(candidates?.domainSuffixes.length).toBe(MAX_EMAIL_DOMAIN_LABELS - 1);
    for (const suffix of candidates?.domainSuffixes ?? []) {
      expect(suffix.split(".").length).toBeLessThanOrEqual(MAX_EMAIL_DOMAIN_LABELS);
    }
  });
});
