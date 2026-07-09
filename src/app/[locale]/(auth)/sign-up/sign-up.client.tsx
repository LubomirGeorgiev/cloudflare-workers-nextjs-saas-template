"use client";

import { signUpAction } from "./sign-up.actions";
import { type SignUpSchema, signUpSchema } from "@/schemas/signup.schema";
import { type PasskeyEmailSchema, passkeyEmailSchema } from "@/schemas/passkey.schema";
import { startPasskeyRegistrationAction, completePasskeyRegistrationAction } from "./passkey-sign-up.actions";

import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SeparatorWithText from "@/components/separator-with-text";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Captcha } from "@/components/captcha";

import { useForm, useWatch } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { Link } from "@/i18n/navigation";
import SSOButtons from "../_components/sso-buttons";
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { KeyIcon } from 'lucide-react'
import { usePublicAuthFeatureState } from "@/state/public-config";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { useManagedLoadingToast } from "@/hooks/use-managed-loading-toast";
import { useTranslations } from "next-intl";

interface SignUpClientProps {
  redirectPath: string;
}

const SignUpPage = ({ redirectPath }: SignUpClientProps) => {
  const { isTurnstileEnabled } = usePublicAuthFeatureState();
  const [isPasskeyModalOpen, setIsPasskeyModalOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const { dismissLoadingToast, showLoadingToast } = useManagedLoadingToast();
  const t = useTranslations("Client.Auth.SignUp");
  const tCommon = useTranslations("Client.Auth.Common");

  const { execute: signUp } = useAction(signUpAction, {
    onError: ({ error }) => {
      dismissLoadingToast()
      toast.error(error.serverError?.message)
    },
    onExecute: () => {
      showLoadingToast(t("toastCreatingAccount"))
    },
    onSuccess: () => {
      dismissLoadingToast()
      toast.success(t("toastAccountCreated"))
      window.location.href = redirectPath || REDIRECT_AFTER_SIGN_IN
    }
  })

  const { execute: completePasskeyRegistration } = useAction(completePasskeyRegistrationAction, {
    onError: ({ error }) => {
      dismissLoadingToast()
      toast.error(error.serverError?.message)
      setIsRegistering(false)
    },
    onSuccess: () => {
      dismissLoadingToast()
      toast.success(t("toastAccountCreated"))
      window.location.href = redirectPath || REDIRECT_AFTER_SIGN_IN
    }
  })

  const { execute: startPasskeyRegistration } = useAction(startPasskeyRegistrationAction, {
    onError: ({ error }) => {
      dismissLoadingToast()
      toast.error(error.serverError?.message)
      setIsRegistering(false)
    },
    onExecute: () => {
      showLoadingToast(t("toastStartingPasskeyRegistration"))
      setIsRegistering(true)
    },
    onSuccess: async ({ data }) => {
      dismissLoadingToast()
      if (!data?.optionsJSON) {
        toast.error(t("toastPasskeyRegistrationFailed"))
        setIsRegistering(false)
        return;
      }

      try {
        const attResp = await startRegistration({
          optionsJSON: data.optionsJSON,
          useAutoRegister: true,
        });
        await completePasskeyRegistration({ response: attResp });
      } catch (error: unknown) {
        console.error("Failed to register passkey:", error);
        dismissLoadingToast()
        toast.error(t("toastPasskeyRegistrationError"))
        setIsRegistering(false)
      }
    }
  })

  const form = useForm<SignUpSchema>({
    resolver: valibotResolver(signUpSchema),
  });

  const passkeyForm = useForm<PasskeyEmailSchema>({
    resolver: valibotResolver(passkeyEmailSchema),
  });

  const captchaToken = useWatch({ control: form.control, name: 'captchaToken' });
  const passkeyCaptchaToken = useWatch({ control: passkeyForm.control, name: 'captchaToken' });

  const onSubmit = async (data: SignUpSchema) => {
    signUp(data)
  }

  const onPasskeySubmit = async (data: PasskeyEmailSchema) => {
    startPasskeyRegistration(data)
  }

  return (
    <div className="min-h-[90vh] flex items-center px-4 justify-center bg-background my-6 md:my-10">
      <div className="w-full max-w-md space-y-8 p-6 md:p-10 bg-card rounded-xl shadow-lg border border-border">
        <div className="text-center">
          <h2 className="mt-6 text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            {t("heading")}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t("hasAccountPrompt")}{" "}
            <Link
              href={`/sign-in?redirect=${encodeURIComponent(redirectPath)}`}
              prefetch={false}
              className="font-medium text-primary hover:text-primary/90 underline"
            >
              {t("signInLink")}
            </Link>
          </p>
        </div>

        <div className="space-y-4">
          <SSOButtons />

          <Button
            className="w-full"
            onClick={() => setIsPasskeyModalOpen(true)}
          >
            <KeyIcon className="w-5 h-5 mr-2" />
            {t("signUpWithPasskey")}
          </Button>
        </div>

        <SeparatorWithText>
          <span className="uppercase text-muted-foreground">{tCommon("or")}</span>
        </SeparatorWithText>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={tCommon("emailPlaceholder")}
                      className="w-full px-3 py-2"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      placeholder={t("firstNamePlaceholder")}
                      className="w-full px-3 py-2"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      placeholder={t("lastNamePlaceholder")}
                      className="w-full px-3 py-2"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={tCommon("passwordPlaceholder")}
                      className="w-full px-3 py-2"
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
                className="w-full flex justify-center py-2.5 mt-8"
                disabled={Boolean(isTurnstileEnabled && !captchaToken)}
              >
                {t("createAccountWithPassword")}
              </Button>
            </div>
          </form>
        </Form>

        <div className="mt-6">
          <p className="text-xs text-center text-muted-foreground">
            {t("agreementPrefix")}{" "}
            <Link
              href="/terms"
              prefetch={false}
              className="font-medium text-primary hover:text-primary/90 underline"
            >
              {t("termsOfService")}
            </Link>{" "}
            {t("and")}{" "}
            <Link
              href="/privacy"
              prefetch={false}
              className="font-medium text-primary hover:text-primary/90 underline"
            >
              {t("privacyPolicy")}
            </Link>
          </p>
        </div>
      </div>

      <Dialog open={isPasskeyModalOpen} onOpenChange={setIsPasskeyModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("passkeyDialogTitle")}</DialogTitle>
          </DialogHeader>
          <Form {...passkeyForm}>
            <form onSubmit={passkeyForm.handleSubmit(onPasskeySubmit)} className="space-y-6 mt-6">
              <FormField
                control={passkeyForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder={tCommon("emailPlaceholder")}
                        className="w-full px-3 py-2"
                        disabled={isRegistering}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passkeyForm.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        placeholder={t("firstNamePlaceholder")}
                        className="w-full px-3 py-2"
                        disabled={isRegistering}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passkeyForm.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        placeholder={t("lastNamePlaceholder")}
                        className="w-full px-3 py-2"
                        disabled={isRegistering}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex flex-col justify-center items-center">
                <Captcha
                  onSuccess={(token) => passkeyForm.setValue('captchaToken', token)}
                  validationError={passkeyForm.formState.errors.captchaToken?.message}
                />

                <Button
                  type="submit"
                  className="w-full mt-8"
                  disabled={isRegistering || Boolean(isTurnstileEnabled && !passkeyCaptchaToken)}
                >
                  {isRegistering ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      {t("passkeyRegistering")}
                    </>
                  ) : (
                    t("passkeyContinue")
                  )}
                </Button>
              </div>
              {!isRegistering && (
                <p className="text-xs text-muted text-center mt-4">
                  {t("passkeyHelpText")}
                </p>
              )}
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SignUpPage;
