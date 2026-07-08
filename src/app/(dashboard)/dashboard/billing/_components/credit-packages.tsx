"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CREDIT_PACKAGES, FREE_MONTHLY_CREDITS } from "@/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StripePaymentForm } from "./stripe-payment-form";
import { createPaymentIntent } from "@/actions/credits.action";
import { useSessionStore } from "@/state/session";
import { useTransactionStore } from "@/state/transaction";
import { Separator } from "@/components/ui/separator";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { getCreditPackageIcon } from "./credit-package-icon";

type CreditPackage = typeof CREDIT_PACKAGES[number];

// Calculate savings percentage compared to the first package
const calculateSavings = (pkg: CreditPackage) => {
  const basePackage = CREDIT_PACKAGES[0];
  const basePrice = basePackage.price / basePackage.credits;
  const currentPrice = pkg.price / pkg.credits;
  const savings = ((basePrice - currentPrice) / basePrice) * 100;
  return Math.round(savings);
};

export function CreditPackages() {
  const router = useRouter();
  const t = useTranslations("Client.Dashboard.Billing");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const session = useSessionStore((state) => state);
  const transactionsRefresh = useTransactionStore((state) => state.triggerRefresh);
  const sessionIsLoading = session?.isLoading;

  const handlePurchase = async (pkg: CreditPackage) => {
    try {
      const { data, serverError } = await createPaymentIntent({
        packageId: pkg.id,
      });

      if (serverError) {
        throw new Error(serverError.message);
      }

      if (!data?.clientSecret) {
        throw new Error(t("errorCreatePaymentIntent"));
      }

      setClientSecret(data.clientSecret);
      setSelectedPackage(pkg);
      setIsDialogOpen(true);
    } catch (error) {
      console.error("Error creating payment intent:", error);
      toast.error(error instanceof Error ? error.message : t("errorStartCheckout"));
    }
  };

  const handleSuccess = () => {
    setIsDialogOpen(false);
    setSelectedPackage(null);
    setClientSecret(null);
    router.refresh();
    transactionsRefresh();
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("creditsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              {sessionIsLoading ? (
                <>
                  <Skeleton className="h-9 w-16" />
                  <Skeleton className="h-9 w-24" />
                </>
              ) : (
                <div className="text-3xl font-bold">
                  {t("currentCredits", { count: session?.session?.user?.currentCredits ?? 0 })}
                </div>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {t("freeMonthlyCredits", { count: FREE_MONTHLY_CREDITS })}
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-semibold">{t("topUpTitle")}</h2>
              <p className="text-sm text-muted-foreground mt-2 sm:mt-3">
                {t("topUpDescription")}
              </p>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              {CREDIT_PACKAGES.map((pkg, index) => (
                <Card key={pkg.id} className="relative overflow-hidden transition-all hover:shadow-lg bg-muted dark:bg-background">
                  <CardContent className="flex flex-col h-full pt-4 gap-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {getCreditPackageIcon(pkg.id)}
                        <div>
                          <div className="text-xl sm:text-2xl font-bold">
                            {pkg.credits.toLocaleString()}
                          </div>
                          <div className="text-xs sm:text-sm text-muted-foreground">
                            {t("creditsLabel")}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="text-xl sm:text-2xl font-bold text-primary">
                          ${pkg.price}
                        </div>
                        <div className="text-xs sm:text-sm text-muted-foreground">
                          {t("oneTimePayment")}
                        </div>
                        {index > 0 ? (
                          <Badge variant="secondary" className="mt-1 text-xs sm:text-sm bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                            {t("savePercent", { percent: calculateSavings(pkg) })}
                          </Badge>
                        ) : (
                          <div className="h-[22px] sm:h-[26px]" /> /* Placeholder for badge height */
                        )}
                      </div>
                    </div>
                    <div className="flex-grow" />
                    <Button
                      onClick={() => {
                        if (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
                          handlePurchase(pkg)
                        } else {
                          toast.error(t("errorPaymentProvider"))
                        }
                      }}
                      className="w-full text-sm sm:text-base"
                    >
                      {t("purchaseNow")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("purchaseCreditsDialogTitle")}</DialogTitle>
          </DialogHeader>
          {(clientSecret && selectedPackage) && (
            <StripePaymentForm
              packageId={selectedPackage.id}
              clientSecret={clientSecret}
              onSuccess={handleSuccess}
              onCancel={() => setIsDialogOpen(false)}
              credits={selectedPackage.credits}
              price={selectedPackage.price}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
