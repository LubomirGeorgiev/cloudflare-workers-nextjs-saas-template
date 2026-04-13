"use client";

import type { Route } from "next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAction } from "next-safe-action/hooks";
import { createTeamAction } from "@/actions/team-actions";

const formSchema = z.object({
  name: z.string().min(1, "Team name is required").max(100, "Team name is too long"),
  description: z.string().max(1000, "Description is too long").optional(),
  avatarUrl: z.string().url("Invalid URL").max(600, "URL is too long").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof formSchema>;

export function CreateTeamForm() {
  const router = useRouter();

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
      router.push(`/dashboard/teams/${data.data.slug}` as Route);
      router.refresh();
    }
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
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
