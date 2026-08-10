"use client";

import { type SignInSchema, signInSchema } from "@/schemas/signin.schema";
import { useState } from "react";

import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SeparatorWithText from "@/components/separator-with-text";

import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { Link } from "@/i18n/navigation";
import SSOButtons from "../_components/sso-buttons";
import { KeyIcon } from "lucide-react";
import {
  generateAuthenticationOptionsAction,
  verifyAuthenticationAction,
} from "@/app/[locale]/(app)/(settings)/settings/security/passkey-settings.actions";
import { startAuthentication } from "@simplewebauthn/browser";
import { signInAction } from "./sign-in.action";
import { useManagedLoadingToast } from "@/hooks/use-managed-loading-toast";
import { useNavigateAfterAuth } from "@/hooks/use-navigate-after-auth";
import { useTranslations } from "next-intl";

interface SignInClientProps {
  redirectPath: string;
}

interface PasskeyAuthenticationButtonProps {
  redirectPath: string;
}

function PasskeyAuthenticationButton({ redirectPath }: PasskeyAuthenticationButtonProps) {
  const navigateAfterAuth = useNavigateAfterAuth();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const { dismissLoadingToast, showLoadingToast } = useManagedLoadingToast();
  const t = useTranslations("Client.Auth.SignIn");

  const { executeAsync: generateOptions } = useAction(generateAuthenticationOptionsAction, {
    onError: ({ error }) => {
      dismissLoadingToast();
      toast.error(error.serverError?.message || t("toastPasskeyOptionsError"));
    },
  });

  const { executeAsync: verifyAuthentication } = useAction(verifyAuthenticationAction, {
    onError: ({ error }) => {
      dismissLoadingToast();
      toast.error(error.serverError?.message || t("toastPasskeyAuthError"));
    },
    onSuccess: () => {
      dismissLoadingToast();
      toast.success(t("toastAuthSuccess"));
      navigateAfterAuth(redirectPath);
    },
  });

  const onClick = async () => {
    try {
      setIsAuthenticating(true);
      showLoadingToast(t("toastAuthenticatingPasskey"));

      const { data: options, serverError } = await generateOptions();

      if (serverError) {
        throw new Error(serverError.message);
      }

      if (!options) {
        throw new Error(t("toastPasskeyOptionsError"));
      }

      const authenticationResponse = await startAuthentication({
        optionsJSON: options,
      });

      await verifyAuthentication({
        response: authenticationResponse,
      });
    } catch (error) {
      console.error("Passkey authentication error:", error);
      dismissLoadingToast();
      toast.error(error instanceof Error ? error.message : t("toastPasskeyAuthError"));
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={onClick}
      className="w-full"
      disabled={isAuthenticating}
    >
      <KeyIcon className="w-5 h-5 mr-2" />
      {isAuthenticating ? t("authenticatingPasskey") : t("signInWithPasskey")}
    </Button>
  );
}

const SignInPage = ({ redirectPath }: SignInClientProps) => {
  const navigateAfterAuth = useNavigateAfterAuth();
  const { dismissLoadingToast, showLoadingToast } = useManagedLoadingToast();
  const t = useTranslations("Client.Auth.SignIn");
  const tCommon = useTranslations("Client.Auth.Common");

  const form = useForm<SignInSchema>({
    resolver: valibotResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const { execute: signIn, isExecuting: isSigningIn } = useAction(signInAction, {
    onError: ({ error }) => {
      dismissLoadingToast();
      toast.error(error.serverError?.message ?? tCommon("genericError"));
    },
    onExecute: () => {
      showLoadingToast(t("toastSigningIn"));
    },
    onSuccess: () => {
      dismissLoadingToast();
      toast.success(t("toastSignInSuccess"));
      navigateAfterAuth(redirectPath);
    },
  });

  const onSubmit = (data: SignInSchema) => {
    signIn(data);
  };

  return (
    <div className="min-h-[90vh] flex flex-col items-center px-4 justify-center bg-background my-6 md:my-10">
      <div className="w-full max-w-md space-y-8 p-6 md:p-10 bg-card rounded-xl shadow-lg border border-border">
        <div className="text-center">
          <h2 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            {t("heading")}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t("noAccountPrompt")}{" "}
            <Link
              href={`/sign-up?redirect=${encodeURIComponent(redirectPath)}`}
              prefetch={false}
              className="font-medium text-primary hover:text-primary/90 underline"
            >
              {t("createAccountLink")}
            </Link>
          </p>
        </div>

        <div className="space-y-4">
          <SSOButtons isSignIn />

          <PasskeyAuthenticationButton redirectPath={redirectPath} />
        </div>

        <SeparatorWithText>
          <span className="uppercase text-muted-foreground">{tCommon("or")}</span>
        </SeparatorWithText>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-6">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      placeholder={tCommon("emailPlaceholder")}
                      type="email"
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

            <Button
              type="submit"
              className="w-full flex justify-center py-2.5"
              disabled={isSigningIn}
            >
              {isSigningIn ? t("signingIn") : t("signInWithPassword")}
            </Button>
          </form>
        </Form>
      </div>

      <div className="mt-6">
        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/forgot-password"
            prefetch={false}
            className="font-medium text-primary hover:text-primary/90"
          >
            {t("forgotPassword")}
          </Link>
        </p>
      </div>
    </div>
  );
};

export default SignInPage;
