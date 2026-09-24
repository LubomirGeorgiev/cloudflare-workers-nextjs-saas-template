"use client";

import NextLink from "next/link";
import {
  usePathname as useNextPathname,
  useRouter as useNextRouter,
} from "next/navigation";
import { type ComponentProps, type Ref, forwardRef, useMemo } from "react";

import { useLocale } from "./client";
import { stripLocalePrefix } from "./locale-prefix";
import { localizeHref } from "./localize-href";

// A locale switch is `useChangeLocale` in `src/hooks/useChangeLocale.ts`, so no `locale` prop here.
// A string-only `href`: a `UrlObject` would skip `localizeHref` and lose the locale prefix.
type LocalizedLinkProps = Omit<ComponentProps<typeof NextLink>, "href" | "locale" | "ref"> & {
  href: string;
};

function LocalizedLink({ href, ...rest }: LocalizedLinkProps, ref: Ref<HTMLAnchorElement>) {
  const locale = useLocale();
  const localizedHref = localizeHref({ href, locale });

  return <NextLink {...rest} ref={ref} href={localizedHref} />;
}

export const Link = forwardRef(LocalizedLink);

/**
 * The active path with its locale prefix removed. Like Next's own hook it returns `null` outside a
 * Next module graph, which the types deliberately do not admit.
 */
export function usePathname(): string {
  const pathname = useNextPathname();

  return useMemo(
    () => (pathname ? stripLocalePrefix(pathname) ?? pathname : pathname),
    [pathname],
  );
}

type AppRouter = ReturnType<typeof useNextRouter>;

/** Next's router, with `push`/`replace`/`prefetch` localized to the active locale. */
export function useRouter(): AppRouter {
  const router = useNextRouter();
  const locale = useLocale();

  return useMemo(
    () => ({
      ...router,
      push: (href, options) => router.push(localizeHref({ href, locale }), options),
      replace: (href, options) => router.replace(localizeHref({ href, locale }), options),
      prefetch: (href, options) => router.prefetch(localizeHref({ href, locale }), options),
    }),
    [locale, router],
  );
}
