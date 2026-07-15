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
import { createTeamAction } from "@/actions/team-actions";
import { encodeValidationMessage, maxString, requiredString, v, validationKey } from "@/lib/validation";
import { useTranslations } from "next-intl";

const formSchema = v.object({
  name: v.pipe(
    requiredString(validationKey("teamNameRequired")),
    v.maxLength(100, encodeValidationMessage("teamNameMaxLength", { max: 100 }))
  ),
  description: v.optional(maxString(1000, encodeValidationMessage("descriptionMaxLength", { max: 1000 }))),
  avatarUrl: v.optional(v.union([
    v.pipe(
      v.string(),
      v.url(validationKey("invalidUrl")),
      v.maxLength(600, encodeValidationMessage("urlMaxLength", { max: 600 }))
    ),
    v.literal(""),
  ])),
});

type FormValues = v.InferOutput<typeof formSchema>;

interface CreateTeamPayload {
  slug?: string;
  data?: {
    slug?: string;
  };
}

function getCreatedTeamSlug(payload: CreateTeamPayload | undefined): string | undefined {
  return payload?.data?.slug ?? payload?.slug;
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
    resolver: valibotResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      avatarUrl: "",
    },
  });

  function onSubmit(data: FormValues) {
    // Clean up empty string in avatarUrl if present
    const formData = {
      ...data,
      avatarUrl: data.avatarUrl || undefined
    };

    submitCreateTeam(formData);
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
