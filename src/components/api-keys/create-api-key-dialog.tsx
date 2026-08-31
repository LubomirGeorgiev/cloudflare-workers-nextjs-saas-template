"use client";

import { useTranslations } from "next-intl";

import { ApiKeyCreationDialog } from "@/components/api-keys/api-key-creation-dialog";
import { ApiKeySecretReveal } from "@/components/api-keys/api-key-secret-reveal";
import { CreateApiKeyForm } from "@/components/api-keys/create-api-key-form";

/** The settings surface's key creation: the shared dialog, with the public form and reveal. */
export function CreateApiKeyDialog({ teamId }: { teamId?: string }) {
  const t = useTranslations("Client.Settings.ApiKeys");

  return (
    <ApiKeyCreationDialog
      triggerLabel={t("createButton")}
      renderForm={(onCreated) => <CreateApiKeyForm teamId={teamId} onCreated={onCreated} />}
      renderSecret={({ secret, onDone }) => (
        <ApiKeySecretReveal secret={secret} onDone={onDone} />
      )}
    />
  );
}
