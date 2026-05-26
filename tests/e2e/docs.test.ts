import { test } from "vitest";
import { expectAppRole, expectAppText, loadAppFrame } from "./app-frame";

test("renders seeded docs navigation content from fresh D1 state", async () => {
  await loadAppFrame("/docs/getting-started/introduction");

  await expectAppRole("heading", "Introduction", { exact: true });
  await expectAppText(
    "Learn how this template is structured and how to ship your first feature quickly."
  );
});
