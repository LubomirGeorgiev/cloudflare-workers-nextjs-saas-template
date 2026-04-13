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
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import Link from "next/link";
import SSOButtons from "../_components/sso-buttons";
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { KeyIcon } from 'lucide-react'
import { useConfigStore } from "@/state/config";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";

interface SignUpClientProps {
  redirectPath: string;
}

const SignUpPage = ({ redirectPath }: SignUpClientProps) => {
  const { isTurnstileEnabled } = useConfigStore();
  const [isPasskeyModalOpen, setIsPasskeyModalOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const { execute: signUp } = useAction(signUpAction, {
    onError: ({ error }) => {
      toast.dismiss()
      toast.error(error.serverError?.message)
    },
    onExecute: () => {
      toast.loading("Creating your account...")
    },
    onSuccess: () => {
      toast.dismiss()
      toast.success("Account created successfully")
      window.location.href = redirectPath || REDIRECT_AFTER_SIGN_IN
    }
  })

  const { execute: completePasskeyRegistration } = useAction(completePasskeyRegistrationAction, {
    onError: ({ error }) => {
      toast.dismiss()
      toast.error(error.serverError?.message)
      setIsRegistering(false)
    },
    onSuccess: () => {
      toast.dismiss()
      toast.success("Account created successfully")
      window.location.href = redirectPath || REDIRECT_AFTER_SIGN_IN
    }
  })

  const { execute: startPasskeyRegistration } = useAction(startPasskeyRegistrationAction, {
    onError: ({ error }) => {
      toast.dismiss()
      toast.error(error.serverError?.message)
      setIsRegistering(false)
    },
    onExecute: () => {
      toast.loading("Starting passkey registration...")
      setIsRegistering(true)
    },
    onSuccess: async ({ data }) => {
      toast.dismiss()
      if (!data?.optionsJSON) {
        toast.error("Failed to start passkey registration")
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
        toast.error("Failed to register passkey")
        setIsRegistering(false)
      }
    }
  })

  const form = useForm<SignUpSchema>({
    resolver: zodResolver(signUpSchema),
  });

  const passkeyForm = useForm<PasskeyEmailSchema>({
    resolver: zodResolver(passkeyEmailSchema),
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
            Create your account
          </h2>
          <p className="mt-2 text-muted-foreground">
            Already have an account?{" "}
            <Link href={`/sign-in?redirect=${encodeURIComponent(redirectPath)}`} className="font-medium text-primary hover:text-primary/90 underline">
              Sign in
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
            Sign up with a Passkey
          </Button>
        </div>

        <SeparatorWithText>
          <span className="uppercase text-muted-foreground">Or</span>
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
                      placeholder="Email address"
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
                      placeholder="First Name"
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
                      placeholder="Last Name"
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
                Create Account with Password
              </Button>
            </div>
          </form>
        </Form>

        <div className="mt-6">
          <p className="text-xs text-center text-muted-foreground">
            By signing up, you agree to our{" "}
            <Link href="/terms" className="font-medium text-primary hover:text-primary/90 underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium text-primary hover:text-primary/90 underline">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>

      <Dialog open={isPasskeyModalOpen} onOpenChange={setIsPasskeyModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign up with a Passkey</DialogTitle>
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
                        placeholder="Email address"
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
                        placeholder="First Name"
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
                        placeholder="Last Name"
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
                      Registering...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>
              </div>
              {!isRegistering && (
                <p className="text-xs text-muted text-center mt-4">
                  After clicking continue, your browser will prompt you to create and save your Passkey. This will allow you to sign in securely without a password in the future.
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
