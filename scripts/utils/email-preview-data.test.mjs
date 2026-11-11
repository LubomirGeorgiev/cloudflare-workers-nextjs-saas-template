import { describe, expect, test } from "vitest";

import { EMAIL_TEMPLATE_TYPES, emailSendJobPayloadSchema } from "@/lib/scheduler/jobs";
import { v } from "@/lib/validation";

import { PREVIEW_DATA } from "./email-preview-data.mjs";

describe("PREVIEW_DATA", () => {
  test("has a fixture for every email template, and no other key", () => {
    expect(Object.keys(PREVIEW_DATA).toSorted()).toEqual(Object.keys(EMAIL_TEMPLATE_TYPES).toSorted());
  });

  // The queue payload schema is the real contract, so a fixture cannot drift from the template.
  test.each(Object.entries(EMAIL_TEMPLATE_TYPES))("the %s fixture is a valid queue payload", (key, template) => {
    const result = v.safeParse(emailSendJobPayloadSchema, {
      to: "preview@example.com",
      template,
      data: PREVIEW_DATA[key],
    });

    expect(result.issues).toBeUndefined();
  });
});
