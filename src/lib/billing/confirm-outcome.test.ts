import { describe, expect, test } from "vitest";

import { classifyConfirmedIntentStatus } from "./confirm-outcome";

describe("classifyConfirmedIntentStatus", () => {
  test.each(["succeeded", "processing"] as const)("sends a %s intent on to the parent", (status) => {
    expect(classifyConfirmedIntentStatus(status)).toBe("success");
  });

  // A closed Cash App Pay QR modal leaves the intent in "requires_action" with no error.
  test.each([
    "requires_action",
    "requires_payment_method",
    "requires_confirmation",
    "requires_capture",
    "canceled",
  ] as const)("keeps the dialog open for a %s intent", (status) => {
    expect(classifyConfirmedIntentStatus(status)).toBe("cancel");
  });
});
