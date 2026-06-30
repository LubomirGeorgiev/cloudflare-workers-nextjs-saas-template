"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { SiGithub as GithubIcon } from "@icons-pack/react-simple-icons";
import { GITHUB_REPO_URL } from "@/constants";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CLONE_COMMAND = "git clone " + GITHUB_REPO_URL + ".git";

export function CallToAction() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(CLONE_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable in insecure contexts; fail quietly.
    }
  }

  return (
    <section className="bg-background pb-28 pt-4">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <div className="relative isolate overflow-hidden rounded-2xl border border-border bg-card px-6 py-14 text-center sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-grid opacity-40 mask-[radial-gradient(ellipse_at_center,black,transparent_70%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 left-1/2 -z-10 size-112 -translate-x-1/2 rounded-full bg-edge/15 blur-[100px]"
          />

          <h2 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            One command to clone.
            <br className="hidden sm:block" /> Yours to ship.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
            Free and open source. No license fees, no attribution required. Fork it,
            rename it, and make it your own.
          </p>

          <div className="mx-auto mt-10 flex max-w-xl items-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-left font-mono text-sm">
            <span className="select-none text-edge">$</span>
            <code className="flex-1 truncate text-foreground">{CLONE_COMMAND}</code>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={copied ? "Copied" : "Copy clone command"}
            >
              {copied ? (
                <Check className="size-4 text-edge" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ size: "lg" }),
                "group gap-2 bg-edge text-edge-foreground shadow-lg shadow-edge/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-edge/90 hover:shadow-xl hover:shadow-edge/30 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              )}
            >
              <GithubIcon className="size-5 transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-rotate-6 motion-reduce:transform-none" />
              Star on GitHub
            </a>
            <Link
              href="/sign-in"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              Explore the demo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
