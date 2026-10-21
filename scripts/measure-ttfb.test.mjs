import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

// Vitest resolves `@/`, plain Node does not, and CI runs this script with `continue-on-error`.
// Port 1 is a fetch-blocked port, so the run fails at once after the imports, with no network.
test("loads under plain Node", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./measure-ttfb.mjs", import.meta.url)), "http://127.0.0.1:1"],
    { encoding: "utf8" }
  );

  expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  expect(result.stdout).toContain("TTFB base=http://127.0.0.1:1");
});
