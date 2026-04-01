import { type CollectionsUnion } from "@/../cms.config";
import { SITE_URL } from "@/constants";

export function normalizeCmsResolvedPath(path: string | null | undefined): string {
  const normalized = (path ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();

  return normalized ? `/${normalized}` : "/";
}

export function buildCmsResolvedPath({
  basePath,
  segments,
}: {
  basePath: string;
  segments: Array<string | null | undefined>;
}): string {
  const normalizedSegments = segments.filter(Boolean).join("/");
  return normalizeCmsResolvedPath(`${basePath}/${normalizedSegments}`);
}

function buildCmsEntryMarkdownPath({
  collectionSlug,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
}): string {
  return `/api/cms/markdown/${collectionSlug}/${slug}`;
}

export function buildAbsoluteCmsEntryMarkdownUrl({
  collectionSlug,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
}): string {
  return `${SITE_URL}${buildCmsEntryMarkdownPath({
    collectionSlug,
    slug,
  })}`;
}
