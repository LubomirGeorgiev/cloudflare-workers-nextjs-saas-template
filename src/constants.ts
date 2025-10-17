import type { Route } from "next"

export const SITE_NAME = "SaaS Template"
export const SITE_DESCRIPTION = "A modern SaaS template built with Next.js 15 and Cloudflare Workers, designed for scalability and performance."
export const SITE_URL = process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://nextjs-saas-template.lubomirgeorgiev.com"
export const GITHUB_REPO_URL = "https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template"

export const SITE_DOMAIN = new URL(SITE_URL).hostname
export const PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS = 24 * 60 * 60 // 24 hours
export const EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS = 24 * 60 * 60 // 24 hours
export const MAX_SESSIONS_PER_USER = 5;
export const MAX_TEAMS_CREATED_PER_USER = 3;
export const MAX_TEAMS_JOINED_PER_USER = 10;
export const SESSION_COOKIE_NAME = "session";
export const GOOGLE_OAUTH_STATE_COOKIE_NAME = "google-oauth-state";
export const GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME = "google-oauth-code-verifier";

export const DISABLE_CREDIT_BILLING_SYSTEM = false;
export const CREDIT_PACKAGES = [
  { id: "package-1", credits: 500, price: 5 },
  { id: "package-2", credits: 1200, price: 10 },
  { id: "package-3", credits: 3000, price: 20 },
] as const;
export const CREDITS_EXPIRATION_YEARS = 2;
export const FREE_MONTHLY_CREDITS = CREDIT_PACKAGES[0].credits * 0.1;

export const MAX_TRANSACTIONS_PER_PAGE = 10;
export const REDIRECT_AFTER_SIGN_IN = "/dashboard" as Route;
