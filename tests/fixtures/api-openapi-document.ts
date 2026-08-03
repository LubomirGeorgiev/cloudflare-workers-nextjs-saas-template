// Stand-in for `virtual:api-openapi-document` under the unit-test runner, which has no vite plugin
// to generate the real one (that needs a full SSR server, see `scripts/generate-openapi.mjs`).
// Shaped like the generated document, deliberately tiny: tests that read it derive their
// expectations from these values rather than from the template's own route table.

export const FIXTURE_API_OPERATION = {
  operationId: "listFixtureWidgets",
  method: "get",
  path: "/api/v1/fixture-widgets",
  summary: "List fixture widgets",
  description: "Returns every fixture widget visible to the credential.",
  tag: "Fixtures",
  scope: "fixtures:read",
} as const;

const document = {
  openapi: "3.1.0",
  info: { title: "Fixture API", version: "0", description: "Fixture document." },
  servers: [{ url: "https://fixture.test" }],
  tags: [{ name: FIXTURE_API_OPERATION.tag }],
  paths: {
    [FIXTURE_API_OPERATION.path]: {
      [FIXTURE_API_OPERATION.method]: {
        operationId: FIXTURE_API_OPERATION.operationId,
        summary: FIXTURE_API_OPERATION.summary,
        description: FIXTURE_API_OPERATION.description,
        tags: [FIXTURE_API_OPERATION.tag],
        security: [{ apiKey: [FIXTURE_API_OPERATION.scope] }],
        responses: {},
      },
    },
  },
};

export default JSON.stringify(document);
