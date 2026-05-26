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
import { maxString, requiredString, v } from "@/lib/validation";

const formSchema = v.object({
  name: v.pipe(requiredString("Team name is required"), v.maxLength(100, "Team name is too long")),
  description: v.optional(maxString(1000, "Description is too long")),
  avatarUrl: v.optional(v.union([
    v.pipe(v.string(), v.url("Invalid URL"), v.maxLength(600, "URL is too long")),
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
  const { execute: createTeam } = useAction(createTeamAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Failed to create team");
    },
    onExecute: () => {
      toast.loading("Creating team...");
    },
    onSuccess: ({ data }) => {
      toast.dismiss();
      toast.success("Team created successfully");

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

    createTeam(formData);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Team Name</FormLabel>
              <FormControl>
                <Input placeholder="Enter team name" {...field} />
              </FormControl>
              <FormDescription>
                A unique name for your team
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
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Enter a brief description of your team"
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormDescription>
                Optional description of your team&apos;s purpose
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full">
          Create Team
        </Button>
      </form>
    </Form>
  );
}
