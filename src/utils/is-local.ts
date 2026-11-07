import { LOCAL_HOSTNAMES, SITE_DOMAIN } from "@/constants";

// NODE_ENV cannot make this call: `pnpm preview` is a production build on localhost:8787.
// SITE_URL can — `pnpm dev` falls back to localhost:3000 and `pnpm preview` builds with
// NEXT_PUBLIC_SITE_URL=http://localhost:8787, so one check covers both ports.
const isLocalhost = LOCAL_HOSTNAMES.includes(SITE_DOMAIN);

// The opt-in covers a build served on a non-local URL, such as a VPS reached over a private
// network. The deploy guard in `scripts/utils/deploy-site-url.mjs` refuses it in production.
export const isLocalMode = isLocalhost || process.env.NEXT_PUBLIC_APP_LOCAL_MODE === "true";
