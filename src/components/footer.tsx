import Link from "next/link";
import { SiX as XIcon, SiGithub as GithubIcon } from '@icons-pack/react-simple-icons'
import ThemeSwitch from "@/components/theme-switch";
import { GITHUB_REPO_URL, SITE_NAME } from "@/constants";
import { Button } from "./ui/button";
import AgenticDevStudioLogo from "./agenticdev-studio-logo";
import { getGithubStars } from "@/utils/stats";
import { Suspense } from "react";
import { StarIcon } from "@heroicons/react/24/solid";

export function Footer() {
  return (
    <footer className="border-t dark:bg-muted/30 bg-muted/60 shadow">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="py-6 md:py-8">
          {/* Responsive grid with better mobile spacing */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-6">
            {/* Legal Links */}
            <div className="space-y-3 md:space-y-4 flex flex-col items-center md:items-start">
              <h3 className="text-sm font-semibold text-foreground text-center md:text-left">Legal</h3>
              <ul className="space-y-2 flex flex-col items-center md:items-start">
                <li>
                  <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground text-center md:text-left">
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground text-center md:text-left">
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>

            {/* Company Info */}
            <div className="space-y-3 md:space-y-4 flex flex-col items-center md:items-start">
              <h3 className="text-sm font-semibold text-foreground text-center md:text-left">Company</h3>
              <ul className="space-y-2 flex flex-col items-center md:items-start">
                <li>
                  <Link href="/" className="text-sm text-muted-foreground hover:text-foreground text-center md:text-left">
                    Home
                  </Link>
                </li>
              </ul>
            </div>

            {/* Social Links and Theme Switch */}
            <div className="space-y-3 md:space-y-4 flex flex-col items-center md:items-start">
              <h3 className="text-sm font-semibold text-foreground text-center md:text-left">Social</h3>
              <div className="flex items-center space-x-4">
                <a
                  href="https://github.com/LubomirGeorgiev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <GithubIcon className="h-5 w-5" />
                  <span className="sr-only">GitHub</span>
                </a>
                <a
                  href="https://x.com/LubomirGeorg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="h-5 w-5" />
                  <span className="sr-only">X (formerly Twitter)</span>
                </a>
              </div>
            </div>
          </div>

          {/* Copyright - Optimized for mobile */}
          <div className="mt-6 pt-6 md:mt-8 md:pt-8 border-t">
            <div className="flex flex-col items-center gap-6 md:flex-row md:justify-between md:gap-4">
              <p className="text-sm text-muted-foreground text-center md:text-left">
                © {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
              </p>

              <div className="flex flex-col md:flex-row items-center gap-4 md:space-x-4">
                {GITHUB_REPO_URL && (
                  <Suspense fallback={<GithubButtonFallback />}>
                    <GithubButton />
                  </Suspense>
                )}

                <div className="flex items-center gap-4">
                  <ThemeSwitch />

                  <a
                    href="https://agenticdev.agency"
                    target="_blank"
                    className="flex items-center font-medium text-sm hover:text-foreground transition-colors"
                  >
                    <span className="whitespace-nowrap">Built by</span>
                    <AgenticDevStudioLogo className="h-7 w-7 mx-1.5" />
                    <span className="whitespace-nowrap">AgenticDev</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

// This component will be wrapped in Suspense
async function GithubButton() {
  const starsCount = await getGithubStars();

  return (
    <Button variant="outline" size="lg" className="w-full" asChild>
      <a
        href={GITHUB_REPO_URL!}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center space-x-2"
      >
        <GithubIcon className="h-6! w-6!" />
        <span className="whitespace-nowrap inline-flex items-center justify-center">
          {starsCount ? (
            <>
              <span>Fork on Github - <span className="text-yellow-500 font-bold text-[20px]">{starsCount}</span></span>
              <StarIcon className="ml-1 text-yellow-500 h-[24px]! w-[24px]!" />
            </>
          ) : (
            "Fork on Github"
          )}
        </span>
      </a>
    </Button>
  );
}

// Fallback while loading stars count
function GithubButtonFallback() {
  return (
    <Button variant="outline" size="sm" className="w-full md:w-auto h-9" asChild>
      <a
        href={GITHUB_REPO_URL!}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center space-x-2"
      >
        <GithubIcon className="h-4 w-4" />
        <span className="whitespace-nowrap inline-flex items-center gap-1">Fork on Github</span>
      </a>
    </Button>
  );
}
