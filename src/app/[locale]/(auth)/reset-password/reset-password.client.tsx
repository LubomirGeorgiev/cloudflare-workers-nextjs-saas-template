"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AuthStatusCard } from "@/app/[locale]/(auth)/_components/auth-status-card";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { resetPasswordAction } from "./reset-password.action";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { resetPasswordSchema } from "@/schemas/reset-password.schema";
import type { ResetPasswordSchema } from "@/schemas/reset-password.schema";
import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function ResetPasswordClientComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const t = useTranslations("Client.Auth.ResetPassword");

  const form = useForm<ResetPasswordSchema>({
    resolver: valibotResolver(resetPasswordSchema),
    defaultValues: {
      token: token || "",
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (token) {
      form.setValue("token", token);
    }
  }, [token]);

  const { execute: resetPassword, hasSucceeded } = useAction(resetPasswordAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message);
    },
    onExecute: () => {
      toast.loading(t("toastResetting"));
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success(t("toastResetSuccess"));
    },
  });

  const onSubmit = async (data: ResetPasswordSchema) => {
    resetPassword(data);
  };

  if (hasSucceeded) {
    return (
      <AuthStatusCard
        title={t("successTitle")}
        description={t("successDescription")}
        actionLabel={t("goToLogin")}
        onAction={() => router.push("/sign-in")}
      />
    );
  }

  return (
    <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("newPasswordLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("confirmPasswordLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full">
                {t("submit")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
