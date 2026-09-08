"use client";

import dynamic from "next/dynamic";

import { LazyPanelFallback } from "@/components/lazy-panel-fallback";

import type { CmsNavigationManagerProps } from "./cms-navigation-manager.impl";

// The drag-and-drop tree is a client reference, and vinext preloads every client reference on a
// cold isolate. This wrapper keeps @atlaskit/pragmatic-drag-and-drop off that path.
const CmsNavigationManagerImpl = dynamic(
  async () => (await import("./cms-navigation-manager.impl")).CmsNavigationManagerImpl,
  {
    ssr: false,
    loading: () => <LazyPanelFallback />,
  },
);

export function CmsNavigationManager(props: CmsNavigationManagerProps) {
  return <CmsNavigationManagerImpl {...props} />;
}
