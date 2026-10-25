"use client";

import { lazy, Suspense } from "react";
import { useIsClient } from "usehooks-ts";

const NextTopLoader = lazy(async () => {
  const topLoaderModule = await import("nextjs-toploader");
  // @ts-expect-error - default is not a property of the module
  const component = topLoaderModule.default?.default ?? topLoaderModule.default;

  return {
    default: component,
  };
});

export function NavigationTopLoader() {
  // Server-rendered, the lazy chunk hydrates late: a Base UI popup opened first marks the loader's
  // `<style>` inert, and React reports a mismatch. It only matters on navigation, so mount it after.
  const isClient = useIsClient();

  if (!isClient) {
    return null;
  }

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
