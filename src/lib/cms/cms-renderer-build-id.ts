import "server-only";

declare const __MARKDOWN_BUILD_ID__: string;

// Same deploy stamp as markdown page keys. `"use cache"` keys from arguments, and the HTML
// converter sits behind `import()`, so a renderer change would not bust the artifacts entry
// without this value in the argument list.
export function cmsRendererBuildId(): string {
  const injected = __MARKDOWN_BUILD_ID__.trim();

  if (!injected) {
    throw new Error("CMS HTML renderer build id was not injected by the build.");
  }

  return injected;
}
