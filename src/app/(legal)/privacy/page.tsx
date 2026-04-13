import { Metadata } from "next";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Learn how we collect, use, and protect your data",
};

const lastUpdated = new Date('2025-01-15T20:10:16.287Z')

export default function PrivacyPage() {
  const { env } = getCloudflareContext()

  const email = env?.EMAIL_REPLY_TO

  return (
    <>
      <h1 className="text-4xl font-bold text-foreground mb-8">Privacy Policy</h1>

      <p className="text-muted-foreground mb-6">Last updated: {lastUpdated.toLocaleDateString()}</p>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">1. Information We Collect</h2>
        <p className="text-muted-foreground">
          We collect information you provide directly to us, including but not limited to your name,
          email address, and any other information you choose to provide.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">2. How We Use Your Information</h2>
        <p className="text-muted-foreground">
          We use the information we collect to:
        </p>
        <ul className="list-disc pl-6 mt-2 text-muted-foreground">
          <li>Provide, maintain, and improve our services</li>
          <li>Send you technical notices and support messages</li>
          <li>Respond to your comments and questions</li>
          <li>Protect against fraud and abuse</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">3. Data Security</h2>
        <p className="text-muted-foreground">
          We take reasonable measures to help protect information about you from loss, theft,
          misuse and unauthorized access, disclosure, alteration, and destruction.
        </p>
      </section>

      {email && (
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">4. Contact Us</h2>
          <p className="text-muted-foreground">
            If you have any questions about this Privacy Policy, please contact us at:
            <br />
            Email: {email}
          </p>
        </section>
      )}

      <div className="mt-12 text-center">
        <Button asChild>
          <Link href="/">Return to Home</Link>
        </Button>
      </div>
    </>
  );
}
