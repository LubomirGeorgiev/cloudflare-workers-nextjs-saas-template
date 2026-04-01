export const CMS_NAVIGATION_NODE_TYPES = {
  PAGE: "page",
  GROUP: "group",
} as const;

export type CmsNavigationNodeType =
  typeof CMS_NAVIGATION_NODE_TYPES[keyof typeof CMS_NAVIGATION_NODE_TYPES];

export const cmsNavigationNodeTypeTuple = Object.values(
  CMS_NAVIGATION_NODE_TYPES
) as [CmsNavigationNodeType, ...CmsNavigationNodeType[]];
