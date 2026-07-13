import { describe, expect, test, vi } from "vitest";

// Downstream projects edit the shipped catalog; test against a synthetic one so these
// stay green regardless of which add-ons the template ships.
vi.mock("./addons.json", () => ({
  default: {
    addons: {
      "extra-seats": {
        id: "extra-seats",
        name: "Extra seat",
        amount: 500,
        currency: "usd",
        maxQuantity: 20,
        limits: { seats: 1 },
      },
      "priority-support": {
        id: "priority-support",
        name: "Priority support",
        amount: 900,
        currency: "usd",
      },
    },
  },
}));

import {
  ADDON_MAX_QUANTITY,
  TEAM_ADDONS,
  fromStoredAddonQuantities,
  getAddonAmount,
  getAddonMaxQuantity,
  toStoredAddonQuantities,
} from "./addons";
import { deriveYearlyAmount } from "./plans";

describe("fromStoredAddonQuantities", () => {
  test("returns empty for null, undefined, arrays, and non-objects", () => {
    expect(fromStoredAddonQuantities(null)).toEqual({});
    expect(fromStoredAddonQuantities(undefined)).toEqual({});
    expect(fromStoredAddonQuantities(["extra-seats"])).toEqual({});
    expect(fromStoredAddonQuantities("extra-seats")).toEqual({});
  });

  test("keeps only catalog ids with positive integer quantities", () => {
    expect(fromStoredAddonQuantities({
      "extra-seats": 3,
      "priority-support": 1,
      "removed-from-catalog": 2,
      "zero": 0,
    })).toEqual({ "extra-seats": 3, "priority-support": 1 });
  });

  test("drops non-integer and non-numeric quantities", () => {
    expect(fromStoredAddonQuantities({
      "extra-seats": 1.5,
      "priority-support": "2",
    })).toEqual({});
  });
});

describe("toStoredAddonQuantities", () => {
  test("returns null when nothing (positive) is held", () => {
    expect(toStoredAddonQuantities({})).toBeNull();
    expect(toStoredAddonQuantities({ "extra-seats": 0 })).toBeNull();
  });

  test("serializes equal states identically regardless of key order", () => {
    const a = toStoredAddonQuantities({ "priority-support": 1, "extra-seats": 3 });
    const b = toStoredAddonQuantities({ "extra-seats": 3, "priority-support": 1 });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toEqual({ "extra-seats": 3, "priority-support": 1 });
  });

  test("round-trips through the stored representation", () => {
    const stored = toStoredAddonQuantities({ "extra-seats": 7 });
    expect(fromStoredAddonQuantities(stored)).toEqual({ "extra-seats": 7 });
  });
});

describe("add-on catalog accessors", () => {
  test("getAddonMaxQuantity falls back to the global cap when unset", () => {
    expect(getAddonMaxQuantity(TEAM_ADDONS["extra-seats"])).toBe(20);
    expect(getAddonMaxQuantity(TEAM_ADDONS["priority-support"])).toBe(ADDON_MAX_QUANTITY);
  });

  test("getAddonAmount derives the yearly per-unit amount like plans do", () => {
    const addon = TEAM_ADDONS["extra-seats"];
    expect(getAddonAmount({ addon, interval: "month" })).toBe(addon.amount);
    expect(getAddonAmount({ addon, interval: "year" })).toBe(deriveYearlyAmount(addon.amount));
  });
});
