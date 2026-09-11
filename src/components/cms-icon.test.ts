import { describe, expect, test } from "vitest";

import type { CmsIconBody } from "@/types/cms-navigation";

import { ICON_COLOR_HELP, iconFollowsCurrentColor } from "./cms-icon";

function icon(markup: string): CmsIconBody {
  return { markup };
}

// Real markup: a catalog glyph paints with `currentColor`, an uploaded brand mark names its own.
const CATALOG_ICON = icon(
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9l9-7 9 7"/></svg>'
);
const BRAND_ICON = icon(
  '<svg viewBox="0 0 24 24"><path fill="#1DA1F2" d="M0 0h24v24H0z"/></svg>'
);

describe("iconFollowsCurrentColor", () => {
  test("accepts a document that paints with currentColor", () => {
    expect(iconFollowsCurrentColor(CATALOG_ICON)).toBe(true);
  });

  test("accepts it whatever case the document writes it in", () => {
    expect(iconFollowsCurrentColor(icon('<svg><path fill="CurrentColor"/></svg>'))).toBe(true);
  });

  test("refuses a document that names its own paint", () => {
    expect(iconFollowsCurrentColor(BRAND_ICON)).toBe(false);
  });

  test("refuses a document that names no paint at all, which SVG draws black", () => {
    expect(iconFollowsCurrentColor(icon('<svg><path d="M0 0h24v24H0z"/></svg>'))).toBe(false);
  });
});

// The rule the panel's colour control states in words has to be the rule the renderer follows, so
// the copy is picked by the same predicate that enables the control.
describe("the colour help text matches the predicate", () => {
  test("promises a colour only for an icon that follows currentColor", () => {
    const help = iconFollowsCurrentColor(CATALOG_ICON)
      ? ICON_COLOR_HELP.recolorable
      : ICON_COLOR_HELP.selfPainted;

    expect(help).toBe(ICON_COLOR_HELP.recolorable);
    expect(help).toContain("replaces it");
  });

  test("says a colour would do nothing for a self-painted icon", () => {
    const help = iconFollowsCurrentColor(BRAND_ICON)
      ? ICON_COLOR_HELP.recolorable
      : ICON_COLOR_HELP.selfPainted;

    expect(help).toBe(ICON_COLOR_HELP.selfPainted);
    expect(help).toContain("change nothing");
  });
});
