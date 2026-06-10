import { describe, expect, it, vi } from "vitest";

import {
  getEditorContentSyncAction,
  getSerializableContentKey,
  syncEditorContentFromProps,
} from "./simple-editor-content-sync";

describe("simple editor content sync", () => {
  it("returns stable keys for serializable editor content", () => {
    expect(getSerializableContentKey({ type: "doc", content: [] })).toBe(
      '{"type":"doc","content":[]}'
    );
  });

  it("skips sync when there is no incoming content", () => {
    expect(
      getEditorContentSyncAction({
        incomingContentKey: null,
        lastSyncedContentKey: null,
        editorContentKey: '{"type":"doc","content":[]}',
      })
    ).toBe("skip");
  });

  it("skips reading the editor when the incoming content was already synced", () => {
    const contentKey = '{"type":"doc","content":[]}';

    expect(
      getEditorContentSyncAction({
        incomingContentKey: contentKey,
        lastSyncedContentKey: contentKey,
        editorContentKey: null,
      })
    ).toBe("skip");
  });

  it("marks content as synced when the editor already matches", () => {
    const contentKey = '{"type":"doc","content":[]}';

    expect(
      getEditorContentSyncAction({
        incomingContentKey: contentKey,
        lastSyncedContentKey: '{"type":"doc","content":[{"type":"paragraph"}]}',
        editorContentKey: contentKey,
      })
    ).toBe("mark-synced");
  });

  it("syncs when incoming content differs from the editor", () => {
    expect(
      getEditorContentSyncAction({
        incomingContentKey: '{"type":"doc","content":[{"type":"paragraph"}]}',
        lastSyncedContentKey: '{"type":"doc","content":[]}',
        editorContentKey: '{"type":"doc","content":[]}',
      })
    ).toBe("sync");
  });

  it("does not read the editor when the incoming content was already synced", () => {
    const contentKey = '{"type":"doc","content":[]}';
    const editor = {
      getJSON: vi.fn(),
      commands: {
        setContent: vi.fn(),
      },
    };

    const nextContentKey = syncEditorContentFromProps({
      getEditorContent: editor.getJSON,
      setEditorContent: editor.commands.setContent,
      content: { type: "doc", content: [] },
      lastSyncedContentKey: contentKey,
    });

    expect(nextContentKey).toBe(contentKey);
    expect(editor.getJSON).not.toHaveBeenCalled();
    expect(editor.commands.setContent).not.toHaveBeenCalled();
  });

  it("updates the editor and returns the incoming key when content changed", () => {
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    const editor = {
      getJSON: vi.fn(() => ({ type: "doc", content: [] })),
      commands: {
        setContent: vi.fn(),
      },
    };

    const nextContentKey = syncEditorContentFromProps({
      getEditorContent: editor.getJSON,
      setEditorContent: editor.commands.setContent,
      content,
      lastSyncedContentKey: '{"type":"doc","content":[]}',
    });

    expect(nextContentKey).toBe(JSON.stringify(content));
    expect(editor.getJSON).toHaveBeenCalledTimes(1);
    expect(editor.commands.setContent).toHaveBeenCalledWith(content);
  });
});
