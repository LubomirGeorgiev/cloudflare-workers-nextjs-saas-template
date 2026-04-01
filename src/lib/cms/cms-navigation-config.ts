import { cmsConfig, type CmsNavigationKey, type CollectionsUnion } from "@/../cms.config";

export function getCmsNavigationConfig(navigationKey: CmsNavigationKey) {
  const navigationConfig = cmsConfig.navigations[navigationKey];

  if (!navigationConfig) {
    throw new Error(`Unsupported CMS navigation "${navigationKey}"`);
  }

  return navigationConfig;
}

export function getCmsCollectionNavigationKey(
  collectionSlug: CollectionsUnion
): CmsNavigationKey | null {
  const collection = cmsConfig.collections[collectionSlug];
  return collection && "navigationKey" in collection
    ? (collection.navigationKey as CmsNavigationKey | undefined) ?? null
    : null;
}

export function getCmsNavigations() {
  return Object.entries(cmsConfig.navigations).map(([navigationKey, navigationConfig]) => ({
    navigationKey: navigationKey as CmsNavigationKey,
    ...navigationConfig,
  }));
}
