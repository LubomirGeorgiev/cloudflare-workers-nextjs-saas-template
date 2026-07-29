"use client";

import type { Route } from "next";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import type { InferSafeActionFnResult } from "next-safe-action";
import { createTeamAction } from "@/actions/team-actions";
import { createTeamSchema, type CreateTeamSchema } from "@/schemas/team.schema";
import { useTranslations } from "next-intl";

type FormValues = CreateTeamSchema;

// Derive the DTO from the action itself so the shape stays in sync automatically.
type CreateTeamResult = InferSafeActionFnResult<typeof createTeamAction>["data"];

function getCreatedTeamSlug(payload: CreateTeamResult): string | undefined {
  return payload?.data?.slug;
}

export function CreateTeamForm() {
  const t = useTranslations("Client.Dashboard.Teams");
  const { execute: submitCreateTeam } = useAction(createTeamAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || t("toastCreateError"));
    },
    onExecute: () => {
      toast.loading(t("toastCreating"));
    },
    onSuccess: ({ data }) => {
      toast.dismiss();
      toast.success(t("toastCreateSuccess"));

      const teamSlug = getCreatedTeamSlug(data);
      const teamPath = teamSlug ? `/dashboard/teams/${teamSlug}` : "/dashboard/teams";

      window.location.href = teamPath as Route;
    }
  });

  const form = useForm<FormValues>({
    resolver: valibotResolver(createTeamSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  function onSubmit(data: FormValues) {
    submitCreateTeam(data);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("formNameLabel")}</FormLabel>
              <FormControl>
                <Input placeholder={t("formNamePlaceholder")} {...field} />
              </FormControl>
              <FormDescription>
                {t("formNameDescription")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("formDescriptionLabel")}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={t("formDescriptionPlaceholder")}
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormDescription>
                {t("formDescriptionHelp")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full">
          {t("createTeam")}
        </Button>
      </form>
    </Form>
  );
}
