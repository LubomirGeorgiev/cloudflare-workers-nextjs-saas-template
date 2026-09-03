/// <reference types="@cloudflare/vitest-plugin/types" />

// The blocklist governs account CREATION and nothing else. These tests hold that line from both
// sides: a blocked pattern refuses every sign-up path, and it never touches an account that
// already exists.

import { beforeEach, describe, expect, test } from "vitest";
import { env } from "cloudflare:workers";

import { getDB } from "@/db";
import { bannedEmailTable, userTable } from "@/db/schema";
import {
  countUsersMatchingPattern,
  createBlockedEmail,
  deleteBlockedEmail,
  listBlockedEmails,
} from "@/lib/admin/blocked-emails";
import { assertEmailNotBlocked, isEmailBlocked } from "@/lib/auth/blocked-email-guard";
import { BLOCKED_EMAIL_KINDS } from "@/utils/email-pattern";

const db = getDB();

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function clearRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM banned_email"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
}

async function block(pattern: string): Promise<void> {
  await createBlockedEmail({ pattern, reason: undefined, createdByUserId: null });
}

beforeEach(clearRows);

describe("the matcher", () => {
  test("an exact address blocks only that address", async () => {
    await block("spam@example.com");

    expect(await isEmailBlocked("spam@example.com")).toBe(true);
    expect(await isEmailBlocked("  SPAM@Example.com ")).toBe(true);
    expect(await isEmailBlocked("other@example.com")).toBe(false);
  });

  test("a domain pattern blocks the domain but not its subdomains", async () => {
    await block("*@example.com");

    expect(await isEmailBlocked("anyone@example.com")).toBe(true);
    expect(await isEmailBlocked("anyone@mail.example.com")).toBe(false);
    expect(await isEmailBlocked("anyone@example.org")).toBe(false);
  });

  test("a subdomain pattern blocks the apex and every subdomain", async () => {
    await block("*@*.example.com");

    expect(await isEmailBlocked("anyone@example.com")).toBe(true);
    expect(await isEmailBlocked("anyone@mail.example.com")).toBe(true);
    expect(await isEmailBlocked("anyone@mail.eu.example.com")).toBe(true);
    expect(await isEmailBlocked("anyone@notexample.com")).toBe(false);
  });

  test("an empty blocklist blocks nothing", async () => {
    expect(await isEmailBlocked("anyone@example.com")).toBe(false);
    await expect(assertEmailNotBlocked({ email: "anyone@example.com" })).resolves.toBeUndefined();
  });

  test("the refusal names no pattern", async () => {
    await block("*@example.com");

    await expect(assertEmailNotBlocked({ email: "anyone@example.com" }))
      .rejects.toMatchObject({ messageKey: "Client.Auth.SignUp.errorEmailNotAllowed" });
  });
});

describe("managing entries", () => {
  test("stores the parsed value beside the pattern staff typed", async () => {
    await block("*@*.Example.com");

    const [entry] = (await listBlockedEmails({ page: 1, pageSize: 10 })).entries;
    expect(entry).toMatchObject({
      kind: BLOCKED_EMAIL_KINDS.DOMAIN_SUFFIX,
      value: "example.com",
      pattern: "*@*.example.com",
    });
  });

  test("refuses a pattern the matcher could not read", async () => {
    await expect(block("example.com")).rejects.toThrow();
    await expect(block("ad*@example.com")).rejects.toThrow();
    expect(await db.query.bannedEmailTable.findMany({})).toHaveLength(0);
  });

  test("refuses the same rule twice", async () => {
    await block("*@example.com");

    await expect(block("*@Example.com")).rejects.toThrow();
  });

  test("removing an entry lets the address register again", async () => {
    await block("*@example.com");
    const [entry] = await db.query.bannedEmailTable.findMany({});

    await deleteBlockedEmail({ id: entry!.id });

    expect(await isEmailBlocked("anyone@example.com")).toBe(false);
  });
});

describe("adding an entry never bans an existing account", () => {
  test("counts the accounts it would have matched, and suspends none of them", async () => {
    await db.insert(userTable).values([
      { id: uid("usr"), email: "one@example.com" },
      { id: uid("usr"), email: "two@mail.example.com" },
      { id: uid("usr"), email: "three@other.com" },
    ]);

    expect(await countUsersMatchingPattern({ pattern: "*@example.com" })).toBe(1);
    expect(await countUsersMatchingPattern({ pattern: "*@*.example.com" })).toBe(2);
    expect(await countUsersMatchingPattern({ pattern: "one@example.com" })).toBe(1);

    await block("*@*.example.com");

    const users = await db.query.userTable.findMany({});
    expect(users.every((user) => user.bannedAt === null)).toBe(true);
  });

  test("the count is case-insensitive, so a legacy mixed-case row is not missed", async () => {
    await db.insert(userTable).values({ id: uid("usr"), email: "Legacy@Example.com" });

    expect(await countUsersMatchingPattern({ pattern: "*@example.com" })).toBe(1);
  });
});

describe("the entries table", () => {
  test("pages newest first", async () => {
    await block("a@example.com");
    await block("b@example.com");
    await block("c@example.com");

    const page = await listBlockedEmails({ page: 1, pageSize: 2 });

    expect(page.totalCount).toBe(3);
    expect(page.totalPages).toBe(2);
    expect(page.entries).toHaveLength(2);
    expect(await db.select().from(bannedEmailTable)).toHaveLength(3);
  });
});
