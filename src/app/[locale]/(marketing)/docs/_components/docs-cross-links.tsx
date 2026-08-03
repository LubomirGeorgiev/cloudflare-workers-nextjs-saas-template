import { Link } from "@/i18n/navigation";

interface DocsCrossLink {
  href: string;
  label: string;
  /**
   * False for a machine endpoint served at one non-localized URL (the OpenAPI document, llms.txt).
   * Routing those through the i18n `Link` would prefix them with a locale that does not exist —
   * which is exactly the mistake this component exists to make unrepeatable.
   */
  isLocalized?: boolean;
}

const LINK_CLASS = "underline underline-offset-4";

/** The row of sibling-page links in a docs page header. */
export function DocsCrossLinks({ links }: { links: DocsCrossLink[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm font-medium text-primary">
      {links.map(({ href, label, isLocalized = true }) =>
        isLocalized ? (
          <Link key={href} href={href} className={LINK_CLASS}>
            {label}
          </Link>
        ) : (
          <a key={href} href={href} className={LINK_CLASS}>
            {label}
          </a>
        ),
      )}
    </div>
  );
}
