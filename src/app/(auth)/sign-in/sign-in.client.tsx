"use client";

import { type SignInSchema, signInSchema } from "@/schemas/signin.schema";
import { type ReactNode, useState } from "react";

import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SeparatorWithText from "@/components/separator-with-text";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import Link from "next/link";
import SSOButtons from "../_components/sso-buttons";
import { KeyIcon } from "lucide-react";
import { generateAuthenticationOptionsAction, verifyAuthenticationAction } from "@/app/(settings)/settings/security/passkey-settings.actions";
// TODO simplewebauthn is huuge. We need to write our own little implementation containging only the necessary functions
import { startAuthentication } from "@simplewebauthn/browser";

interface SignInClientProps {
  redirectPath: string;
}

interface PasskeyAuthenticationButtonProps {
  className?: string;
  disabled?: boolean;
  children?: ReactNode;
  redirectPath: string;
}

function PasskeyAuthenticationButton({ className, disabled, children, redirectPath }: PasskeyAuthenticationButtonProps) {
  const { executeAsync: generateOptions } = useAction(generateAuthenticationOptionsAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Failed to get authentication options");
    },
  });

  const { executeAsync: verifyAuthentication } = useAction(verifyAuthenticationAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Authentication failed");
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success("Authentication successful");
      window.location.href = redirectPath;
    },
  });

  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleAuthenticate = async () => {
    try {
      setIsAuthenticating(true);
      toast.loading("Authenticating with passkey...");

      // Get authentication options from the server
      const { data: options, serverError } = await generateOptions({});

      if (serverError) {
        throw new Error(serverError.message);
      }

      if (!options) {
        throw new Error("Failed to get authentication options");
      }

      // Start the authentication process in the browser
      const authenticationResponse = await startAuthentication({
        optionsJSON: options,
      });

      // Send the response back to the server for verification
      await verifyAuthentication({
        response: authenticationResponse,
        challenge: options.challenge,
      });
    } catch (error) {
      console.error("Passkey authentication error:", error);
      toast.dismiss();
      toast.error("Authentication failed");
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <Button
      onClick={handleAuthenticate}
      disabled={isAuthenticating || disabled}
      className={className}
    >
      {isAuthenticating ? "Authenticating..." : children || "Sign in with a Passkey"}
    </Button>
  );
}

const SignInPage = ({ redirectPath }: SignInClientProps) => {
  const form = useForm<SignInSchema>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });
  const onSubmit = async (data: SignInSchema) => {
    try {
      toast.loading("Signing you in...");

      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json() as { message?: string };

      if (!response.ok) {
        throw new Error(result.message ?? "Something went wrong");
      }

      toast.dismiss();
      toast.success("Signed in successfully");
      window.location.href = redirectPath;
    } catch (error) {
      toast.dismiss();
      toast.error(
        error instanceof Error ? error.message : "Something went wrong"
      );
    }
  }

  return (
    <div className="min-h-[90vh] flex flex-col items-center px-4 justify-center bg-background my-6 md:my-10">
      <div className="w-full max-w-md space-y-8 p-6 md:p-10 bg-card rounded-xl shadow-lg border border-border">
        <div className="text-center">
          <h2 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Sign in to your account
          </h2>
          <p className="mt-2 text-muted-foreground">
            Or{" "}
            <Link href={`/sign-up?redirect=${encodeURIComponent(redirectPath)}`} className="font-medium text-primary hover:text-primary/90 underline">
              create a new account
            </Link>
          </p>
        </div>

        <div className="space-y-4">
          <SSOButtons isSignIn />

          <PasskeyAuthenticationButton className="w-full" redirectPath={redirectPath}>
            <KeyIcon className="w-5 h-5 mr-2" />
            Sign in with a Passkey
          </PasskeyAuthenticationButton>
        </div>

        <SeparatorWithText>
          <span className="uppercase text-muted-foreground">Or</span>
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
                      placeholder="Email address"
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
                      placeholder="Password"
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
            >
              Sign In with Password
            </Button>
          </form>
        </Form>
      </div>

      <div className="mt-6">
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/forgot-password" className="font-medium text-primary hover:text-primary/90">
            Forgot your password?
          </Link>
        </p>
      </div>
    </div>
  );
};

export default SignInPage;
