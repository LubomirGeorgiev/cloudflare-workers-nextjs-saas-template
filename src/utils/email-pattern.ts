import { MAX_EMAIL_DOMAIN_LABELS } from "@/constants";
import { normalizeEmail } from "@/lib/validation";

// The one parser for the registration blocklist's pattern format. Pure on purpose: the Valibot
// schema, the admin service that stores a row, and the matcher that reads one all share it, so a
// pattern can never be accepted by the form in a shape the matcher would not recognise.
//
// | Typed by staff       | kind            | value         | Matches                          |
// | -------------------- | --------------- | ------------- | -------------------------------- |
// | `spam@example.com`   | `email`         | the address   | that one address                 |
// | `*@example.com`      | `domain`        | `example.com` | any address at that domain       |
// | `*@*.example.com`    | `domain-suffix` | `example.com` | that domain and every subdomain  |
//
// Every branch resolves to an indexed equality lookup. The wildcard never becomes a table scan
// and never becomes a `LIKE` prefix search.

export const BLOCKED_EMAIL_KINDS = {
  EMAIL: "email",
  DOMAIN: "domain",
  DOMAIN_SUFFIX: "domain-suffix",
} as const;

export type BlockedEmailKind = typeof BLOCKED_EMAIL_KINDS[keyof typeof BLOCKED_EMAIL_KINDS];

/** The apex is the shortest thing a pattern may name: `*@*.com` would block half the internet. */
const MIN_EMAIL_DOMAIN_LABELS = 2;

const SUBDOMAIN_WILDCARD_PREFIX = "*.";
const LOCAL_PART_WILDCARD = "*";
// One label: letters, digits, and inner hyphens. Deliberately stricter than the RFCs — a pattern
// is typed by staff, not parsed off the wire, and anything else is a typo we should refuse.
const DOMAIN_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export interface ParsedEmailPattern {
  kind: BlockedEmailKind;
  /** What the matcher compares against: a full address, or a bare domain. Never the `*@` form. */
  value: string;
  /** The normalized form of what staff typed, so the list reads back as it was entered. */
  pattern: string;
}

function isValidDomain(domain: string): boolean {
  const labels = domain.split(".");

  if (labels.length < MIN_EMAIL_DOMAIN_LABELS || labels.length > MAX_EMAIL_DOMAIN_LABELS) {
    return false;
  }

  return labels.every((label) => DOMAIN_LABEL.test(label));
}

/** Splits at the LAST `@`, which is the only split a quoted local part can survive. */
function splitAtLastAt(value: string): { localPart: string; domain: string } | null {
  const index = value.lastIndexOf("@");

  if (index <= 0 || index === value.length - 1) {
    return null;
  }

  return { localPart: value.slice(0, index), domain: value.slice(index + 1) };
}

/**
 * Returns null for anything outside the three forms above — a bare domain (`example.com`), a
 * partial local wildcard (`ad*@example.com`), and a lone `*` all fail here rather than becoming
 * a row nothing can match.
 */
export function parseEmailPattern(rawPattern: string): ParsedEmailPattern | null {
  const pattern = normalizeEmail(rawPattern);
  const split = splitAtLastAt(pattern);

  if (!split) {
    return null;
  }

  const { localPart, domain } = split;

  if (localPart === LOCAL_PART_WILDCARD) {
    if (domain.startsWith(SUBDOMAIN_WILDCARD_PREFIX)) {
      const apex = domain.slice(SUBDOMAIN_WILDCARD_PREFIX.length);

      return isValidDomain(apex)
        ? { kind: BLOCKED_EMAIL_KINDS.DOMAIN_SUFFIX, value: apex, pattern }
        : null;
    }

    return isValidDomain(domain)
      ? { kind: BLOCKED_EMAIL_KINDS.DOMAIN, value: domain, pattern }
      : null;
  }

  // An exact address. The wildcard is all-or-nothing, so any `*` left in the local part is a typo.
  if (localPart.includes(LOCAL_PART_WILDCARD) || !isValidDomain(domain)) {
    return null;
  }

  return { kind: BLOCKED_EMAIL_KINDS.EMAIL, value: pattern, pattern };
}

export function isValidEmailPattern(rawPattern: string): boolean {
  return parseEmailPattern(rawPattern) !== null;
}

/**
 * The users list filters `email` by substring, so this is the narrowest substring every account
 * the pattern matches still contains: a whole domain only counts after the `@`, while a suffix
 * has to stay loose enough to keep the subdomains the count included.
 */
export function buildUserEmailFilter(parsed: ParsedEmailPattern): string {
  return parsed.kind === BLOCKED_EMAIL_KINDS.DOMAIN ? `@${parsed.value}` : parsed.value;
}

interface EmailMatchCandidates {
  /** The normalized address, for a `kind = 'email'` row. */
  address: string;
  /** The address's own domain, for a `kind = 'domain'` row. */
  domain: string;
  /** The domain and each parent, for a `kind = 'domain-suffix'` row. Apex included (15.12). */
  domainSuffixes: string[];
}

/**
 * Everything one D1 lookup needs for one address, or null when the input is not an address at all.
 *
 * Suffixes shorter than the apex are never generated, and suffixes longer than
 * `MAX_EMAIL_DOMAIN_LABELS` are dropped: no stored pattern can carry more labels than that, so
 * they could not match anything, and generating them would let the caller's input decide how many
 * values the query binds.
 */
export function buildEmailMatchCandidates(rawEmail: string): EmailMatchCandidates | null {
  const address = normalizeEmail(rawEmail);
  const split = splitAtLastAt(address);

  if (!split) {
    return null;
  }

  const { domain } = split;
  const labels = domain.split(".");
  const domainSuffixes: string[] = [];

  for (let start = 0; start + MIN_EMAIL_DOMAIN_LABELS <= labels.length; start++) {
    const suffix = labels.slice(start);

    if (suffix.length <= MAX_EMAIL_DOMAIN_LABELS) {
      domainSuffixes.push(suffix.join("."));
    }
  }

  return { address, domain, domainSuffixes };
}
