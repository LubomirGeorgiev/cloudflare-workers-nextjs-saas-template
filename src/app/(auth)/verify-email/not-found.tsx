import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container mx-auto px-4 flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invalid Verification Link</CardTitle>
          <CardDescription>
            The verification link you clicked is invalid or has expired. This can happen if:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>The link has expired (verification links are valid for 24 hours)</li>
            <li>You&apos;ve already verified your email</li>
            <li>The link was modified or is incomplete</li>
          </ul>

          <div className="space-y-2">
            <Link
              href="/sign-in"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
            >
                Sign In
            </Link>
            <Link
              href="/"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
            >
                Go to Home
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
