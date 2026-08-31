import type { Route } from "next"

export const SITE_NAME = "SaaS Template"
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://nextjs-saas-template.lubomirgeorgiev.com"
    : "http://localhost:3000")
export const GITHUB_REPO_URL = "https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template"

// API key format. Rebrand these prefixes when forking: secret scanners attribute a leaked key to
// whoever owns the prefix, so borrowing another vendor's shape (e.g. `sk_live_`) misroutes reports.
export const API_KEY_PREFIX_LIVE = "saas_live_";
export const API_KEY_PREFIX_TEST = "saas_test_";
// Internal keys carry their own prefix so a leaked one is recognisable at a glance — in a log, a
// paste, or a secret scanner's report — without anyone having to look its scopes up. It extends the
// live prefix rather than replacing it: an internal key is a live key, and a scanner rule written
// for `saas_live_` still catches it.
export const API_KEY_PREFIX_ADMIN = `${API_KEY_PREFIX_LIVE}admin_`;
export const API_KEY_SECRET_BYTES = 32;
export const API_KEY_NAME_MAX_LENGTH = 100;
export const API_KEY_MAX_EXPIRY_DAYS = 365;
export const API_KEY_EXPIRY_DAY_OPTIONS = [30, 90, API_KEY_MAX_EXPIRY_DAYS];
export const MAX_API_KEYS_PER_USER = 20;
export const MAX_API_KEYS_PER_TEAM = 20;
// Revocation deletes the KV entry, so the worst-case acceptance window is this TTL plus KV's
// cross-PoP propagation (~60s). Keep it short enough that the UI copy stays honest.
export const API_KEY_CACHE_TTL_SECONDS = 300;
// Bump when the cached API-key snapshot shape or its permission semantics change. v2: the stored
// `teamId` became the key's enforced audience, so v1 snapshots must not be read under the new rules.
export const CURRENT_API_KEY_CACHE_VERSION = 2;

// Public machine API (Hono app in `src/api/`). The base path is edge-routed in
// `worker-entrypoint.ts`, is the OpenAPI `servers` entry, and is what the docs UI reads.
export const API_V1_BASE_PATH = "/api/v1";
export const LLMS_TXT_PATH = "/llms.txt";
// File-local: `LLMS_DESCRIBED_BY_RELATION.href` is the one URL every consumer reads.
const LLMS_TXT_URL = `${SITE_URL}${LLMS_TXT_PATH}`;
// One definition of the root llms.txt relation. A Markdown response advertises it alone; HTML
// advertises it as part of `HTML_DISCOVERY_RELATIONS` below.
export const LLMS_DESCRIBED_BY_RELATION = {
  href: LLMS_TXT_URL,
  rel: "describedby",
  type: "text/plain",
} as const;

// The `.md` twin's media type and URL suffix. They live here, not next to the Markdown code, so
// the `Accept` prefilter in `worker-entrypoint.ts` can compare against the real value: that gate
// runs on every page request, and this module is already on the entry's static graph.
export const MARKDOWN_CONTENT_TYPE = "text/markdown";
export const MARKDOWN_EXTENSION = ".md";
// The other two media types the edge compares against or stamps. They share this home so the HTML
// gate in `worker-entrypoint.ts`, the API catalog, and the OpenAPI document cannot drift apart.
export const HTML_CONTENT_TYPE = "text/html";
export const JSON_CONTENT_TYPE = "application/json";
// Both representations of a Markdown-capable URL send this `Vary` field, so a cache can key them
// apart. It lives here so the 303 and the HTML `Link` stamp read it without importing each other.
// Keep the value lowercase: the append guard compares it against normalized `Vary` tokens.
export const ACCEPT_VARY_FIELD = "accept";
export const API_OPENAPI_SPEC_PATH = `${API_V1_BASE_PATH}/openapi.json`;
// The document is a static read, so only the safe methods serve it. Shared by the Hono route and
// the edge fast path in `worker-entrypoint.ts`: anything else must fall through to the auth chain.
export const API_OPENAPI_SPEC_METHODS = ["GET", "HEAD"] as const;
export const API_DOCS_PATH = "/docs/api";
// Dereferenceable target of the RFC 9457 `type` member: one anchor per stable error code.
export const API_ERRORS_DOCS_PATH = `${API_DOCS_PATH}/errors`;
export const API_AUTH_DOCS_PATH = "/docs/authentication";
// Remote MCP server (Streamable HTTP). Mounted on the OAuth provider in `worker-entrypoint.ts`, so
// it accepts an API key or an OAuth access token; this is the URL users paste into agent clients.
export const MCP_PATH = "/mcp";
export const MCP_DOCS_PATH = "/docs/mcp";

