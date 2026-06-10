import { expect, test } from "vitest";
import { clickAppRole, expectAppRole, expectAppRoleText } from "./app-frame";

type RejectsInvalidRole<Role> = "not-a-role" extends Role ? never : true;

const roleContracts: {
  clickAppRole: RejectsInvalidRole<Parameters<typeof clickAppRole>[0]>;
  expectAppRole: RejectsInvalidRole<Parameters<typeof expectAppRole>[0]>;
  expectAppRoleText: RejectsInvalidRole<Parameters<typeof expectAppRoleText>[0]["role"]>;
} = {
  clickAppRole: true,
  expectAppRole: true,
  expectAppRoleText: true,
};

test("app role helpers keep Playwright role contracts", () => {
  expect(roleContracts).toEqual({
    clickAppRole: true,
    expectAppRole: true,
    expectAppRoleText: true,
  });
});
