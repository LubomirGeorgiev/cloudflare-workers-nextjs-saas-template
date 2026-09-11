/**
 * Iconify sets an admin can pick a navigation icon from. Permissive licenses only. Every search
 * covers every set, and this order is the order the picker groups the results in.
 *
 * Simple Icons bodies are CC0, but the brands they draw hold trademarks: a fork that does not want
 * third-party logos in its navigation drops the `simple-icons` prefix from this list.
 */
export const CMS_ICON_SET_PREFIXES = [
  "lucide",
  "tabler",
  "heroicons",
  "ph",
  "mdi",
  "material-symbols",
  "simple-icons",
] as const;

export type CmsIconSetPrefix = typeof CMS_ICON_SET_PREFIXES[number];

export const CMS_ICON_SET_LABELS: Record<CmsIconSetPrefix, string> = {
  "lucide": "Lucide",
  "tabler": "Tabler",
  "heroicons": "Heroicons",
  "ph": "Phosphor",
  "mdi": "Material Design Icons",
  "material-symbols": "Material Symbols",
  "simple-icons": "Simple Icons",
};

/**
 * The set an admin-uploaded SVG lives in. Not an Iconify prefix: a `custom:{slug}-{hash}` key
 * names markup the admin sent us, so it is never looked up anywhere. Kept out of
 * `CMS_ICON_SET_PREFIXES` so a fork that trims that list never drops its own uploads, and so a
 * search request can never ask Iconify for a prefix it does not serve.
 */
export const CMS_CUSTOM_ICON_PREFIX = "custom";

/** Every prefix an icon key may carry: a licensed Iconify set, or our own uploads. */
export type CmsIconPrefix = CmsIconSetPrefix | typeof CMS_CUSTOM_ICON_PREFIX;

export function isIconifySetPrefix(prefix: string): prefix is CmsIconSetPrefix {
  return (CMS_ICON_SET_PREFIXES as readonly string[]).includes(prefix);
}

/**
 * The one gate on an icon key's prefix. The schema and `parseIconKey` both call it, so a hand-edited
 * save cannot reach a set the picker never offers, and a fork that trims the list trims both.
 */
export function isAllowedIconPrefix(prefix: string): prefix is CmsIconPrefix {
  return prefix === CMS_CUSTOM_ICON_PREFIX || isIconifySetPrefix(prefix);
}