// ---------------------------------------------------------------------------
// Internal admin surface. Neither path appears in the OpenAPI document, the RFC 9727 catalog,
// `llms.txt`, the sitemap, or any `WWW-Authenticate` challenge a public route sends. They are
// documented for staff at `ADMIN_API_DOCS_PATH` and nowhere else.
//
// Not secret paths — a guessed path answers 401/403 like any other — but unadvertised ones: the
// authorization is `assertAdminPrincipal` (an `admin:*` scope AND a live admin role), never the
// obscurity. Both are edge-routed in `worker-entrypoint.ts` onto the same OAuth provider funnel as
// the public surface, so an admin API key authenticates through exactly one code path.
// ---------------------------------------------------------------------------
// Every scope name in either catalog is far shorter; this is the ceiling an unvalidated scope
// string is bounded by before it reaches the catalog check that actually decides.
export const API_SCOPE_NAME_MAX_LENGTH = 64;
export const ADMIN_API_BASE_PATH = "/api/admin/v1";
export const ADMIN_MCP_PATH = "/mcp/admin";
// Version of the published API contract, not of the app; it is the OpenAPI `info.version`.
export const API_VERSION = "1.0.0";
// RFC 9727. One document naming every API this deployment publishes — the REST API and the MCP
// server — as an RFC 9264 linkset, so an agent that knows only the origin can find both. Built from
// these constants and served at the edge; advertised on HTML the two ways llms.txt is.
export const API_CATALOG_PATH = "/.well-known/api-catalog";
export const API_CATALOG_CONTENT_TYPE = "application/linkset+json";
// The catalog is a static read like the OpenAPI document, so only the safe methods serve it.
// Shared by the edge fast path in `worker-entrypoint.ts` and its test: anything else falls through.
export const API_CATALOG_METHODS = ["GET", "HEAD"] as const;
// File-local: every consumer reads the relation through `HTML_DISCOVERY_RELATIONS` below.
const API_CATALOG_RELATION = {
  href: `${SITE_URL}${API_CATALOG_PATH}`,
  rel: "api-catalog",
  type: API_CATALOG_CONTENT_TYPE,
} as const;
// One definition of what every HTML response advertises, in the order it advertises them. Two
// channels carry the set — the `Link` header the Worker stamps and the `<link>`s the shell renders
// — so a new relation goes here and reaches both, instead of reaching one and drifting.
export const HTML_DISCOVERY_RELATIONS = [LLMS_DESCRIBED_BY_RELATION, API_CATALOG_RELATION] as const;
// OAuth 2.1 endpoints. `/oauth/authorize` is our own consent page; the other two are implemented
// by @cloudflare/workers-oauth-provider, which wraps the Worker in `worker-entrypoint.ts`.
export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/oauth/token";
export const OAUTH_REGISTER_PATH = "/oauth/register";
// The only methods issuance throttling charges. Shared by the gate that enforces it and the edge
// pre-check in `worker-entrypoint.ts`, so widening it can never silently exempt the entrypoint.
export const OAUTH_ISSUANCE_THROTTLED_METHODS: readonly string[] = ["POST"];
// RFC 9728. Advertised on every 401 so MCP/OAuth clients can discover the authorization server.
export const OAUTH_PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
// Template kill-switch for open dynamic client registration (RFC 7591), like I18N_ENABLED.
// With DCR off, agent clients must use CIMD or a manually created client; consent, tokens, and
// discovery are unaffected. Registration is harmless on its own — consent is the real gate — but
// unverified clients are still clamped to DCR_ALLOWED_SCOPES (src/lib/api/scopes.ts).
export const OAUTH_OPEN_DCR_ENABLED = true;
// Server-side OAuth lifecycle tuning (token/registration lifetimes, cron sweep budgets, grant
// cache) lives in `constants/oauth.ts`; new server knobs belong there, not here. Re-exported
// because the rest of the app already looks for constants at this path.
export * from "@/constants/oauth";
// Both KV key-space registries live in `constants/kv-prefixes.ts` — import them from there.

