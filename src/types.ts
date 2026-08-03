import type { KVSession } from "./utils/kv-session";

/** A browser caller's real KV session: the only kind a session-keyed write can act on. */
export type CookieSession = KVSession & { kind: "cookie" };

/**
 * A bearer credential (API key / OAuth grant) stores nothing in KV, so its session is synthesized
 * and the KV-storage fields are null rather than invented.
 */
type BearerSession = Omit<KVSession, "id" | "createdAt" | "expiresAt"> & {
  kind: "bearer";
  id: null;
  createdAt: null;
  expiresAt: null;
};

// What getCurrentSession returns. `kind` is the discriminant: narrow on it rather than testing
// `id` for null, so a session-keyed write can never silently no-op on a bearer caller.
export type CurrentSession = CookieSession | BearerSession;

export type SessionValidationResult =
  | CurrentSession
  | null;

export interface ParsedUserAgent {
  ua: string;
  browser: {
    name?: string;
    version?: string;
    major?: string;
  };
  device: {
    model?: string;
    type?: string;
    vendor?: string;
  };
  engine: {
    name?: string;
    version?: string;
  };
  os: {
    name?: string;
    version?: string;
  };
}

export interface SessionWithMeta extends KVSession {
  isCurrentSession: boolean;
  expiration?: Date;
  createdAt: number;
  userAgent?: string | null;
  parsedUserAgent?: ParsedUserAgent;
}
