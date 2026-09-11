import { describe, expect, test } from "vitest";

import { CMS_ICON_BODY_MAX_LENGTH, CMS_ICON_UPLOAD_MAX_LENGTH } from "@/constants";
import type { CmsIconBody } from "@/types/cms-navigation";

import {
  buildCustomIconKey,
  parseUploadedSvgIcon,
  resolveNavigationIconBodies,
  resolveSetIcon,
  sanitizeIconMarkup,
} from "./cms-icon-rules";

// Real markup, copied from Iconify API responses. A sanitizer that only ever sees hand-written
// examples is a sanitizer that rejects the icons we actually ship.
const LUCIDE_HOUSE =
  '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2">'
  + '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/></g>';
const HOUSE_ICON: CmsIconBody = {
  markup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${LUCIDE_HOUSE}</svg>`,
};
const UPLOADED_SVG = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

function storedNode({
  id,
  icon,
  iconBody,
}: {
  id: string;
  icon: string | null;
  iconBody: CmsIconBody | null;
}) {
  return { id, icon, iconBody };
}

describe("parseUploadedSvgIcon strips what draws nothing", () => {
  test("accepts an editor comment inside the element", () => {
    const icon = parseUploadedSvgIcon(
      '<svg viewBox="0 0 24 24"><!-- Layer 1 --><path d="M0 0h24v24H0z"/></svg>'
    );

    expect(icon.markup).toBe('<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>');
  });

  test("strips a comment that wraps a metadata block rather than cutting the strip short", () => {
    const icon = parseUploadedSvgIcon(
      '<svg viewBox="0 0 24 24"><!--<metadata>x</metadata>--><path d="M0 0h24v24H0z"/></svg>'
    );

    expect(icon.markup).toBe('<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>');
  });

  test("still refuses an unterminated comment, which hides markup from the scanner", () => {
    expect(() =>
      parseUploadedSvgIcon('<svg viewBox="0 0 24 24"><!-- <path d="M0 0h24v24H0z"/></svg>')
    ).toThrow();
  });

  test("still refuses CDATA", () => {
    expect(() =>
      parseUploadedSvgIcon('<svg viewBox="0 0 24 24"><![CDATA[x]]><path d="M0 0h1v1H0z"/></svg>')
    ).toThrow();
  });
});

describe("parseUploadedSvgIcon keeps the original", () => {
  test("stores the document byte for byte when it has no ids to scope", () => {
    const original = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-2 -2 28 28"'
      + ' fill="none" stroke="currentColor" stroke-width="2" class="lucide" overflow="hidden">'
      + "<title>rocket</title>"
      + '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2"/>'
      + "</svg>";

    // Everything the old parser destroyed survives: the shifted viewBox origin, the root paint,
    // `overflow`, `class`, the `xmlns`, even the <title>. Only the prolog, which sits outside the
    // element, is trimmed.
    expect(parseUploadedSvgIcon(original).markup).toBe(original.slice(original.indexOf("<svg")));
  });

  test("does not repaint a document that declares no fill", () => {
    const original = '<svg viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>';

    expect(parseUploadedSvgIcon(original).markup).toBe(original);
  });

  test("keeps a filter, a gradient, and gradient inheritance", () => {
    const original = '<svg viewBox="0 0 24 24">'
      + '<defs><linearGradient id="a"><stop offset="0" stop-color="#f97316"/></linearGradient>'
      + '<radialGradient xlink:href="#a" id="b" gradientUnits="userSpaceOnUse"/>'
      + '<filter id="c" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.7"/></filter>'
      + "</defs>"
      + '<path fill="url(#b)" filter="url(#c)" d="M12 2 2 20h20z"/></svg>';
    const { markup } = parseUploadedSvgIcon(original);

    expect(markup).toContain("<feGaussianBlur");
    expect(markup).toContain('color-interpolation-filters="sRGB"');
    expect(markup).toContain('stdDeviation="1.7"');
    expect(markup).toContain('gradientUnits="userSpaceOnUse"');
    // Same document, only the ids moved.
    expect(markup.replace(/ci[a-z0-9]+-/g, "")).toBe(original);
  });

  test("drops editor bookkeeping that draws nothing and holds foreign XML", () => {
    const { markup } = parseUploadedSvgIcon(
      '<svg viewBox="0 0 16 16">'
      + "<metadata><rdf:RDF><cc:Work/></rdf:RDF></metadata>"
      + '<sodipodi:namedview pagecolor="#fff"/>'
      + '<path d="M0 0h16v16H0z"/></svg>',
    );

    expect(markup).toBe('<svg viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>');
  });

  test("refuses a file it cannot read, and one past the upload ceiling", () => {
    expect(() => parseUploadedSvgIcon("not an svg")).toThrow(/not an SVG document/);
    expect(() => parseUploadedSvgIcon("x".repeat(CMS_ICON_UPLOAD_MAX_LENGTH + 1)))
      .toThrow(/larger than/);
  });
});

describe("minification", () => {
  test("drops the indentation and the line breaks an export carries", () => {
    const exported = '<svg xmlns="http://www.w3.org/2000/svg"\n'
      + '     viewBox="0 0 24 24"\n'
      + '     fill="none" >\n'
      + "  <g   stroke=\"currentColor\" >\n"
      + '    <path\n      d="M4 4\n         L20 20"\n    />\n'
      + "  </g>\n"
      + "</svg>\n";

    expect(parseUploadedSvgIcon(exported).markup).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">'
      + '<g stroke="currentColor"><path d="M4 4 L20 20"/></g></svg>',
    );
  });

  test("leaves the character data of a text element alone", () => {
    const original = '<svg viewBox="0 0 24 24">'
      + '<text  x="0"   y="8" >Ac me\n  Ltd<tspan  dx="1" > two  words</tspan></text>'
      + "</svg>";

    // The gaps inside <text> are glyphs on the page, so only the tags are minified.
    expect(parseUploadedSvgIcon(original).markup).toBe(
      '<svg viewBox="0 0 24 24"><text x="0" y="8">Ac me\n  Ltd'
      + '<tspan dx="1"> two  words</tspan></text></svg>',
    );
  });

  test("gives a reformatted file the key it had before", () => {
    const compact = parseUploadedSvgIcon(UPLOADED_SVG).markup;
    const indented = parseUploadedSvgIcon(
      '<svg viewBox="0 0 24 24">\n  <path d="M0 0h24v24H0z" />\n</svg>',
    ).markup;

    expect(indented).toBe(compact);
    expect(buildCustomIconKey({ label: "logo", markup: indented }))
      .toBe(buildCustomIconKey({ label: "logo", markup: compact }));
  });

  test("fits a file the formatting alone pushed over the body ceiling", () => {
    const path = `<path d="${"M".repeat(CMS_ICON_BODY_MAX_LENGTH - 200)}"/>`;
    const padded = `<svg viewBox="0 0 24 24">\n${" ".repeat(2000)}${path}\n</svg>`;

    expect(padded.length).toBeGreaterThan(CMS_ICON_BODY_MAX_LENGTH);
    expect(parseUploadedSvgIcon(padded).markup)
      .toBe(`<svg viewBox="0 0 24 24">${path}</svg>`);
  });

  test("minifies a catalog icon the same way", () => {
    const icon = resolveSetIcon({
      document: { width: 24, height: 24, icons: { house: { body: `\n  ${LUCIDE_HOUSE}\n` } } },
      name: "house",
    });

    expect(icon).toEqual(HOUSE_ICON);
  });
});

describe("id namespacing", () => {
  test("scopes every id and every kind of reference to the document", () => {
    const { markup } = parseUploadedSvgIcon(
      '<svg viewBox="0 0 16 16">'
      + '<linearGradient id="a"><stop stop-color="#f00"/></linearGradient>'
      + '<clipPath id="b"><rect width="16" height="16"/></clipPath>'
      + '<radialGradient xlink:href="#a" id="c"/>'
      + '<path fill="url(#c)" clip-path="url(#b)" style="stroke:url(#a)" d="M0 0h1v1H0z"/></svg>',
    );

    // `id="a"` is ordinary in exported logos; two of them on one page would otherwise have the
    // browser resolve `url(#a)` against whichever landed in the DOM first.
    expect(markup).not.toMatch(/id="[abc]"/);
    expect(markup).not.toMatch(/url\(#[abc]\)/);
    expect(markup).not.toContain('xlink:href="#a"');
    const [, namespace] = /id="(ci[a-z0-9]+)-a"/.exec(markup) ?? [];
    expect(namespace).toBeDefined();
    expect(markup).toContain(`xlink:href="#${namespace}-a"`);
    expect(markup).toContain(`url(#${namespace}-c)`);
    expect(markup).toContain(`stroke:url(#${namespace}-a)`);
  });

  test("gives two icons sharing an id name different namespaces", () => {
    const logo = (color: string) => parseUploadedSvgIcon(
      `<svg viewBox="0 0 16 16"><linearGradient id="a"><stop stop-color="${color}"/></linearGradient>`
      + '<path fill="url(#a)" d="M0 0h16v16H0z"/></svg>',
    ).markup;

    expect(/id="([^"]+)"/.exec(logo("#f00"))?.[1])
      .not.toBe(/id="([^"]+)"/.exec(logo("#00f"))?.[1]);
  });

  test("leaves a document without ids untouched", () => {
    const original = '<svg viewBox="0 0 16 16"><path fill="#f00" d="M0 0h1v1H0z"/></svg>';

    expect(parseUploadedSvgIcon(original).markup).toBe(original);
  });
});

