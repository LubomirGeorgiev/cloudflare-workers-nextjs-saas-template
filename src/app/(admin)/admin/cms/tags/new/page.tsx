import { Metadata } from "next";
import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { TagForm } from "../_components/tag-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Create Tag | Admin",
  description: "Add a new tag to categorize your content",
};

export default async function NewTagPage() {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect("/");
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/cms/tags">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create Tag</h1>
          <p className="text-muted-foreground mt-2">
            Add a new tag to categorize your content
          </p>
        </div>
      </div>

      <TagForm mode="create" />
    </div>
  );
}
