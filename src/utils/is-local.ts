import { LOCAL_HOSTNAMES, SITE_DOMAIN } from "@/constants";

// NODE_ENV cannot make this call: `pnpm preview` is a production build on localhost:8787.
// SITE_URL can — `pnpm dev` falls back to localhost:3000 and `pnpm preview` builds with
// NEXT_PUBLIC_SITE_URL=http://localhost:8787, so one check covers both ports.
export const isLocalhost = LOCAL_HOSTNAMES.includes(SITE_DOMAIN);
