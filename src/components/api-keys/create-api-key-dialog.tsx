"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ApiKeySecretReveal } from "@/components/api-keys/api-key-secret-reveal";
import { CreateApiKeyForm } from "@/components/api-keys/create-api-key-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

// Two disjoint bodies, one dialog: the form until a key exists, then the one-time secret reveal.
// This component owns only that switch and the open/close lifecycle.
export function CreateApiKeyDialog({ teamId }: { teamId?: string }) {
  const t = useTranslations("Client.Settings.ApiKeys");
  const [isOpen, setIsOpen] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  function close() {
    setIsOpen(false);
    // Dropping the secret with the dialog is what makes "shown exactly once" true.
    setCreatedSecret(null);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : close())}>
      <DialogTrigger render={<Button className="w-full sm:w-auto" />}>
        {t("createButton")}
      </DialogTrigger>
      {/* Both bodies need the room: the two-column scope grid, then the connect guide. */}
      <DialogContent className="sm:max-w-2xl">
        {createdSecret ? (
          <ApiKeySecretReveal secret={createdSecret} onDone={close} />
        ) : (
          <CreateApiKeyForm teamId={teamId} onCreated={setCreatedSecret} />
        )}
      </DialogContent>
    </Dialog>
  );
}
