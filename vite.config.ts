import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    include: [
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
    ],
    exclude: [
      // TODO Check if future version of @base-ui are optimized for Vite and remove from this list
      "@base-ui/react",
      "@base-ui/utils",
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
