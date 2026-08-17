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
