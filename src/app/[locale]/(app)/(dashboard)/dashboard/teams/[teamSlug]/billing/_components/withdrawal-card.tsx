"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { WITHDRAWAL_STALE_MESSAGE_KEY } from "@/constants/eu-withdrawal";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "@/i18n/client";
import { withdrawFromContractAction } from "../withdrawal.actions";

interface WithdrawalCardProps {
  teamId: string;
  // The subscription this dialog shows. The action refuses it when another one replaced it.
  subscriptionId: string;
  // `withdrawalSignerName`, so the dialog shows the name the receipt states.
  name: string;
  email: string;
  planName: string;
  // Formatted on the server, in the same form as the order confirmation email.
  startedAtLabel: string;
  windowEndsAtLabel: string;
  // The withdrawal is recorded and its cancel or refund is still due: no second button.
  pending: boolean;
}

/**
 * The EU withdrawal function (art. 11a): one button, then one confirm step that shows who
 * withdraws from which contract. The two labels are legal text; keep them as the catalogs state them.
 */
export function WithdrawalCard({
  teamId,
  subscriptionId,
  name,
  email,
  planName,
  startedAtLabel,
  windowEndsAtLabel,
  pending,
}: WithdrawalCardProps) {
  const t = useTranslations("Client.Dashboard.Billing");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { execute, isExecuting } = useAction(withdrawFromContractAction, {
    onSuccess: ({ data }) => {
      setOpen(false);
      toast.success(t(data?.completed ? "withdrawalDone" : "withdrawalPending"));
      router.refresh();
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message ?? t("errorPaymentProvider"));
      if (error.serverError?.reason === WITHDRAWAL_STALE_MESSAGE_KEY) {
        setOpen(false);
        router.refresh();
      }
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("withdrawalTitle")}</CardTitle>
        <CardDescription>
          {pending ? t("withdrawalPending") : t("withdrawalDescription", { date: windowEndsAtLabel })}
        </CardDescription>
      </CardHeader>
      {!pending && (
        <CardContent>
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t("withdrawButton")}
          </Button>
        </CardContent>
      )}

      <Dialog open={open} onOpenChange={(next) => !isExecuting && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("withdrawalDialogTitle")}</DialogTitle>
            <DialogDescription>{t("withdrawalReceiptNote", { email })}</DialogDescription>
          </DialogHeader>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("withdrawalNameLabel")}</dt>
              <dd className="break-words">{name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("withdrawalEmailLabel")}</dt>
              <dd className="break-all">{email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("withdrawalContractLabel")}</dt>
              <dd>{t("withdrawalContractValue", { plan: planName, date: startedAtLabel })}</dd>
            </div>
          </dl>
          <DialogFooter>
            <Button variant="destructive" onClick={() => execute({ teamId, subscriptionId })} disabled={isExecuting}>
              {t("confirmWithdrawal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