export const SITE_DOMAIN = new URL(SITE_URL).hostname
export const PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS = 24 * 60 * 60 // 24 hours
export const EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS = 24 * 60 * 60 // 24 hours
export const MAX_SESSIONS_PER_USER = 5;
export const MAX_TEAMS_CREATED_PER_USER = 3;
export const MAX_TEAMS_JOINED_PER_USER = 10;
export const TEAM_INVITATION_EXPIRY_DAYS = 7;
export const SESSION_COOKIE_NAME = "session";
export const AUTH_SESSION_PRESENT_COOKIE_NAME = "auth_session_present";
export const GOOGLE_OAUTH_STATE_COOKIE_NAME = "google-oauth-state";
export const GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME = "google-oauth-code-verifier";

// Master switch for internationalization. When false, the app serves only DEFAULT_LOCALE: the
// `/<locale>` prefixed routes, language switcher, hreflang/alternate meta tags, per-locale sitemap entries,
// and Accept-Language locale detection are all disabled. The next-intl translation layer still powers UI strings from the default catalog, so single-language sites keep working.
export const I18N_ENABLED = true;

export const BLOG_POSTS_PER_PAGE = 12;
export const REDIRECT_AFTER_SIGN_IN = "/dashboard" as Route;
// App routes that more than one server action revalidates. API keys render on both surfaces, so a
// team key write has to invalidate the team page as well as the settings page.
export const SETTINGS_API_MCP_PATH = "/settings/api-mcp" satisfies Route;
export const TEAMS_DASHBOARD_PATH = "/dashboard/teams" satisfies Route;
export const ADMIN_OAUTH_APPS_PATH = "/admin/oauth-apps" satisfies Route;
/** Staff-only reference for the internal admin API and MCP endpoints, and where their keys are minted. */
export const ADMIN_API_DOCS_PATH = "/admin/api" satisfies Route;
export const ADMIN_USERS_PATH = "/admin/users" satisfies Route;
export const ADMIN_TEAMS_PATH = "/admin/teams" satisfies Route;
// Gemma 4 26B (A4B, instruction-tuned): chat-completions model used for SEO descriptions and CMS
export const DEFAULT_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it' as const satisfies keyof AiModels;

// CMS Image Upload Configuration
export const CMS_IMAGES_BASE_PATH = "cms-images" as const;
export const CMS_IMAGES_API_ROUTE = `/api/${CMS_IMAGES_BASE_PATH}` as const;
export const CMS_IMAGE_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const CMS_ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;

export const CMS_SEO_DESCRIPTION_MAX_LENGTH = 160;
export const CMS_TITLE_MAX_LENGTH = 255;
export const CMS_TAG_NAME_MAX_LENGTH = 100;
export const CMS_TAG_DESCRIPTION_MAX_LENGTH = 1000;
export const CMS_TAG_COLOR_MAX_LENGTH = 32;
export const CMS_MEDIA_ALT_MAX_LENGTH = 1000;
export const CMS_NAVIGATION_TITLE_MAX_LENGTH = 255;
// Collection caps: an unbounded array is unbounded work per request, the same problem as an
// unbounded string. Generous enough that no real editor hits them.
export const CMS_MAX_TAGS_PER_ENTRY = 50;
export const CMS_MAX_NAVIGATION_NODES = 500;
export const CMS_MAX_SLUGS_PER_LOOKUP = 200;

// Every free-form string a caller can send states a maximum. Without one a request can spend our
// CPU, D1 row budget, and KV value size for free, so these are the shared ceilings for the kinds
// of string that have no domain limit of their own; anything with a real limit gets its own above.
export const ID_MAX_LENGTH = 255;
export const TOKEN_MAX_LENGTH = 512;
export const EMAIL_MAX_LENGTH = 255;
// Turnstile documents its response token as up to 2048 characters.
export const CAPTCHA_TOKEN_MAX_LENGTH = 2048;
// The whole OAuth authorize query string, round-tripped through the consent form.
export const OAUTH_QUERY_MAX_LENGTH = 4096;
export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SLUG_MAX_LENGTH = 255;

// Shared by every schema that collects a person's name (sign-up, passkey registration, profile
// settings) so the limit and its validation copy stay in one place.
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 255;

// Shared by team create and team rename so both paths enforce one limit.
export const TEAM_NAME_MAX_LENGTH = 100;
export const TEAM_DESCRIPTION_MAX_LENGTH = 1000;

// Pagination for every admin table. The default and max are also the server-side API contract,
// declared explicitly so that editing or reordering the presentational dropdown list cannot
// silently change what the server accepts; `src/constants.test.ts` keeps the three in step.
export const DEFAULT_ADMIN_TABLE_PAGE_SIZE = 10;
export const MAX_ADMIN_TABLE_PAGE_SIZE = 500;
export const ADMIN_TABLE_PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50, 100, 300, 500];
