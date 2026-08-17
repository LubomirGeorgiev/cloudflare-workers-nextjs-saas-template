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
// Version of the published API contract, not of the app; it is the OpenAPI `info.version`.
export const API_VERSION = "1.0.0";
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
export const ADMIN_USERS_PATH = "/admin/users" satisfies Route;
// Llama 3.3 70B (fp8-fast): strong multilingual quality, ~700ms latency, and — unlike the Gemma models —
// accessible on this account. Used for SEO descriptions and CMS translation. Verify a replacement actually
// runs (some catalog models 504 or are access-gated) before swapping.
export const DEFAULT_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const satisfies keyof AiModels;

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
