import { redirect } from "next/navigation";
import { requireAdmin } from "@/utils/auth";

export default async function DocsNavigationPage() {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect("/");
  }

  return redirect("/admin/cms/navigation/docs");
}
