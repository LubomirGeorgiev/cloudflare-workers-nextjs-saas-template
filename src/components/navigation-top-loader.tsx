"use client";

import { lazy, Suspense } from "react";

const NextTopLoader = lazy(async () => {
  const topLoaderModule = await import("nextjs-toploader");
  // @ts-expect-error - default is not a property of the module
  const component = topLoaderModule.default?.default ?? topLoaderModule.default;

  return {
    default: component,
  };
});

export function NavigationTopLoader() {
  return (
    <Suspense fallback={null}>
      <NextTopLoader
        initialPosition={0.15}
        shadow="0 0 10px #000, 0 0 5px #000"
        height={4}
      />
    </Suspense>
  );
}
