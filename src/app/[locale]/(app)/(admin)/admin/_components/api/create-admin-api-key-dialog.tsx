"use client";

import { valibotResolver } from "@hookform/resolvers/valibot";
import { useForm } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createAdminApiKeyAction } from "../../_actions/admin-api-key-actions";
import { ApiKeyCreationDialog } from "@/components/api-keys/api-key-creation-dialog";
import { ApiKeyExpirySelect } from "@/components/api-keys/api-key-expiry-select";
import { ApiKeySecretPanel } from "@/components/api-keys/api-key-secret-panel";
import { ScopePicker, type ScopeOption } from "@/components/api-keys/scope-picker";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  createAdminApiKeySchema,
  type CreateAdminApiKeySchema,
} from "@/schemas/admin-api-key.schema";

// The internal twin of `CreateApiKeyDialog`, built from the same pieces: the shared
// `ApiKeyCreationDialog` shell, the shared `ScopePicker`, and the shared `ApiKeySecretPanel`.
//
// The scope options and the endpoint URLs arrive as props rather than as imports. The internal
// catalog is `server-only`, and importing `ADMIN_API_BASE_PATH` here would put the unadvertised
// paths into a public JavaScript chunk; as props they travel in this admin page's own payload.

export interface AdminApiEndpoints {
  rest: string;
  mcp: string;
}

export function CreateAdminApiKeyDialog({
  scopeOptions,
  endpoints,
}: {
  scopeOptions: ScopeOption[];
  endpoints: AdminApiEndpoints;
}) {
  return (
    <ApiKeyCreationDialog
      triggerLabel="Create internal key"
      renderForm={(onCreated) => (
        <CreateAdminApiKeyForm scopeOptions={scopeOptions} onCreated={onCreated} />
      )}
      renderSecret={({ secret, onDone }) => (
        <AdminApiKeySecretReveal secret={secret} endpoints={endpoints} onDone={onDone} />
      )}
    />
  );
}

function CreateAdminApiKeyForm({
  scopeOptions,
  onCreated,
}: {
  scopeOptions: ScopeOption[];
  onCreated: (secret: string | null) => void;
}) {
  const router = useRouter();

  const form = useForm<CreateAdminApiKeySchema>({
    resolver: valibotResolver(createAdminApiKeySchema),
    defaultValues: { name: "", scopes: [], expiresInDays: undefined },
  });

  const { execute, isExecuting } = useAction(createAdminApiKeyAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Could not create the key.");
    },
    onSuccess: ({ data }) => {
      toast.dismiss();
      toast.success("Internal key created.");
      onCreated(data?.secret ?? null);
      form.reset({ name: "", scopes: [], expiresInDays: undefined });
      router.refresh();
    },
  });

  const selectedScopes = form.watch("scopes") ?? [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create an internal key</DialogTitle>
        <DialogDescription>
          The only way to put an <code>admin:*</code> scope on an API key. Account settings never
          offer these scopes, and this key will not appear there either. The OAuth consent screen
          offers them only to a live admin approving a verified client — that path makes a grant,
          not a key. Every request also re-checks that you still hold the admin role.
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => execute(values))}
          className="space-y-5 pt-2"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="Ops runbook agent" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="scopes"
            render={() => (
              <ScopePicker
                label="Internal scopes"
                options={scopeOptions}
                selectedScopes={selectedScopes}
                onChange={(scopes) =>
                  form.setValue("scopes", scopes, { shouldValidate: true, shouldDirty: true })
                }
              />
            )}
          />

          <FormField
            control={form.control}
            name="expiresInDays"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expiry</FormLabel>
                <ApiKeyExpirySelect
                  value={field.value}
                  onChange={field.onChange}
                  label="Expiry"
                  neverLabel="Never expires"
                  formatDays={(days) => `${days} days`}
                />
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={isExecuting}>
              Create key
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}

function AdminApiKeySecretReveal({
  secret,
  endpoints,
  onDone,
}: {
  secret: string;
  endpoints: AdminApiEndpoints;
  onDone: () => void;
}) {
  return (
    <ApiKeySecretPanel
      secret={secret}
      title="Copy this key now"
      description="It is shown once and is never recoverable. It reaches the internal endpoints below and nothing else."
      onDone={onDone}
    >
      <div className="space-y-3 text-sm">
        <EndpointRow label="REST" url={endpoints.rest} />
        <EndpointRow label="MCP" url={endpoints.mcp} />
        <p className="text-xs text-muted-foreground">
          Send it as <code>Authorization: Bearer &lt;key&gt;</code>. Neither endpoint is advertised
          in the OpenAPI document, the API catalog, or llms.txt.
        </p>
      </div>
    </ApiKeySecretPanel>
  );
}

function EndpointRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="rounded-md border bg-muted/40 p-2">
        <code className="break-all font-mono text-xs">{url}</code>
      </div>
    </div>
  );
}
