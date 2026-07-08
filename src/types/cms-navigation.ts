export const CMS_NAVIGATION_NODE_TYPES = {
  PAGE: "page",
  GROUP: "group",
} as const;

export type CmsNavigationNodeType =
  typeof CMS_NAVIGATION_NODE_TYPES[keyof typeof CMS_NAVIGATION_NODE_TYPES];

export const cmsNavigationNodeTypeTuple = Object.values(
  CMS_NAVIGATION_NODE_TYPES
) as [CmsNavigationNodeType, ...CmsNavigationNodeType[]];

// Kept in this client-safe module (not the server-only repository) so the "use client"
// docs sidebar can call it without pulling drizzle/db into the client bundle. Prefers the
// active-locale entry title for PAGE nodes, else the stored nav `title` (headers/no entry).
export function getNavigationNodeDisplayTitle(node: {
  title: string;
  entry: { title: string } | null;
}): string {
  return node.entry?.title ?? node.title;
}
