import {
  API_SCOPE_NAMES,
  apiScopeAction,
  apiScopeResource,
  compareByCatalogOrder,
  isApiScope,
  scopesForAudience,
} from "./scopes";

interface ApiScopeSummary {
  scopeCount: number;
  /** Every scope the credential's audience may hold is granted. */
  isFullAccess: boolean;
  /** No scope grants anything beyond a `read` action. */
  isReadOnly: boolean;
  /** Resource prefixes (`teams` of `teams:read`), in catalog order; unknown ones follow. */
  resources: string[];
}

const READ_ACTION = "read";

/**
 * The one-line reading of a scope list: how much of the catalog it covers, whether it can change
 * anything, and which resources it touches. Catalog order keeps the same grant reading the same
 * on every credential, and a scope outside the catalog still counts rather than being dropped.
 */
export function summarizeApiScopes({
  scopes,
  teamId,
}: {
  scopes: string[];
  teamId?: string | null;
}): ApiScopeSummary {
  const catalog = scopesForAudience({ scopes: API_SCOPE_NAMES, teamId: teamId ?? null });

  // A catalog scope the audience may not hold grants nothing, because the audience guard refuses
  // it whatever the grant says. So the whole summary reads the usable scopes, not the stored ones.
  // A scope outside the catalog still counts.
  const granted = new Set(
    scopes.filter((scope) => !isApiScope(scope) || catalog.includes(scope)),
  );
  const usable = [...granted];
  const orderedResources = usable.toSorted(compareByCatalogOrder).map(apiScopeResource);

  return {
    scopeCount: granted.size,
    isFullAccess: catalog.length > 0 && catalog.every((scope) => granted.has(scope)),
    isReadOnly: usable.length > 0 && usable.every((scope) => apiScopeAction(scope) === READ_ACTION),
    resources: [...new Set(orderedResources)],
  };
}
