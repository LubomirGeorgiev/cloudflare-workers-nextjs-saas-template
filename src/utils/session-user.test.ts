import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

function readProjectFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("session user module boundaries", () => {
  test("keeps session snapshot loading outside auth", () => {
    const authSource = readProjectFile("./auth.ts");
    const creditsSource = readProjectFile("./credits.ts");
    const kvSessionSource = readProjectFile("./kv-session.ts");
    const sessionUserSource = readProjectFile("./session-user.ts");

    expect(sessionUserSource).toContain("export async function getUserFromDB");
    expect(sessionUserSource).toContain("export async function getUserTeamsWithPermissions");
    expect(authSource).toContain("from \"@/utils/credits\"");
    expect(authSource).toContain("from \"@/utils/session-user\"");
    expect(authSource).not.toContain("import(\"@/utils/credits\")");
    expect(creditsSource).not.toContain("from \"@/utils/auth\"");
    expect(kvSessionSource).toContain("from \"@/utils/session-user\"");
    expect(kvSessionSource).not.toContain("from \"@/utils/auth\"");
  });
});