describe("sanitizeIconMarkup", () => {
  const wrap = (inner: string) => `<svg viewBox="0 0 16 16">${inner}</svg>`;

  test("accepts the shapes real files are built from", () => {
    const drawing = wrap(
      '<g fill="none" stroke="currentColor" vector-effect="non-scaling-stroke" paint-order="stroke">'
      + '<path d="M0 0h1v1H0z" preserveAspectRatio="xMidYMid"/>'
      + '<text x="1" y="2" dominant-baseline="middle">hi</text></g>',
    );

    expect(sanitizeIconMarkup(drawing)).toBe(drawing);
  });

  test("refuses what can run, restyle, or load somebody else's bytes", () => {
    expect(() => sanitizeIconMarkup(wrap("<script>alert(1)</script>"))).toThrow(/not an allowed element/);
    expect(() => sanitizeIconMarkup(wrap("<style>body{display:none}</style>"))).toThrow(/not an allowed element/);
    expect(() => sanitizeIconMarkup(wrap("<foreignObject><p>x</p></foreignObject>"))).toThrow(/not an allowed element/);
    expect(() => sanitizeIconMarkup(wrap('<image href="https://evil.test/x.png"/>'))).toThrow(/not an allowed element/);
    expect(() => sanitizeIconMarkup(wrap('<feImage href="#a"/>'))).toThrow(/not an allowed element/);
    expect(() => sanitizeIconMarkup(wrap('<animate attributeName="fill" to="red"/>'))).toThrow(/not an allowed element/);
    expect(() => sanitizeIconMarkup(wrap('<a href="https://evil.test"><path d="M0 0"/></a>'))).toThrow(/not an allowed element/);
  });

  test("refuses an event handler on any element", () => {
    expect(() => sanitizeIconMarkup(wrap('<path onclick="alert(1)" d="M0 0"/>')))
      .toThrow(/is an event handler/);
    expect(() => sanitizeIconMarkup('<svg viewBox="0 0 16 16" onload="alert(1)"><path d="M0 0"/></svg>'))
      .toThrow(/is an event handler/);
  });

  test("refuses a reference that points anywhere but inside the document", () => {
    expect(() => sanitizeIconMarkup(wrap('<path fill="url(#missing)" d="M0 0"/>')))
      .toThrow(/not defined inside the icon/);
    expect(() => sanitizeIconMarkup(wrap('<use href="https://evil.test/x.svg#g"/>')))
      .toThrow(/not defined inside the icon/);
    expect(() => sanitizeIconMarkup(wrap('<path fill="url(https://evil.test/x.svg#g)" d="M0 0"/>')))
      .toThrow(/not defined inside the icon/);
    expect(() => sanitizeIconMarkup(wrap('<path fill="url(#a" d="M0 0"/>')))
      .toThrow(/could not read/);
  });

  test("accepts a reference the same document defines", () => {
    const clipped = wrap(
      '<clipPath id="c"><rect width="16" height="16"/></clipPath><path clip-path="url(#c)" d="M0 0"/>',
    );

    expect(sanitizeIconMarkup(clipped)).toBe(clipped);
  });

  test("refuses a smuggled scheme, a comment, and a document over the ceiling", () => {
    expect(() => sanitizeIconMarkup(wrap('<path fill="javascript:alert(1)" d="M0 0"/>'))).toThrow();
    expect(() => sanitizeIconMarkup(wrap('<use href="&#106;avascript:alert(1)"/>'))).toThrow();
    expect(() => sanitizeIconMarkup(wrap("<!--<script>alert(1)</script>--><path d=\"M0 0\"/>"))).toThrow();
    expect(() => sanitizeIconMarkup(wrap(`<path d="${"M".repeat(CMS_ICON_BODY_MAX_LENGTH)}"/>`))).toThrow();
  });

  test("refuses a tag hidden behind an unbalanced quote", () => {
    expect(() => sanitizeIconMarkup(wrap('<path d="M0 0 <script>alert(1)</script>'))).toThrow();
  });
});

