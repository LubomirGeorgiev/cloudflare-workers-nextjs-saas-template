"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { API_SCOPES, API_SCOPE_NAMES, type ApiScope } from "@/lib/api/scopes";
import { cn } from "@/lib/utils";

/**
 * The `scopes` field, shared by the create and edit forms so a key is granted and re-granted
 * through the same list. Owns the set semantics; the caller only stores what it hands back, and
 * renders it inside its own `FormField` so the label and message bind to that form's state.
 */
export function ScopePicker({
  selectedScopes,
  onChange,
}: {
  selectedScopes: ApiScope[];
  onChange: (scopes: ApiScope[]) => void;
}) {
  const t = useTranslations("Client.Settings.ApiKeys");
  const tScopes = useTranslations("Client.Settings.ApiKeys.Scopes");

  // Scope copy is translated where a catalog entry exists; forks that add their own scopes fall
  // back to the machine-facing description that also feeds the docs and consent screens.
  function scopeDescription(scope: ApiScope): string {
    return tScopes.has(scope) ? tScopes(scope) : API_SCOPES[scope].description;
  }

  function toggleScope(scope: ApiScope): void {
    onChange(
      selectedScopes.includes(scope)
        ? selectedScopes.filter((value) => value !== scope)
        : [...selectedScopes, scope],
    );
  }

  return (
    <FormItem>
      <FormLabel>{t("scopesLabel")}</FormLabel>
      <div className="grid max-h-64 gap-2 overflow-y-auto rounded-md border p-2">
        {API_SCOPE_NAMES.map((scope) => (
          <ScopeToggle
            key={scope}
            scope={scope}
            description={scopeDescription(scope)}
            isSelected={selectedScopes.includes(scope)}
            onToggle={() => toggleScope(scope)}
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
  scope: ApiScope;
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
