import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { getCmsTags } from "@/lib/cms/cms-repository";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, Plus, Tag } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function TagsPage() {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect("/");
  }

  const tags = await getCmsTags();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/cms">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tags</h1>
            <p className="text-muted-foreground mt-2">
              Manage content tags and categories
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href="/admin/cms/tags/new">
            <Plus className="h-4 w-4 mr-2" />
            Create Tag
          </Link>
        </Button>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Color</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Used in</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No tags found. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              tags.map((tag) => (
                <TableRow key={tag.id}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/cms/tags/${tag.id}`} className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      {tag.name}
                    </Link>
                  </TableCell>
                  <TableCell>{tag.slug}</TableCell>
                  <TableCell>
                    {tag.color ? (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-full border"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="text-muted-foreground text-sm">{tag.color}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md truncate">
                    {tag.description || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">{tag.entryCount}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/cms/tags/${tag.id}`}>Edit</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
