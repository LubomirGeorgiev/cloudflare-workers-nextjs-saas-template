import "server-only";

// TODO Check if the tiptap editor supports warning and error blocks
// TODO If an admin is logged in we need to show a button on blogs and docs to edit it in the CMS admin panel
// TODO Add open graph image generation
// TODO Add CMS documentation example with drag-and-drop navigation
// TODO Automatically add cms entries to the sitemap and also add the option to hide certain entries from the sitemap
// TODO Explain how to use the CMS in the README.md file
// TODO Uploading images from the editor and a dedicated media collection admin page
export * from "@/lib/cms/entry/mutations";
export * from "@/lib/cms/entry/queries";
export * from "@/lib/cms/entry/versions";
export type * from "@/lib/cms/entry/types";
