import {
  CMS_CUSTOM_ICON_SLUG_MAX_LENGTH,
  CMS_ICON_BODY_MAX_LENGTH,
  CMS_ICON_SEARCH_RESULTS_PER_SET,
  CMS_ICON_UPLOAD_MAX_LENGTH,
} from "@/constants";
import {
  CMS_CUSTOM_ICON_PREFIX,
  isAllowedIconPrefix,
  isIconifySetPrefix,
  type CmsIconPrefix,
  type CmsIconSetPrefix,
} from "@/constants/cms-icons";
import { ActionError } from "@/lib/action-error";
import type { CmsIconBody } from "@/types/cms-navigation";
import { fnv1a } from "@/utils/hash";
import { generateSlug } from "@/utils/slugify";

// Iconify's own fallback when a set declares no dimensions.
const ICONIFY_DEFAULT_ICON_SIZE = 16;
// An alias chain is one or two links in practice; the cap only stops a malformed document looping.
const ICON_ALIAS_MAX_DEPTH = 4;

/**
 * Elements an icon document may contain.
 *
 * Deny by default, because an element is where capability lives: `<script>` runs, `<style>` restyles
 * the page around it, `<image>` and `<feImage>` load somebody else's bytes, `<a>` navigates,
 * `<foreignObject>` opens the door to HTML, and the animation elements can drive attributes after
 * we have stopped looking. Everything else here only draws, so the list is generous on purpose —
 * a real logo uses filters and gradient inheritance, and refusing it teaches the admin nothing.
 *
 * Attributes are not gated this way. See `findAttributeRejection`.
 */
const ALLOWED_ICON_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "title",
  "desc",
  "switch",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "clipPath",
  "mask",
  "marker",
  "pattern",
  "linearGradient",
  "radialGradient",
  "stop",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
]);

/**
 * Elements removed rather than refused, because they draw nothing and hold foreign XML our flat
 * scanner cannot read. An Inkscape save carries both; refusing it over bookkeeping would be the
 * kind of breakage this parser exists to avoid.
 */
const NON_RENDERING_ELEMENT_PATTERN =
  /<metadata\b[\s\S]*?<\/metadata\s*>|<([a-zA-Z][\w.-]*:[\w.-]+)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/gi;

// Quote-aware, so a `>` inside an attribute value cannot end a tag early and hide markup from the
// coverage check in `findIconMarkupRejection`.
const ICON_TAG_PATTERN =
  /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9.:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?\s*>/g;
const ICON_ATTRIBUTE_PATTERN =
  /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
