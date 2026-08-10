import { Metadata } from "next";
import { requireAdminOrRedirectHome } from "@/utils/auth-redirect";

import { Link } from "@/i18n/navigation";
import { TagForm } from "../_components/tag-form";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Create Tag | Admin",
  description: "Add a new tag to categorize your content",
};

export default async function NewTagPage() {
  await requireAdminOrRedirectHome();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-4">
        <Link
          href="/admin/cms/tags"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
        >
            <ArrowLeft className="h-4 w-4" />
        </Link>
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
