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

/**
 * An icon pinned onto a navigation row at save time, held as a complete `<svg>` document.
 *
 * The whole element, not its inner markup: an uploaded file is stored as its author wrote it, so
 * nothing we do can change what it draws. The only edit a stored document carries is namespaced
 * ids — see `namespaceIconIds`. Sizing and colour are the renderer's job, through CSS.
 *
 * Only the server writes this, and only after `sanitizeIconMarkup` accepts the document.
 */
export interface CmsIconBody {
  markup: string;
}

/**
 * Every icon body a navigation tree needs, keyed by Iconify key and held once. Two rows that pin
 * the same icon share one entry here, so the markup crosses to the client once per icon rather
 * than once per node. A plain object, not a Map: it also crosses the remote cache.
 */
export type CmsIconBodyByKey = Readonly<Record<string, CmsIconBody>>;
