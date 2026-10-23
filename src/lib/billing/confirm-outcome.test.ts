import { describe, expect, test } from "vitest";

import { classifyConfirmedIntentStatus, getMicrodepositVerificationUrl } from "./confirm-outcome";

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

describe("getMicrodepositVerificationUrl", () => {
  test("reads the hosted verification page of a microdeposit next action", () => {
    const url = "https://payments.stripe.com/microdeposit/test";
    const nextAction = {
      type: "verify_with_microdeposits",
      verify_with_microdeposits: { arrival_date: 0, hosted_verification_url: url, microdeposit_type: "descriptor_code" },
    } as const;

    expect(getMicrodepositVerificationUrl({ next_action: nextAction })).toBe(url);
  });

  test("returns null for any other next action", () => {
    expect(getMicrodepositVerificationUrl({ next_action: null })).toBeNull();
    expect(getMicrodepositVerificationUrl({ next_action: { type: "redirect_to_url" } })).toBeNull();
  });
});
