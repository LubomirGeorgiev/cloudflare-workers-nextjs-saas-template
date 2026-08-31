"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

/**
 * Two disjoint bodies, one dialog: the creation form until a key exists, then the one-time secret
 * reveal. This component owns only that switch and the open/close lifecycle, so every surface that
 * mints a key — account settings, team settings, the admin panel — gets the same behaviour.
 *
 * The secret lives here in client state and is dropped when the dialog closes, which is what makes
 * "shown exactly once" true. Both bodies are render props rather than fixed content because each
 * surface has its own form and its own connection guidance.
 */
export function ApiKeyCreationDialog({
  triggerLabel,
  renderForm,
  renderSecret,
}: {
  triggerLabel: ReactNode;
  renderForm: (onCreated: (secret: string | null) => void) => ReactNode;
  renderSecret: (params: { secret: string; onDone: () => void }) => ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  function close() {
    setIsOpen(false);
    setCreatedSecret(null);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : close())}>
      <DialogTrigger render={<Button className="w-full sm:w-auto" />}>{triggerLabel}</DialogTrigger>
      {/* Both bodies need the room: the two-column scope grid, then the connect guide. */}
      <DialogContent className="sm:max-w-2xl">
        {createdSecret
          ? renderSecret({ secret: createdSecret, onDone: close })
          : renderForm(setCreatedSecret)}
      </DialogContent>
    </Dialog>
  );
}
