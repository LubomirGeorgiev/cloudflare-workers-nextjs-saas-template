import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: [
      "@tiptap/core",
      "@tiptap/pm",
      "@tiptap/static-renderer",
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-transform",
      "prosemirror-view",
    ],
  },
  resolve: {
    dedupe: [
      "@tiptap/core",
      "@tiptap/pm",
      "@tiptap/static-renderer",
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-transform",
      "prosemirror-view",
    ],
  },
  ssr: {
    noExternal: [/^@tiptap\//, /^prosemirror-/],
  },
  plugins: [
    // TODO Wire up the cache
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
    tailwindcss(),
  ],
});
