import { v } from "@/lib/validation";

// What the calling credential is, not who owns it — `/me` answers the second question and stays
// account-only. Nothing here validates at runtime; the handler's `v.InferOutput` annotation is the
// only check that the payload and the published document agree.

export const credentialSchema = v.object({
  /** How the credential was issued. */
  kind: v.picklist(["api-key", "oauth-grant"]),
  /** "personal" acts for the whole account; "team" is confined to one team. */
  audience: v.picklist(["personal", "team"]),
  /** The team a team credential is confined to, id only — name and slug stay behind the
   * `teams:read` scope, which this route does not require. Null means personal, nothing else. */
  team: v.nullable(
    v.object({
      id: v.string(),
    }),
  ),
  /** The scopes in force, narrower than the issued set when the catalog has dropped one or a team
   * key holds an account-only scope. The authoritative answer to "what may I call". */
  scopes: v.array(v.string()),
});