// An entity is how a rejected string smuggles itself past a literal check, and the schemes are how
// a value loads or runs something. `url(...)` is absent on purpose: it is resolved against the
// document's own ids instead, by `findReferenceRejection`.
const FORBIDDEN_ATTRIBUTE_VALUE = /&#|^\s*(?:javascript|data|vbscript)\s*:/i;
// Written by hand rather than reusing ICON_ATTRIBUTE_PATTERN: this one finds `id` wherever it sits,
// and `\b` keeps it off the tail of a name like `gradientid`.
const ICON_ID_ATTRIBUTE_PATTERN = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const URL_REFERENCE_PATTERN = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
// Every `url(` that has to resolve. A count that beats the parsed references means one is
// malformed, which is refused rather than ignored.
const URL_OPENING_PATTERN = /url\s*\(/gi;
const HREF_ATTRIBUTE_PATTERN =
  /\b(xlink:href|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
// The prolog, the doctype, and anything after the document. Trimmed rather than refused: it sits
// outside the `<svg>` element, so removing it changes nothing the element draws.
const SVG_PROLOG_PATTERN = /^[\s\S]*?(?=<svg[\s>])/i;
// Comments inside the element, which Inkscape and a hand-edited file both leave behind. Stripped
// rather than refused: a comment draws nothing, and `findIconMarkupRejection` cannot read past one.
const SVG_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const SVG_ELEMENT_NAME = /^(?:xlink:href|href)$/;

/**
 * Elements whose character data draws. Anywhere else a text node paints nothing, so its whitespace
 * is only formatting; inside these it is content, and collapsing a run moves the glyphs.
 */
const WHITESPACE_SIGNIFICANT_ELEMENTS = new Set(["text", "tspan", "textpath"]);

// A tag split into its quoted values and the gaps between them, so a run inside a value is
// collapsed on its own terms and a `>` inside one is never mistaken for the end of the tag.
const TAG_SEGMENT_PATTERN = /"[^"]*"|'[^']*'|[^"']+/g;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const CLOSING_TAG_PATTERN = /^<\s*\//;
const SELF_CLOSING_TAG_PATTERN = /\/\s*>$/;

/** The names that carry a reference, so their value has to name an id in this same document. */
function isReferenceAttribute(name: string): boolean {
  return SVG_ELEMENT_NAME.test(name);
}

function readQuotedGroups(
  doubleQuoted?: string,
  singleQuoted?: string,
  bare?: string,
): string {
  return (doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
}

/** Every `id` the document defines — all a reference inside it is allowed to point at. */
function collectIconIds(markup: string): Set<string> {
  const ids = new Set<string>();
  ICON_ID_ATTRIBUTE_PATTERN.lastIndex = 0;

  for (
    let match = ICON_ID_ATTRIBUTE_PATTERN.exec(markup);
    match;
    match = ICON_ID_ATTRIBUTE_PATTERN.exec(markup)
  ) {
    ids.add(readQuotedGroups(match[1], match[2], match[3]));
  }

  return ids;
}

/**
 * Why a reference cannot be inlined, or null when it points inside this document.
 *
 * A reference is only safe once it provably resolves within its own icon. An id is scoped to the
 * whole page, not to the `<svg>` that declares it, and a navigation draws many icons at once — so a
 * reference we cannot resolve here is one that would resolve against somebody else's markup at
 * render time, or fetch. `namespaceIconIds` is what makes "inside its own icon" true to begin with.
 */
function findReferenceRejection({
  value,
  ids,
}: {
  value: string;
  ids: Set<string>;
}): string | null {
  return value.startsWith("#") && ids.has(value.slice(1))
    ? null
    : `references "${value}", which is not defined inside the icon`;
}

function findUrlReferenceRejection({
  value,
  ids,
}: {
  value: string;
  ids: Set<string>;
}): string | null {
  const openings = value.match(URL_OPENING_PATTERN)?.length ?? 0;

  if (openings === 0) {
    return null;
  }

  const references = Array.from(value.matchAll(URL_REFERENCE_PATTERN));

  if (references.length !== openings) {
    return "carries a reference we could not read";
  }

  for (const reference of references) {
    const rejection = findReferenceRejection({
      value: readQuotedGroups(reference[1], reference[2], reference[3]),
      ids,
    });

    if (rejection) {
      return rejection;
    }
  }

  return null;
}

/**
 * Why one attribute cannot reach the DOM, or null when it may.
 *
 * Allow by default, unlike the element rule. The long tail of SVG presentation attributes is what
 * makes a real file render — `preserveAspectRatio`, `vector-effect`, `paint-order`,
 * `color-interpolation-filters`, every `fe*` primitive's own inputs — and a name allowlist refuses
 * whichever of them nobody thought to list. What actually carries risk is narrow: a handler, a
 * value that loads or runs something, and a reference that points outside the icon.
 */
function findAttributeRejection({
  name,
  value,
  ids,
}: {
  name: string;
  value: string;
  ids: Set<string>;
}): string | null {
  if (name.startsWith("on")) {
    return "is an event handler";
  }

  if (FORBIDDEN_ATTRIBUTE_VALUE.test(value)) {
    return "carries a value we do not inline";
  }

  if (isReferenceAttribute(name)) {
    return findReferenceRejection({ value, ids });
  }

  return findUrlReferenceRejection({ value, ids });
}

/** Every set a stored icon key may name: the licensed Iconify sets, plus our own uploads. */

/** One icon set's share of a search result. Empty sets are dropped before this reaches the picker. */
export interface CmsIconSearchGroup {
  prefix: CmsIconSetPrefix;
  icons: Array<CmsIconBody & { key: string }>;
}

interface IconifyIconEntry {
  body?: string;
  width?: number;
  height?: number;
}

interface IconifyAliasEntry {
  parent?: string;
  width?: number;
  height?: number;
}

export interface IconifySetResponse {
  icons?: Record<string, IconifyIconEntry>;
  aliases?: Record<string, IconifyAliasEntry>;
  not_found?: string[];
  width?: number;
  height?: number;
}

/**
 * The one rule that decides whether an SVG document may reach `dangerouslySetInnerHTML`. Pure and
 * total: it names the reason a document is refused, or returns null when it is safe to inline.
 */
function findIconMarkupRejection(markup: string): string | null {
  if (markup.length > CMS_ICON_BODY_MAX_LENGTH) {
    return `longer than ${CMS_ICON_BODY_MAX_LENGTH} characters`;
  }

  if (markup.includes("<!") || markup.includes("<?")) {
    return "contains a comment, a processing instruction, or CDATA";
  }

  const ids = collectIconIds(markup);
  let cursor = 0;
  ICON_TAG_PATTERN.lastIndex = 0;

  for (let tag = ICON_TAG_PATTERN.exec(markup); tag; tag = ICON_TAG_PATTERN.exec(markup)) {
    if (markup.slice(cursor, tag.index).includes("<")) {
      return "contains markup this parser could not read";
    }
    cursor = tag.index + tag[0].length;

    const [, elementName, rawAttributes] = tag;
    if (!ALLOWED_ICON_ELEMENTS.has(elementName)) {
      return `<${elementName}> is not an allowed element`;
    }

    ICON_ATTRIBUTE_PATTERN.lastIndex = 0;
    for (
      let attribute = ICON_ATTRIBUTE_PATTERN.exec(rawAttributes ?? "");
      attribute;
      attribute = ICON_ATTRIBUTE_PATTERN.exec(rawAttributes ?? "")
    ) {
      const rejection = findAttributeRejection({
        name: attribute[1].toLowerCase(),
        value: attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
        ids,
      });

      if (rejection) {
        return `"${attribute[1]}" ${rejection}`;
      }
    }
  }

  if (markup.slice(cursor).includes("<")) {
    return "contains markup this parser could not read";
  }

  return null;
}

/** The write-path gate: returns the document unchanged, or throws with the reason it was refused. */
export function sanitizeIconMarkup(markup: string): string {
  const rejection = findIconMarkupRejection(markup);

  if (rejection) {
    throw new ActionError("UNPROCESSABLE_ENTITY", `Icon markup rejected: ${rejection}`);
  }

  return markup;
}

/**
 * The read-path gate, same rule as `sanitizeIconMarkup`. A row written before the rule tightened is
 * dropped on the way out instead of failing the page it appears on.
 */
export function isSafeIconMarkup(markup: string): boolean {
  return findIconMarkupRejection(markup) === null;
}

/** One tag with its formatting gone: the runs between attributes, and the runs inside each value. */
function minifyIconTag(tag: string): string {
  return tag
    .replace(TAG_SEGMENT_PATTERN, (segment) =>
      segment.startsWith('"') || segment.startsWith("'")
        ? `${segment[0]}${segment.slice(1, -1).replace(WHITESPACE_RUN_PATTERN, " ").trim()}${segment[0]}`
        : segment.replace(WHITESPACE_RUN_PATTERN, " "))
    .replace(/^< *\/ */, "</")
    .replace(/^< +/, "<")
    .replace(/ *(\/?)>$/, "$1>");
}

/** One text node: kept as written inside a text element, otherwise collapsed and dropped if empty. */
function minifyTextNode({ text, preserve }: { text: string; preserve: boolean }): string {
  if (preserve) {
    return text;
  }

  return text.trim() === "" ? "" : text.replace(WHITESPACE_RUN_PATTERN, " ");
}

/**
 * The indentation and the line breaks an exported file carries, removed before we measure the
 * document against `CMS_ICON_BODY_MAX_LENGTH` and store it. Whitespace is a separator everywhere in
 * SVG except the character data of a text element, which this walk hands through untouched.
 */
function minifyIconMarkup(markup: string): string {
  let minified = "";
  let cursor = 0;
  let textDepth = 0;
  ICON_TAG_PATTERN.lastIndex = 0;

  for (let tag = ICON_TAG_PATTERN.exec(markup); tag; tag = ICON_TAG_PATTERN.exec(markup)) {
    minified += minifyTextNode({
      text: markup.slice(cursor, tag.index),
      preserve: textDepth > 0,
    });
    cursor = tag.index + tag[0].length;
    minified += minifyIconTag(tag[0]);

    if (
      WHITESPACE_SIGNIFICANT_ELEMENTS.has(tag[1].toLowerCase())
      && !SELF_CLOSING_TAG_PATTERN.test(tag[0])
    ) {
      textDepth = CLOSING_TAG_PATTERN.test(tag[0]) ? Math.max(textDepth - 1, 0) : textDepth + 1;
    }
  }

  return minified + minifyTextNode({ text: markup.slice(cursor), preserve: textDepth > 0 });
}

/**
 * Rewrites every id in a document, and every reference to one, behind a fingerprint of that
 * document. That and `minifyIconMarkup` are the only edits we make to an uploaded file.
 *
 * Two icons on one page routinely define the same id — `id="a"` is ordinary in exported logos — and
 * the browser resolves `url(#a)` against the whole page, so the second icon would silently paint
 * with the first one's gradient. Deriving the prefix from the markup keeps it stable across renders
 * and equal for two copies of the same icon, where a collision changes nothing.
 *
 * A document with no ids comes back untouched, which is most of them.
 */
function namespaceIconIds(markup: string): string {
  ICON_ID_ATTRIBUTE_PATTERN.lastIndex = 0;

  if (!ICON_ID_ATTRIBUTE_PATTERN.test(markup)) {
    ICON_ID_ATTRIBUTE_PATTERN.lastIndex = 0;
    return markup;
  }

  ICON_ID_ATTRIBUTE_PATTERN.lastIndex = 0;
  const namespace = `ci${fnv1a(markup)}`;

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

/**
 * One uploaded file turned into the document we store: the `<svg>` element and everything inside it,
 * minified, with its ids namespaced. Those two edits are the only ones we make.
 *
 * Pure and total: it returns the icon or throws with the reason the file was refused. Nothing is
 * rebuilt, repainted, or resized — a document that renders wrong here renders wrong in a browser
 * too, which is the only way an admin can reason about what they uploaded.
 */
export function parseUploadedSvgIcon(svg: string): CmsIconBody {
  if (svg.length > CMS_ICON_UPLOAD_MAX_LENGTH) {
    throw new ActionError(
      "UNPROCESSABLE_ENTITY",
      `That SVG is larger than ${CMS_ICON_UPLOAD_MAX_LENGTH} characters.`,
    );
  }

  const closingIndex = svg.toLowerCase().lastIndexOf("</svg");

  if (!/<svg[\s>]/i.test(svg) || closingIndex < 0) {
    throw new ActionError("UNPROCESSABLE_ENTITY", "That file is not an SVG document.");
  }

  // Trimmed to the element itself: the prolog and the doctype sit outside it and draw nothing.
  // Minified before the ids are namespaced, so the fingerprint does not move when a file is
  // reformatted and the same logo keeps landing on one key.
  // Comments go first: one that wraps a `<metadata>` block would otherwise cut the element strip
  // short, and an unterminated `<!--` still reaches the `<!` refusal in the sanitizer.
  const document = minifyIconMarkup(
    svg
      .slice(0, svg.indexOf(">", closingIndex) + 1)
      .replace(SVG_PROLOG_PATTERN, "")
      .replace(SVG_COMMENT_PATTERN, "")
      .replace(NON_RENDERING_ELEMENT_PATTERN, ""),
  );

  return { markup: sanitizeIconMarkup(namespaceIconIds(document)) };
}

/**
 * Splits `lucide:house` or `custom:my-logo`, refusing a prefix outside the licensed catalog and
 * our own uploads, so a hand-edited save cannot pull an icon from a set the picker never offers.
 * The prefix is also the routing decision: `custom` resolves against D1, everything else against
 * the icon service.
 */
export function parseIconKey(key: string): { prefix: CmsIconPrefix; name: string } {
  const separatorIndex = key.indexOf(":");
  const prefix = key.slice(0, separatorIndex);
  const name = key.slice(separatorIndex + 1);

  if (separatorIndex < 0 || !name || !isAllowedIconPrefix(prefix)) {
    throw new ActionError("NOT_FOUND", `"${key}" is not an icon we can use.`);
  }

  return { prefix, name };
}

/**
 * The key an uploaded icon is stored under: a readable half taken from the file name, and a
 * fingerprint of the markup. The fingerprint is what makes the key stable — re-uploading the same
 * file lands on the same key, so the picker's "used in this navigation" row dedupes it and a save
 * that does not change the icon sends no SVG at all. Two files that happen to share a name get
 * different keys, which a bare `custom:logo` could not do.
 *
 * Not integrity: `fnv1a` has no collision resistance, and it does not need any. The gate on what
 * may be inlined is `sanitizeIconMarkup`, which runs on every document whatever its key says.
 */
export function buildCustomIconKey({ label, markup }: { label: string; markup: string }): string {
  const slug = generateSlug(label).slice(0, CMS_CUSTOM_ICON_SLUG_MAX_LENGTH).replace(/-+$/, "");

  return `${CMS_CUSTOM_ICON_PREFIX}:${slug || "icon"}-${fnv1a(markup)}`;
}

function isCustomIconKey(key: string): boolean {
  return key.startsWith(`${CMS_CUSTOM_ICON_PREFIX}:`);
}

/**
 * Resolves one requested name inside a set document, or null when the set does not hold it or the
 * markup is something we refuse to inline. An alias holds only a `parent`, so follow the chain to
 * the real entry; alias-level transforms (rotate, flip) are not applied, which keeps the picker
 * preview and the public render identical.
 *
 * Iconify serves inner markup and the dimensions separately, so the `<svg>` element is built here.
 * That is the one place a document is constructed rather than kept: the shape comes from a
 * documented API, not from a file somebody exported, and it leaves one stored shape for the
 * renderer — an uploaded document and a catalog icon are indistinguishable downstream.
 */
export function resolveSetIcon({
  document,
  name,
}: {
  document: IconifySetResponse;
  name: string;
}): CmsIconBody | null {
  let currentName = name;
  let width: number | undefined;
  let height: number | undefined;

  for (let depth = 0; depth < ICON_ALIAS_MAX_DEPTH; depth += 1) {
    const icon = document.icons?.[currentName];

    if (icon?.body) {
      const viewBoxWidth = width ?? icon.width ?? document.width ?? ICONIFY_DEFAULT_ICON_SIZE;
      const viewBoxHeight = height ?? icon.height ?? document.height ?? ICONIFY_DEFAULT_ICON_SIZE;
      // Namespaced here rather than at the call site: this is the only place a set document turns
      // into markup we store, and a catalog icon carries ids as readily as an uploaded one.
      const markup = namespaceIconIds(
        minifyIconMarkup(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">`
          + `${icon.body}</svg>`,
        ),
      );

      return isSafeIconMarkup(markup) ? { markup } : null;
    }

    const alias = document.aliases?.[currentName];
    if (!alias?.parent) {
      return null;
    }

    width = width ?? alias.width;
    height = height ?? alias.height;
    currentName = alias.parent;
  }

  return null;
}

/**
 * Splits one search response into a bounded slice per set. Trimming here rather than after the
 * body fetch is the point: a wide search returns hundreds of keys, and every one we keep costs a
 * name in a document request and ~400 bytes in the response.
 */
export function groupIconKeysBySet(keys: string[]): Map<CmsIconSetPrefix, string[]> {
  const keysByPrefix = new Map<CmsIconSetPrefix, string[]>();

  for (const key of keys) {
    const prefix = key.slice(0, key.indexOf(":"));

    if (!isIconifySetPrefix(prefix)) {
      continue;
    }

    const kept = keysByPrefix.get(prefix) ?? [];
    if (kept.length < CMS_ICON_SEARCH_RESULTS_PER_SET) {
      kept.push(key);
      keysByPrefix.set(prefix, kept);
    }
  }

  return keysByPrefix;
}

interface NavigationIconNode {
  id: string;
  icon?: string | null;
  /** The uploaded document behind a `custom:` key, sent only when the stored tree has no body. */
  iconSvg?: string | null;
}

interface StoredNavigationIcon {
  id: string;
  icon: string | null;
  iconBody: CmsIconBody | null;
}

interface NavigationIconResolution {
  /** Iconify keys with no body already pinned in the stored tree — the only ones a save fetches. */
  fetchKeys: string[];
  /** Uploaded documents to parse, keyed by icon key. Parsing happens here, never on the client. */
  uploadedSvgByKey: Map<string, string>;
  /** Bodies the stored tree already holds, keyed by icon key, so an unchanged icon costs nothing. */
  existingBodyByKey: Map<string, CmsIconBody>;
}

/**
 * Decides where every icon on a save gets its markup from. Pure: the repository calls it, makes one
 * `requireIconBodies` call for `fetchKeys`, parses `uploadedSvgByKey`, and reads
 * `existingBodyByKey` for everything else. Between them the three cover every key on the tree.
 *
 * A key the stored tree already holds a body for wins over a document submitted with it, so a
 * client cannot replace the markup behind a key another node is already drawing.
 */
export function resolveNavigationIconBodies({
  items,
  existingItems,
}: {
  items: NavigationIconNode[];
  existingItems: StoredNavigationIcon[];
}): NavigationIconResolution {
  const existingBodyByKey = new Map<string, CmsIconBody>();

  for (const stored of existingItems) {
    // Same guard as `collectIconBodies`: a row written under an older shape carries no document,
    // and reusing it would pin `undefined` onto every node that names its key.
    if (stored.icon && typeof stored.iconBody?.markup === "string" && !existingBodyByKey.has(stored.icon)) {
      existingBodyByKey.set(stored.icon, stored.iconBody);
    }
  }

  // Collected before anything is checked, because a document attached to one row covers every row
  // that names the same key — the editor cannot promise which of them the client sends it on.
  const uploadedSvgByKey = new Map<string, string>();
  for (const item of items) {
    if (item.icon && item.iconSvg && !existingBodyByKey.has(item.icon)) {
      uploadedSvgByKey.set(item.icon, item.iconSvg);
    }
  }

  const fetchKeys = new Set<string>();
  for (const item of items) {
    if (!item.icon || existingBodyByKey.has(item.icon)) {
      continue;
    }

    if (!isCustomIconKey(item.icon)) {
      fetchKeys.add(item.icon);
      continue;
    }

    if (!uploadedSvgByKey.has(item.icon)) {
      // The upload is the only source for this key: nothing to look it up in, and pinning the key
      // without markup would leave the row drawing the type fallback with no way back.
      throw new ActionError(
        "UNPROCESSABLE_ENTITY",
        `The uploaded icon "${item.icon}" is no longer attached. Upload it again on that row.`,
      );
    }
  }

  return {
    fetchKeys: Array.from(fetchKeys),
    uploadedSvgByKey,
    existingBodyByKey,
  };
}
