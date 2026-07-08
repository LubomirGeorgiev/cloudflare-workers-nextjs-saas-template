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
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { forgotPasswordAction } from "./forgot-password.action";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { useForm, useWatch } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useSessionStore } from "@/state/session";
import { Captcha } from "@/components/captcha";
import { forgotPasswordSchema } from "@/schemas/forgot-password.schema";
import { usePublicAuthFeatureState } from "@/state/public-config";
import { useEffect } from "react";
import { v } from "@/lib/validation";
import { useTranslations } from "next-intl";

type ForgotPasswordSchema = v.InferOutput<typeof forgotPasswordSchema>;

export default function ForgotPasswordClientComponent() {
  const { session } = useSessionStore()
  const { isTurnstileEnabled } = usePublicAuthFeatureState()
  const router = useRouter();
  const t = useTranslations("Client.Auth.ForgotPassword");
  const tCommon = useTranslations("Client.Auth.Common");

  const form = useForm<ForgotPasswordSchema>({
    resolver: valibotResolver(forgotPasswordSchema),
  });

  useEffect(() => {
    if (session?.user?.email) {
      form.setValue('email', session?.user?.email);
    }
  }, [form,session?.user?.email]);

  const captchaToken = useWatch({ control: form.control, name: 'captchaToken' })

  const { execute: sendResetLink, hasSucceeded } = useAction(forgotPasswordAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message);
    },
    onExecute: () => {
      toast.loading(t("toastSending"));
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success(t("toastSent"));
    },
  });

  const onSubmit = async (data: ForgotPasswordSchema) => {
    sendResetLink({
      ...data,
      email: data.email ?? session?.user?.email,
    });
  };

  if (hasSucceeded) {
    return (
      <AuthStatusCard
        title={t("checkEmailTitle")}
        description={t("checkEmailDescription")}
        actionLabel={tCommon("backToLogin")}
        onAction={() => router.push("/sign-in")}
      />
    );
  }

  return (
    <div className="container mx-auto px-4 flex flex-col items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {session ? t("changePasswordTitle") : t("forgotPasswordTitle")}
          </CardTitle>
          <CardDescription>
            {t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                disabled={Boolean(session?.user?.email)}
                defaultValue={session?.user?.email || undefined}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">{tCommon("emailLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        className="w-full px-3 py-2"
                        placeholder="name@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex flex-col justify-center items-center">
                <Captcha
                  onSuccess={(token) => form.setValue('captchaToken', token)}
                  validationError={form.formState.errors.captchaToken?.message}
                />

                <Button
                  type="submit"
                  className="mt-8 mb-2"
                  disabled={Boolean(isTurnstileEnabled && !captchaToken)}
                >
                  {t("sendInstructions")}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <div className="mt-4 w-full">
        {session ? (
          <Button
            type="button"
            variant="link"
            className="w-full"
            onClick={() => router.push("/settings")}
          >
            {t("backToSettings")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="link"
            className="w-full"
            onClick={() => router.push("/sign-in")}
          >
            {tCommon("backToLogin")}
          </Button>
        )}
      </div>

    </div>
  );
}
