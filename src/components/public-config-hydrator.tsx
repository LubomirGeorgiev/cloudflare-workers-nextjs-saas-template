"use client";

import { useEffect } from "react";

import { usePublicConfigStore } from "@/state/public-config";
import type { PublicConfig } from "@/utils/public-config";

interface PublicConfigHydratorProps {
  publicConfig: PublicConfig;
}

export function PublicConfigHydrator({ publicConfig }: PublicConfigHydratorProps) {
  const setPublicConfig = usePublicConfigStore((store) => store.setPublicConfig);

  useEffect(() => {
    setPublicConfig(publicConfig);
  }, [publicConfig, setPublicConfig]);

  return null;
}
