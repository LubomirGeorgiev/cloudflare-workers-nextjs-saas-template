"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { API_SCOPES, API_SCOPE_NAMES, scopesForAudience, type ApiScope } from "@/lib/api/scopes";
import { cn } from "@/lib/utils";

/** One selectable scope: the name a credential stores, and the sentence a person reads. */
export interface ScopeOption<Scope extends string = string> {
  name: Scope;
  description: string;
}

/**
 * The public catalog as picker options, narrowed by the key's audience. A team key is refused every
 * account-level operation, so offering it those scopes would only mint a grant it can never use.
 *
 * Separate from the picker below so the picker itself holds no catalog. That is what lets the admin
 * panel render the same control for the internal catalog, which is `server-only` and reaches the
 * browser as props rather than as an import.
 */
export function useApiScopeOptions({ teamId }: { teamId?: string | null } = {}): ScopeOption<ApiScope>[] {
  const tScopes = useTranslations("Client.ApiScopes");
  // The one narrowing rule, read from the catalog, so this cannot drift from the services.
  const offeredScopes = scopesForAudience({ scopes: API_SCOPE_NAMES, teamId: teamId ?? null });

  // Scope copy is translated where a catalog entry exists; forks that add their own scopes fall
  // back to the machine-facing description that also feeds the docs and consent screens.
  return offeredScopes.map((name) => ({
    name,
    description: tScopes.has(name) ? tScopes(name) : API_SCOPES[name].description,
  }));
}

/**
 * The `scopes` field, shared by every form that grants them so a key is granted and re-granted
 * through one control. Owns the set semantics; the caller only stores what it hands back, and
 * renders it inside its own `FormField` so the label and message bind to that form's state.
 */
export function ScopePicker<Scope extends string>({
  options,
  selectedScopes,
  onChange,
  label,
}: {
  options: readonly ScopeOption<Scope>[];
  selectedScopes: Scope[];
  onChange: (scopes: Scope[]) => void;
  /** Overrides the default label, for a form granting a scope family of its own. */
  label?: string;
}) {
  const t = useTranslations("Client.Settings.ApiKeys");

  function toggleScope(scope: Scope): void {
    onChange(
      selectedScopes.includes(scope)
        ? selectedScopes.filter((value) => value !== scope)
        : [...selectedScopes, scope],
    );
  }

  // One control, both directions: the label follows what pressing it would do.
  const areAllSelected = selectedScopes.length === options.length;

  return (
    <FormItem>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FormLabel>{label ?? t("scopesLabel")}</FormLabel>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("scopesSelectedCount", {
              selected: selectedScopes.length,
              total: options.length,
            })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onChange(areAllSelected ? [] : options.map((option) => option.name))}
          >
            {areAllSelected ? t("clearAllScopes") : t("selectAllScopes")}
          </Button>
        </div>
      </div>
      <div className="grid max-h-[24rem] gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
        {options.map((option) => (
          <ScopeToggle
            key={option.name}
            scope={option.name}
            description={option.description}
            isSelected={selectedScopes.includes(option.name)}
            onToggle={() => toggleScope(option.name)}
          />
        ))}
      </div>
      <FormMessage />
    </FormItem>
  );
}

function ScopeToggle({
  scope,
  description,
  isSelected,
  onToggle,
}: {
  scope: string;
  description: string;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isSelected}
      className={cn(
        "flex items-start gap-3 rounded-md border p-2 text-left transition-colors",
        isSelected ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          isSelected && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {isSelected && <Check className="h-3 w-3" />}
      </span>
      <span className="space-y-0.5">
        <span className="block font-mono text-xs">{scope}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
