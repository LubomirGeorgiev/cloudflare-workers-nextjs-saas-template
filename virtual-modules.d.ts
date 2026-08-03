// Virtual modules served by vite plugins in `tools/`. They have no file on disk, so their types
// are declared here rather than inferred.
declare module "virtual:api-openapi-document" {
  /** The OpenAPI document as JSON text, generated at build time by `tools/openapi-document.ts`. */
  const documentJson: string;

  export default documentJson;
}
