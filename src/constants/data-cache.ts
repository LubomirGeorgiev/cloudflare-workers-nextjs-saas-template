/**
 * Import-free on purpose: `vite.config.ts` reads this value from its own config loader, which
 * resolves neither a tsconfig path alias nor an extensionless path, so anything this module
 * imported would have to be spelled the same way. Keep it a leaf.
 */

// How long an isolate may answer from memory instead of KV. It is both the `tagCacheTtlMs` of the
// Vinext data adapter and the TTL of the `memoForMs` layer in front of the hottest cached reads, so
// one publish-to-visible window covers both. See "The data cache costs one KV read per tag".
export const DATA_CACHE_MEMORY_TTL_MS = 60_000;
