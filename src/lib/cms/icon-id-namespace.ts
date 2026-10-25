// Written by hand rather than reusing ICON_ATTRIBUTE_PATTERN: this one finds `id` wherever it sits,
// and `\b` keeps it off the tail of a name like `gradientid`.
export const ICON_ID_ATTRIBUTE_PATTERN = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
export const URL_REFERENCE_PATTERN = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
const HREF_ATTRIBUTE_PATTERN =
  /\b(xlink:href|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export function readQuotedGroups(
  doubleQuoted?: string,
  singleQuoted?: string,
  bare?: string,
): string {
  return (doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
}

/**
 * Puts `namespace` in front of every id in an icon document and every `url(#…)` or `href="#…"`
 * that points at one. A document with no ids comes back untouched, which is most of them.
 *
 * Kept free of server imports: `CmsIcon` also runs it in the browser, once per rendered copy.
 */
export function prefixIconIds({ markup, namespace }: { markup: string; namespace: string }): string {
  ICON_ID_ATTRIBUTE_PATTERN.lastIndex = 0;

  if (!ICON_ID_ATTRIBUTE_PATTERN.test(markup)) {
    ICON_ID_ATTRIBUTE_PATTERN.lastIndex = 0;
    return markup;
  }

  ICON_ID_ATTRIBUTE_PATTERN.lastIndex = 0;

  return markup
    .replace(
      ICON_ID_ATTRIBUTE_PATTERN,
      (_whole, doubleQuoted?: string, singleQuoted?: string, bare?: string) =>
        `id="${namespace}-${readQuotedGroups(doubleQuoted, singleQuoted, bare)}"`,
    )
    .replace(
      URL_REFERENCE_PATTERN,
      (whole, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
        const target = readQuotedGroups(doubleQuoted, singleQuoted, bare);

        return target.startsWith("#") ? `url(#${namespace}-${target.slice(1)})` : whole;
      },
    )
    .replace(
      HREF_ATTRIBUTE_PATTERN,
      (whole, name: string, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
        const target = readQuotedGroups(doubleQuoted, singleQuoted, bare);

        return target.startsWith("#") ? `${name}="#${namespace}-${target.slice(1)}"` : whole;
      },
    );
}
