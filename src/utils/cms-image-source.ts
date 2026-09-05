import { CMS_IMAGES_API_ROUTE } from "@/constants";

interface CmsImageSourceParams {
  source: string | null | undefined;
  base: string | URL;
}

// Leaf module on purpose: the Worker entrypoint prefilter and the optimizer's own guard must
// answer this question the same way, and the entrypoint cannot pull in the optimizer's graph.
export function isCmsImageSource({ source, base }: CmsImageSourceParams): boolean {
  if (!source) {
    return false;
  }
  const baseUrl = new URL(base);
  let resolved: URL;
  try {
    // URL normalization must not turn a CMS path into another application route.
    resolved = new URL(source, baseUrl);
  } catch {
    return false;
  }
  return resolved.origin === baseUrl.origin && resolved.pathname.startsWith(`${CMS_IMAGES_API_ROUTE}/`);
}
