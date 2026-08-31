"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

/**
 * The one-time secret reveal: header, the secret itself, a scrollable slot for whatever quickstart
 * suits the credential, and the copy/done footer.
 *
 * The secret lives in the caller's client state and disappears with its dialog, so nothing can
 * render it again. `children` is a slot rather than fixed content because the public and internal
 * surfaces point a new key at different endpoints, and showing the wrong ones would be worse than
 * showing none.
 */
export function ApiKeySecretPanel({
  secret,
  title,
  description,
  onDone,
  children,
}: {
  secret: string;
  title: string;
  description: string;
  onDone: () => void;
  /** Connection guidance for the surface this key reaches. */
  children?: ReactNode;
}) {
  const t = useTranslations("Client.Settings.ApiKeys");
  const tCommon = useTranslations("Client.Common");
  const { copy, hasCopied } = useCopyToClipboard();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="rounded-md border bg-muted/50 p-3">
        <code className="break-all font-mono text-sm">{secret}</code>
      </div>

      {children ? (
        <div className="max-h-[45vh] space-y-6 overflow-y-auto pr-1">{children}</div>
      ) : null}

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={() => copy(secret)}>
          {hasCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {hasCopied ? tCommon("copied") : t("copySecret")}
        </Button>
        <Button onClick={onDone}>{t("secretDone")}</Button>
      </DialogFooter>
    </>
  );
}
