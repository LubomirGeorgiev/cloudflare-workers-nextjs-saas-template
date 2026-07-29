"use client";

import { valibotResolver } from "@hookform/resolvers/valibot";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { updateUserProfileAction } from "./settings.actions";
import { useEffect } from "react";
import { useSessionStore } from "@/state/session";
import { userSettingsSchema, type UserSettingsSchema } from "@/schemas/settings.schema";
import { useAction } from "next-safe-action/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type UserSettingsFormValues = UserSettingsSchema;

export function SettingsForm() {
  const router = useRouter()
  const t = useTranslations("Client.Settings.Profile");

  const { execute: updateUserProfile } = useAction(updateUserProfileAction, {
    onError: ({ error }) => {
      toast.dismiss()
      toast.error(error.serverError?.message ?? t("toastUpdateError"))
    },
    onExecute: () => {
      toast.loading(t("toastUpdating"))
    },
    onSuccess: () => {
      toast.dismiss()
      toast.success(t("toastUpdateSuccess"))
      router.refresh()
    }
  })

  const { session, isLoading } = useSessionStore();
  const form = useForm<UserSettingsFormValues>({
    resolver: valibotResolver(userSettingsSchema)
  });

  useEffect(() => {
    form.reset({
      firstName: session?.user.firstName ?? '',
      lastName: session?.user.lastName ?? '',
    });
  }, [session])

  if (!session || isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="space-y-2">
            <Skeleton className="h-8 w-[200px]" />
            <Skeleton className="h-4 w-[300px]" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>

            <div className="space-y-2">
              <Skeleton className="h-4 w-[100px]" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-4 w-[200px]" />
            </div>

            <div className="flex justify-end">
              <Skeleton className="h-10 w-[100px]" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  async function onSubmit(values: UserSettingsFormValues) {
    updateUserProfile(values)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("cardTitle")}</CardTitle>
        <CardDescription>
          {t("cardDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("firstNameLabel")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                    <FormLabel>{t("lastNameLabel")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>


            <FormItem>
              <FormLabel>{t("emailLabel")}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  disabled
                  value={session.user.email ?? ''}
                />
              </FormControl>
              <FormDescription>
                {t("emailDescription")}
              </FormDescription>
              <FormMessage />
            </FormItem>

            <div className="flex justify-end">
              <Button type="submit">
                {t("saveButton")}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
