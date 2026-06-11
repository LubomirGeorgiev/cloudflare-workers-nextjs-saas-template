import { describe, expect, test } from "vitest";

import { getPublicAuthFeatureState } from "./public-config";

describe("public config state", () => {
  test("separates loading state from boolean feature flags", () => {
    expect(getPublicAuthFeatureState(null)).toEqual({
      isLoaded: false,
      isGoogleSSOEnabled: false,
      isTurnstileEnabled: false,
      turnstileSiteKey: null,
    });

    expect(getPublicAuthFeatureState({
      isGoogleSSOEnabled: true,
      isTurnstileEnabled: true,
      turnstileSiteKey: "site-key",
    })).toEqual({
      isLoaded: true,
      isGoogleSSOEnabled: true,
      isTurnstileEnabled: true,
      turnstileSiteKey: "site-key",
    });
  });
});
