"use client";

import { useState, useRef} from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  generateRegistrationOptionsAction,
  verifyRegistrationAction,
  deletePasskeyAction,
} from "./passkey-settings.actions";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeDateTime } from "@/utils/format-date";
import { formatDeviceDescription } from "@/utils/format-device-description";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { PASSKEY_AUTHENTICATOR_IDS } from "@/utils/passkey-authenticator-ids";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import type { ParsedUserAgent } from "@/types";

interface PasskeyRegistrationButtonProps {
  email: string;
  className?: string;
  onSuccess?: () => void;
}

function PasskeyRegistrationButton({ email, className, onSuccess }: PasskeyRegistrationButtonProps) {
  const [isRegistering, setIsRegistering] = useState(false);
  const router = useRouter();
  const t = useTranslations("Client.Settings.Security");

  const handleRegister = async () => {
    try {
      setIsRegistering(true);

      const { data: options, serverError: optionsError } = await generateRegistrationOptionsAction({ email });

      if (optionsError || !options) {
        throw new Error(optionsError?.message || t("toastOptionsError"));
      }

      // Start the registration process in the browser
      const registrationResponse = await startRegistration({
        optionsJSON: options,
      });

      // Send the response back to the server for verification
      const { serverError: verificationError } = await verifyRegistrationAction({
        email,
        response: registrationResponse,
      });

      if (verificationError) {
        throw new Error(verificationError.message);
      }

      toast.success(t("toastRegisterSuccess"));
      onSuccess?.();
      router.refresh();
    } catch (error) {
      console.error("Passkey registration error:", error);
      toast.error(error instanceof Error ? error.message : t("toastRegisterError"));
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <Button
      onClick={handleRegister}
      disabled={isRegistering}
      className={className}
    >
      {isRegistering ? t("registering") : t("registerButton")}
    </Button>
  );
}

interface Passkey {
  id: string;
  credentialId: string;
  userId: string;
  createdAt: Date;
  aaguid: string | null;
  userAgent: string | null;
  parsedUserAgent?: ParsedUserAgent;
}

interface PasskeysListProps {
  passkeys: Passkey[];
  currentPasskeyId: string | null;
  email: string | null;
}

export function PasskeysList({ passkeys, currentPasskeyId, email }: PasskeysListProps) {
  const router = useRouter();
  const locale = useLocale();
  const dialogCloseRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations("Client.Settings.Security");
  const tCommon = useTranslations("Client.Common");
  const tDevice = useTranslations("Client.Settings.Device");
  const { execute: deletePasskey } = useAction(deletePasskeyAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || t("toastDeleteError"));
    },
    onSuccess: () => {
      toast.success(t("toastDeleteSuccess"));
      dialogCloseRef.current?.click();
      router.refresh();
    }
  });

  const isCurrentPasskey = (passkey: Passkey) =>
    passkey.credentialId === currentPasskeyId;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("passkeysHeading")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("passkeysSubheading")}
          </p>
        </div>
        {email && (
          <PasskeyRegistrationButton
            email={email}
            className="w-full sm:w-auto"
          />
        )}
      </div>

      <div className="space-y-4">
        {passkeys.map((passkey) => (
          <Card key={passkey.id} className={cn(!isCurrentPasskey(passkey) ? "bg-card/40" : "border-3 border-primary/20 shadow-lg bg-secondary/30")}>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {passkey.aaguid && (PASSKEY_AUTHENTICATOR_IDS as Record<string, string>)[passkey.aaguid] || t("unknownAuthenticator")}
                      {isCurrentPasskey(passkey) && <Badge>{t("currentPasskeyBadge")}</Badge>}
                    </CardTitle>
                    <div className="text-sm text-muted-foreground whitespace-nowrap">
                      · {formatRelativeDateTime(passkey.createdAt, locale)}
                    </div>
                  </div>
                  {passkey.parsedUserAgent && (
                    <CardDescription className="text-sm">
                      {formatDeviceDescription({ t: tDevice, parsedUserAgent: passkey.parsedUserAgent })}
                    </CardDescription>
                  )}
                </div>
                <div>
                  {!isCurrentPasskey(passkey) && (
                    <Dialog>
                      <DialogTrigger
                        render={<Button size="sm" variant="destructive" className="w-full sm:w-auto" />}
                      >
                        {t("deletePasskey")}
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("deletePasskeyConfirmTitle")}</DialogTitle>
                          <DialogDescription>
                            {t("deletePasskeyConfirmDescription")}
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="mt-6 sm:mt-0">
                          <DialogClose
                            ref={dialogCloseRef}
                            render={<Button variant="outline" />}
                          >
                            {tCommon("cancel")}
                          </DialogClose>
                          <Button
                            variant="destructive"
                            className="mb-4 sm:mb-0"
                            onClick={() => deletePasskey({ credentialId: passkey.credentialId })}
                          >
                            {t("deletePasskey")}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}

        {passkeys.length === 0 && (
          <div className="text-center text-muted-foreground mt-10">
            {t("emptyState")}
          </div>
        )}
      </div>
    </div>
  );
}