describe("resolveSetIcon", () => {
  test("builds one complete document from Iconify's split body and dimensions", () => {
    const icon = resolveSetIcon({
      document: { width: 24, height: 24, icons: { house: { body: LUCIDE_HOUSE } } },
      name: "house",
    });

    expect(icon).toEqual(HOUSE_ICON);
  });

  test("follows an alias to the entry that holds the markup", () => {
    const icon = resolveSetIcon({
      document: {
        width: 24,
        height: 24,
        aliases: { home: { parent: "house" } },
        icons: { house: { body: LUCIDE_HOUSE } },
      },
      name: "home",
    });

    expect(icon).toEqual(HOUSE_ICON);
  });

  test("drops a set icon whose markup we refuse, rather than failing the search", () => {
    expect(resolveSetIcon({
      document: { width: 24, height: 24, icons: { evil: { body: "<script>alert(1)</script>" } } },
      name: "evil",
    })).toBeNull();
  });
});

describe("resolveNavigationIconBodies", () => {
  test("fetches only the keys the stored tree has no body for", () => {
    const resolution = resolveNavigationIconBodies({
      items: [
        { id: "a", icon: "lucide:house" },
        { id: "b", icon: "lucide:book" },
        { id: "c", icon: null },
      ],
      existingItems: [
        storedNode({ id: "a", icon: "lucide:house", iconBody: HOUSE_ICON }),
        storedNode({ id: "b", icon: null, iconBody: null }),
      ],
    });

    expect(resolution.fetchKeys).toEqual(["lucide:book"]);
    expect(resolution.existingBodyByKey.get("lucide:house")).toBe(HOUSE_ICON);
  });

  test("fetches a key once when several nodes share it", () => {
    const resolution = resolveNavigationIconBodies({
      items: [
        { id: "a", icon: "tabler:home" },
        { id: "b", icon: "tabler:home" },
      ],
      existingItems: [],
    });

    expect(resolution.fetchKeys).toEqual(["tabler:home"]);
  });

  test("fetches nothing when a save only reorders nodes", () => {
    const stored = [
      storedNode({ id: "a", icon: "lucide:house", iconBody: HOUSE_ICON }),
      storedNode({ id: "b", icon: "lucide:house", iconBody: HOUSE_ICON }),
    ];

    const resolution = resolveNavigationIconBodies({
      items: [
        { id: "b", icon: "lucide:house" },
        { id: "a", icon: "lucide:house" },
      ],
      existingItems: stored,
    });

    expect(resolution.fetchKeys).toEqual([]);
  });

  test("re-fetches a key whose stored row lost its body", () => {
    const resolution = resolveNavigationIconBodies({
      items: [{ id: "a", icon: "lucide:house" }],
      existingItems: [storedNode({ id: "a", icon: "lucide:house", iconBody: null })],
    });

    expect(resolution.fetchKeys).toEqual(["lucide:house"]);
  });

  test("routes an uploaded key to its document instead of the icon service", () => {
    const resolution = resolveNavigationIconBodies({
      items: [
        { id: "a", icon: "custom:logo-1a2b3c", iconSvg: UPLOADED_SVG },
        { id: "b", icon: "lucide:house" },
      ],
      existingItems: [],
    });

    expect(resolution.fetchKeys).toEqual(["lucide:house"]);
    expect(resolution.uploadedSvgByKey.get("custom:logo-1a2b3c")).toBe(UPLOADED_SVG);
  });

  test("covers every row naming an uploaded key, whatever order they arrive in", () => {
    const resolution = resolveNavigationIconBodies({
      items: [
        { id: "b", icon: "custom:logo-1a2b3c" },
        { id: "a", icon: "custom:logo-1a2b3c", iconSvg: UPLOADED_SVG },
      ],
      existingItems: [],
    });

    expect(resolution.uploadedSvgByKey.size).toBe(1);
    expect(resolution.fetchKeys).toEqual([]);
  });

  test("sends no document for an uploaded icon the stored tree already holds", () => {
    const resolution = resolveNavigationIconBodies({
      items: [{ id: "a", icon: "custom:logo-1a2b3c" }],
      existingItems: [
        storedNode({ id: "a", icon: "custom:logo-1a2b3c", iconBody: HOUSE_ICON }),
      ],
    });

    expect(resolution.uploadedSvgByKey.size).toBe(0);
    expect(resolution.fetchKeys).toEqual([]);
  });

  test("refuses an uploaded key that arrives with no document and no stored body", () => {
    expect(() => resolveNavigationIconBodies({
      items: [{ id: "a", icon: "custom:logo-1a2b3c" }],
      existingItems: [],
    })).toThrow(/no longer attached/);
  });
});

describe("buildCustomIconKey", () => {
  const markup = '<svg viewBox="0 0 16 16"><path d="M0 0h1v1H0z"/></svg>';

  test("is stable for the same file, so a re-upload dedupes instead of piling up", () => {
    expect(buildCustomIconKey({ label: "Acme Logo", markup }))
      .toBe(buildCustomIconKey({ label: "Acme Logo", markup }));
  });

  test("separates two files that share a name but draw different things", () => {
    expect(buildCustomIconKey({ label: "logo", markup })).not.toBe(
      buildCustomIconKey({ label: "logo", markup: '<svg viewBox="0 0 16 16"><path d="M1 1h1v1H1z"/></svg>' }),
    );
  });

  test("produces a key the save schema accepts", () => {
    // Same shape `cmsIconKeyField` enforces: a lowercase dash-joined prefix and name.
    expect(buildCustomIconKey({ label: "Acme  Logo (2024)!", markup }))
      .toMatch(/^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(buildCustomIconKey({ label: "!!!", markup })).toMatch(/^custom:icon-[a-z0-9]+$/);
  });
});
