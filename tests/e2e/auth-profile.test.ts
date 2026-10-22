import { describe, test } from "vitest";
import {
  clickAppRole,
  expectAppLabelValue,
  expectAppRoleText,
  expectAppText,
  expectAppTextCount,
  expectAppToast,
  expectNoAppText,
  fillAppLabel,
  navigateAppFrame,
} from "./app-frame";
import {
  createVerifiedUserInLocalD1,
  DEFAULT_MESSAGES,
  NAME_MIN_LENGTH_MESSAGE,
  SEEDED_USER_PASSWORD,
  signInSeededMember,
  signInWithPassword,
  tooShort,
} from "./auth-helpers";
import { NAME_MIN_LENGTH } from "../../src/constants";

const PROFILE_COPY = DEFAULT_MESSAGES.Client.Settings.Profile;

describe("profile settings", () => {
  test("validates profile settings before saving", async () => {
    await signInSeededMember("/settings");
    await navigateAppFrame("/settings", { waitForHydration: true });

    await expectAppText(PROFILE_COPY.cardTitle, { exact: true });
    await fillAppLabel({ label: PROFILE_COPY.firstNameLabel, value: tooShort(NAME_MIN_LENGTH) });
    await fillAppLabel({ label: PROFILE_COPY.lastNameLabel, value: tooShort(NAME_MIN_LENGTH) });
    await clickAppRole("button", PROFILE_COPY.saveButton);

    // Both name fields share the central `Validation.minLength` message, so expect it
    // to render once per invalid field rather than field-specific copy.
    await expectAppTextCount(NAME_MIN_LENGTH_MESSAGE, 2, { exact: true });
  });

  test("updates profile settings and shows a visible success toast", async () => {
    const email = `profile-admin-${Date.now()}@example.com`;

    await createVerifiedUserInLocalD1({
      email,
      firstName: "Admin",
      idPrefix: "usr_profile_admin",
      lastName: "Profile",
      role: "admin",
    });

    await signInWithPassword({
      email,
      password: SEEDED_USER_PASSWORD,
      redirectPath: "/settings",
    });
    await navigateAppFrame("/settings", { waitForHydration: true });

    await expectAppText(PROFILE_COPY.cardTitle, { exact: true });
    await expectAppLabelValue({ label: PROFILE_COPY.firstNameLabel, value: "Admin" });
    await expectAppLabelValue({ label: PROFILE_COPY.lastNameLabel, value: "Profile" });
    await expectAppText("Admin Profile", { exact: true });

    await fillAppLabel({ label: PROFILE_COPY.firstNameLabel, value: "E2E" });
    await fillAppLabel({ label: PROFILE_COPY.lastNameLabel, value: "Tester" });
    await clickAppRole("button", PROFILE_COPY.saveButton);

    await expectAppToast(PROFILE_COPY.toastUpdateSuccess);
    await expectAppText(PROFILE_COPY.cardTitle, { exact: true });
    await expectAppLabelValue({ label: PROFILE_COPY.firstNameLabel, value: "E2E" });
    await expectAppLabelValue({ label: PROFILE_COPY.lastNameLabel, value: "Tester" });
    await expectAppText("E2E Tester", { exact: true });

    await navigateAppFrame("/", { waitForHydration: true });
    await expectNoAppText("E2E Tester", { exact: true });

    await navigateAppFrame("/admin", { waitForHydration: true });
    await expectAppRoleText({
      role: "navigation",
      name: "Admin navigation",
      text: "E2E Tester",
      exact: true,
    });
  });
});
