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
import { formatDistanceToNow } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import { useServerAction } from "zsa-react";
import { PASSKEY_AUTHENTICATOR_IDS } from "@/utils/passkey-authenticator-ids";
import { cn } from "@/lib/utils";
import type { ParsedUserAgent } from "@/types";

interface PasskeyRegistrationButtonProps {
  email: string;
  className?: string;
  onSuccess?: () => void;
}

function PasskeyRegistrationButton({ email, className, onSuccess }: PasskeyRegistrationButtonProps) {
  const [isRegistering, setIsRegistering] = useState(false);
  const router = useRouter();

  const handleRegister = async () => {
    try {
      setIsRegistering(true);

      // Get registration options from the server
      const [options] = await generateRegistrationOptionsAction({ email });

      if (!options) {
        throw new Error("Failed to get registration options");
      }

      // Start the registration process in the browser
      const registrationResponse = await startRegistration({
        optionsJSON: options,
      });

      // Send the response back to the server for verification
      await verifyRegistrationAction({
        email,
        response: registrationResponse,
        challenge: options.challenge,
      });

      toast.success("Passkey registered successfully");
      onSuccess?.();
      router.refresh();
    } catch (error) {
      console.error("Passkey registration error:", error);
      toast.error("Failed to register passkey");
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
      {isRegistering ? "Registering..." : "Register Passkey"}
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
  const dialogCloseRef = useRef<HTMLButtonElement>(null);
  const { execute: deletePasskey } = useServerAction(deletePasskeyAction, {
    onSuccess: () => {
      toast.success("Passkey deleted");
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
          <h2 className="text-lg font-semibold">Passkeys</h2>
          <p className="text-sm text-muted-foreground">
            Manage your passkeys for passwordless authentication.
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
                      {passkey.aaguid && (PASSKEY_AUTHENTICATOR_IDS as Record<string, string>)[passkey.aaguid] || "Unknown Authenticator App"}
                      {isCurrentPasskey(passkey) && <Badge>Current Passkey</Badge>}
                    </CardTitle>
                    <div className="text-sm text-muted-foreground whitespace-nowrap">
                      · {formatDistanceToNow(passkey.createdAt)} ago
                    </div>
                  </div>
                  {passkey.parsedUserAgent && (
                    <CardDescription className="text-sm">
                      {passkey.parsedUserAgent.browser.name ?? "Unknown browser"} {passkey.parsedUserAgent.browser.major ?? "Unknown version"} on {passkey.parsedUserAgent.device.vendor ?? "Unknown device"} {passkey.parsedUserAgent.device.model ?? "Unknown model"} {passkey.parsedUserAgent.device.type ?? "Unknown type"} ({passkey.parsedUserAgent.os.name ?? "Unknown OS"} {passkey.parsedUserAgent.os.version ?? "Unknown version"})
                    </CardDescription>
                  )}
                </div>
                <div>
                  {!isCurrentPasskey(passkey) && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="destructive" className="w-full sm:w-auto">Delete passkey</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Delete passkey?</DialogTitle>
                          <DialogDescription>
                            This will remove this passkey from your account. This action cannot be undone.
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="mt-6 sm:mt-0">
                          <DialogClose ref={dialogCloseRef} asChild>
                            <Button variant="outline">Cancel</Button>
                          </DialogClose>
                          <Button
                            variant="destructive"
                            className="mb-4 sm:mb-0"
                            onClick={() => deletePasskey({ credentialId: passkey.credentialId })}
                          >
                            Delete passkey
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
            No passkeys found. Add a passkey to enable passwordless authentication.
          </div>
        )}
      </div>
    </div>
  );
}
