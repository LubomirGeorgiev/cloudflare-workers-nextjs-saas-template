import { create } from "zustand";
import { combine } from "zustand/middleware";

import type { PublicConfig } from "@/utils/public-config";

interface PublicAuthFeatureState {
  isLoaded: boolean;
  isGoogleSSOEnabled: boolean;
  isTurnstileEnabled: boolean;
  turnstileSiteKey: string | null;
}

export const usePublicConfigStore = create(
  combine(
    {
      publicConfig: null as PublicConfig | null,
    },
    (set) => ({
      setPublicConfig: (publicConfig: PublicConfig) => {
        set({ publicConfig });
      },
    }),
  ),
);

export function getPublicAuthFeatureState(publicConfig: PublicConfig | null): PublicAuthFeatureState {
  if (!publicConfig) {
    return {
      isLoaded: false,
      isGoogleSSOEnabled: false,
      isTurnstileEnabled: false,
      turnstileSiteKey: null,
    };
  }

  return {
    isLoaded: true,
    isGoogleSSOEnabled: publicConfig.isGoogleSSOEnabled,
    isTurnstileEnabled: publicConfig.isTurnstileEnabled,
    turnstileSiteKey: publicConfig.turnstileSiteKey,
  };
}

export function usePublicAuthFeatureState() {
  const publicConfig = usePublicConfigStore((store) => store.publicConfig);

  return getPublicAuthFeatureState(publicConfig);
}
