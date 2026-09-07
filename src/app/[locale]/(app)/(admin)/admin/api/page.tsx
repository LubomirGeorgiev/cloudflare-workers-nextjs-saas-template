import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ADMIN_API_BASE_PATH,
  ADMIN_API_DOCS_PATH,
  ADMIN_API_OPENAPI_PATH,
  ADMIN_MCP_PATH,
  SITE_NAME,
  SITE_URL,
} from "@/constants";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { listAdminApiKeys } from "@/lib/admin/admin-api-keys";
import { listAdminOAuthGrants } from "@/lib/admin/admin-oauth-grants";
import { ADMIN_SCOPES, ADMIN_SCOPE_NAMES, describeAdminScopes } from "@/lib/api/admin-scopes";
import { formatApiKeyHint } from "@/utils/api-key-format";
import { requireAdminOrRedirectHome } from "@/utils/auth-redirect";
import { formatDate } from "@/utils/format-date";

import { AdminApiKeysPanel } from "../_components/api/admin-api-keys-panel";
import { AdminOAuthGrantsCard } from "../_components/api/admin-oauth-grants-card";

// The one place the internal API and MCP surfaces are named. They are absent from the published
// OpenAPI document, the RFC 9727 catalog, llms.txt, and the sitemap by construction — see
// `ADMIN_SCOPES` in `src/lib/api/admin-scopes.ts` — so this page is where staff find them. The
// operations themselves live in the machine-readable document, which only agents read.
//
// Staff tooling, so the copy is literal English, matching the rest of the admin subtree.

export const metadata = {
  title: "Internal API",
  description: "The internal admin REST API and MCP server, and the keys that reach them.",
};

// Handed to the client panel as data. It must not import `@/lib/api/admin-scopes` itself (that
// module is `server-only`), and it must not import the endpoint constants either — those would land
// in a public JavaScript chunk, while these props travel only in this admin page's own payload.
function toScopeOptions(): { name: string; description: string }[] {
  return ADMIN_SCOPE_NAMES.map((name) => ({ name, description: ADMIN_SCOPES[name].description }));
}

const OPENAPI_URL = `${SITE_URL}${ADMIN_API_OPENAPI_PATH}`;

export default async function AdminApiPage() {
  // The page is inside `(admin)`, which the layout already gates; asserted again here because this
  // page lists internal credentials, and that must never depend on a parent staying in place.
  await requireAdminOrRedirectHome();

  // Independent reads of the two stores an internal credential can live in.
  const [keys, grants] = await Promise.all([listAdminApiKeys(), listAdminOAuthGrants()]);

  return (
    <>
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: ADMIN_API_DOCS_PATH, label: "Internal API" },
        ]}
      />

      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>{`${SITE_NAME} internal admin API`}</CardTitle>
            <CardDescription>
              The internal REST API and MCP server. Both authenticate with an internal API key or an
              OAuth access token that carries an <code className="font-mono text-xs">admin:*</code>{" "}
              scope, and both re-check the admin role on every request.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">REST: </span>
              <code className="font-mono text-xs">{`${SITE_URL}${ADMIN_API_BASE_PATH}`}</code>
            </p>
            <p>
              <span className="text-muted-foreground">MCP: </span>
              <code className="font-mono text-xs">{`${SITE_URL}${ADMIN_MCP_PATH}`}</code>
            </p>
            <p className="text-muted-foreground">
              Neither endpoint is advertised anywhere a client can discover it. Point an agent at
              the MCP URL with an internal key as its bearer token.
            </p>
          </CardContent>
        </Card>

        <AdminApiKeysPanel
          scopeOptions={toScopeOptions()}
          scopeDescriptions={describeAdminScopes(ADMIN_SCOPE_NAMES)}
          endpoints={{
            rest: `${SITE_URL}${ADMIN_API_BASE_PATH}`,
            mcp: `${SITE_URL}${ADMIN_MCP_PATH}`,
          }}
          keys={keys.map((key) => ({
            id: key.id,
            name: key.name,
            keyHint: formatApiKeyHint({ keyPrefix: key.keyPrefix, last4: key.last4 }),
            scopes: key.scopes,
            createdAt: formatDate(key.createdAt, DEFAULT_LOCALE),
            lastUsedAt: key.lastUsedAt ? formatDate(key.lastUsedAt, DEFAULT_LOCALE) : null,
            expiresAt: key.expiresAt ? formatDate(key.expiresAt, DEFAULT_LOCALE) : null,
          }))}
        />

        <AdminOAuthGrantsCard
          scopeDescriptions={describeAdminScopes(ADMIN_SCOPE_NAMES)}
          grants={grants.map((grant) => ({
            grantId: grant.grantId,
            name: grant.name ?? grant.clientId,
            clientId: grant.clientId,
            isVerified: grant.isVerified,
            scopes: grant.scopes,
            grantedAt: grant.grantedAt ? formatDate(new Date(grant.grantedAt), DEFAULT_LOCALE) : null,
          }))}
        />

        <Card>
          <CardHeader>
            <CardTitle>OpenAPI document for AI agents</CardTitle>
            <CardDescription>
              The operations of this surface are described once, in the machine-readable document.
              Hand that document to an agent instead of reading it here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <a
                href={OPENAPI_URL}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                <code className="font-mono text-xs">{OPENAPI_URL}</code>
              </a>
            </p>
            <p className="text-muted-foreground">
              The URL returns the internal OpenAPI 3.1 document. It works while you are logged in as
              an admin, so you can open it in the browser and save it.
            </p>
            <p className="text-muted-foreground">
              For an agent, create an internal API key above. Then either point an MCP client at the
              MCP URL with the key as its bearer token — the tools come from this same document — or
              give the agent the document and the REST base URL, and have it send{" "}
              <code className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</code> on every
              call. For example:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
              {`curl -H "Authorization: Bearer <key>" ${OPENAPI_URL}`}
            </pre>
            <p className="text-muted-foreground">
              The endpoint is not advertised anywhere. Do not paste the key into a shared prompt.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
