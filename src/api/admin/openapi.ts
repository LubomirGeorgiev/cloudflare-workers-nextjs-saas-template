import "server-only";

import {
  buildAdminApiInfo,
  buildAdminApiServers,
  buildAdminApiTags,
  buildAdminSecuritySchemes,
} from "@/api/admin/openapi-document";

// The generator config for the *internal* document, mirroring `src/api/openapi.ts`. Read only at
// build time, by `scripts/generate-openapi.mjs`, which loads this module by path.
// oxlint-disable project/no-unused-module-exports -- Imported by the build-time generator.
export function adminOpenApiGeneratorOptions() {
  return {
    documentation: {
      openapi: "3.1.0",
      info: buildAdminApiInfo(),
      servers: buildAdminApiServers(),
      tags: buildAdminApiTags(),
      components: { securitySchemes: buildAdminSecuritySchemes() },
    },
  };
}
// oxlint-enable project/no-unused-module-exports
