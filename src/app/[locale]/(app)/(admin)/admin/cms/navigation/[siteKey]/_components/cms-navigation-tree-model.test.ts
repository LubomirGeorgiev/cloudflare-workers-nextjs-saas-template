import { describe, expect, test } from "vitest";

import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

import {
  toSavedNavigationItems,
  withNodeIcon,
  type CmsNavigationEditorNode,
} from "./cms-navigation-tree-model";

const UPLOADED_SVG = '<svg viewBox="0 0 24 24"><path fill="#1DA1F2" d="M0 0h24v24H0z"/></svg>';

function editorNode(overrides: Partial<CmsNavigationEditorNode> = {}): CmsNavigationEditorNode {
  return {
    id: "cms_nav_1",
    parentId: null,
    nodeType: CMS_NAVIGATION_NODE_TYPES.GROUP,
    title: "Guides",
    iconBody: null,
    entryId: null,
    slugSegment: "guides",
    sortOrder: 0,
    ...overrides,
  };
}

describe("withNodeIcon moves all three icon fields together", () => {
  test("a pick writes the key, the preview body, and the upload", () => {
    const picked = withNodeIcon(editorNode(), {
      key: "custom:logo-1a2b3c",
      icon: { markup: UPLOADED_SVG },
      svg: UPLOADED_SVG,
    });

    expect(picked.icon).toBe("custom:logo-1a2b3c");
    expect(picked.iconBody).toEqual({ markup: UPLOADED_SVG });
    expect(picked.iconSvg).toBe(UPLOADED_SVG);
  });

  test("a catalog pick clears the upload the previous pick left behind", () => {
    const uploaded = withNodeIcon(editorNode(), {
      key: "custom:logo-1a2b3c",
      icon: { markup: UPLOADED_SVG },
      svg: UPLOADED_SVG,
    });
    const picked = withNodeIcon(uploaded, {
      key: "lucide:house",
      icon: { markup: '<svg stroke="currentColor"><path d="M3 9l9-7 9 7"/></svg>' },
    });

    expect(picked.icon).toBe("lucide:house");
    expect(picked.iconSvg).toBeNull();
  });

  test("a remove leaves no body and no upload for a preview to draw", () => {
    const cleared = withNodeIcon(
      editorNode({
        icon: "custom:logo-1a2b3c",
        iconBody: { markup: UPLOADED_SVG },
        iconSvg: UPLOADED_SVG,
      }),
      null
    );

    expect(cleared.icon).toBeNull();
    expect(cleared.iconBody).toBeNull();
    expect(cleared.iconSvg).toBeNull();
  });

  test("keeps every field the icon rule does not own", () => {
    const cleared = withNodeIcon(
      editorNode({ title: "Guides", iconColor: "#ef4444", sortOrder: 3 }),
      null
    );

    expect(cleared.title).toBe("Guides");
    expect(cleared.iconColor).toBe("#ef4444");
    expect(cleared.sortOrder).toBe(3);
  });
});

describe("toSavedNavigationItems", () => {
  test("drops the preview body and keeps the upload the server still needs", () => {
    const [saved] = toSavedNavigationItems([
      editorNode({
        icon: "custom:logo-1a2b3c",
        iconBody: { markup: UPLOADED_SVG },
        iconSvg: UPLOADED_SVG,
      }),
    ]);

    expect(saved).not.toHaveProperty("iconBody");
    expect(saved.iconSvg).toBe(UPLOADED_SVG);
  });
});
