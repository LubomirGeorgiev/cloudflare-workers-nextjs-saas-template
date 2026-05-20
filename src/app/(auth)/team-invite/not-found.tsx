import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invitation Not Found</CardTitle>
          <CardDescription>
            The team invitation you&apos;re looking for doesn&apos;t exist or has expired.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4">
            <p className="text-sm text-muted-foreground">
              This could be because:
            </p>
            <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
              <li>The invitation URL is incorrect</li>
              <li>The invitation has been revoked by the team admin</li>
              <li>The invitation has expired</li>
            </ul>
            <div className="pt-4">
              <Link href="/dashboard" className={cn(buttonVariants(), "w-full")}>
                Go to Dashboard
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
