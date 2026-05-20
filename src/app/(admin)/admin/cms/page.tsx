import { Metadata } from "next";
import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { cmsConfig } from "@/../cms.config";
import { FileText, Tag, Image, PanelLeft } from "lucide-react";
import { getCmsNavigations } from "@/lib/cms/cms-navigation-config";
import { CmsSystemActions } from "./_components/cms-system-actions";

export const metadata: Metadata = {
  title: "Content Management | Admin",
  description: "Manage your content collections",
};

export default async function CmsPage() {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect("/");
  }

  const collections = Object.entries(cmsConfig.collections);
  const navigations = getCmsNavigations();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Content Management</h1>
        <p className="text-muted-foreground mt-2">
          Manage your content collections
        </p>
      </div>

      <CmsSystemActions />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {collections.map(([slug, config]) => (
          <Card key={slug} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <FileText className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle>{config.labels.plural}</CardTitle>
                    <CardDescription className="mt-1">
                      {config.labels.singular} collection
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Link
                  href={`/admin/cms/${slug}`}
                  className={buttonVariants({ className: "flex-1" })}
                >
                  View Entries
                </Link>
                <Link
                  href={`/admin/cms/${slug}/new`}
                  className={buttonVariants({
                    variant: "outline",
                    className: "flex-1",
                  })}
                >
                  Create New
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}

        {collections.length === 0 && (
          <div className="col-span-full text-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No collections defined</h3>
            <p className="text-muted-foreground mt-2">
              Define collections in your cms.config.ts file
            </p>
          </div>
        )}

        {navigations.map((navigation) => (
          <Card key={navigation.navigationKey} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <PanelLeft className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle>{navigation.label}</CardTitle>
                    <CardDescription className="mt-1">
                      {navigation.description || `Manage ${navigation.label.toLowerCase()}`}
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Link
                  href={`/admin/cms/navigation/${navigation.navigationKey}`}
                  className={buttonVariants({ className: "flex-1" })}
                >
                  Open Builder
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Image className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle>Media Library</CardTitle>
                  <CardDescription className="mt-1">
                    Manage uploaded images and files
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Link
                href="/admin/cms/media"
                className={buttonVariants({ className: "flex-1" })}
              >
                View Media
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Tag className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle>Tags</CardTitle>
                  <CardDescription className="mt-1">
                    Manage content tags
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Link
                href="/admin/cms/tags"
                className={buttonVariants({ className: "flex-1" })}
              >
                Manage Tags
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
