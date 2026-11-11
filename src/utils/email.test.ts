import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS,
  PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS,
  SITE_DOMAIN,
  SITE_NAME,
  SITE_URL,
  TEAM_INVITATION_EXPIRY_DAYS,
  TEAMS_DASHBOARD_PATH,
} from "@/constants";
import { EMAIL_LOGO } from "@/constants/logo";
import { LOGO_VERSION } from "@/constants/logo-version";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { CATALOG_LOADERS, loadCatalog } from "@/i18n/message-catalogs";
import { getTranslator } from "@/i18n/translator";
import { escapeHtml } from "@/utils/escape-html";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";
import {
  EMAIL_TEMPLATE_TYPES,
  PAYMENT_STATUS_EMAIL_TEMPLATES,
  type EmailSendJobPayload,
} from "@/lib/scheduler/jobs";

/** One payload per template, so the shared header is covered for every email the app sends. */
const LOGO_HEADER_PAYLOADS: Extract<EmailSendJobPayload, { locale: string }>[] = [
  {
    to: "user@example.com",
    template: EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
    locale: DEFAULT_LOCALE,
    data: { resetToken: "reset-token", username: "Ana" },
  },
  {
    to: "user@example.com",
    template: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
    locale: DEFAULT_LOCALE,
    data: { verificationToken: "verify-token", username: "Ana" },
  },
  {
    to: "user@example.com",
    template: EMAIL_TEMPLATE_TYPES.TEAM_INVITATION,
    locale: DEFAULT_LOCALE,
    data: { invitationToken: "invite-token", inviterName: "Ana", teamName: "Acme" },
  },
  ...PAYMENT_STATUS_EMAIL_TEMPLATES.map((template) => ({
    to: "owner@example.com",
    template,
    locale: DEFAULT_LOCALE,
    data: { username: "Ana", teamName: "Acme", teamSlug: "acme" },
  })),
];

const HOUR_SECONDS = 60 * 60;

// Each expiry the copy states, paired with the constant the token or invitation row uses.
const EXPIRY_COPY_CASES = [
  {
    template: EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
    catalogKey: "PasswordReset.intro",
    placeholder: "{expirationHours",
    amount: PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS / HOUR_SECONDS,
  },
  {
    template: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
    catalogKey: "EmailVerification.secondaryText",
    placeholder: "{expirationHours",
    amount: EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS / HOUR_SECONDS,
  },
  {
    template: EMAIL_TEMPLATE_TYPES.TEAM_INVITATION,
    catalogKey: "TeamInvitation.secondaryText",
    placeholder: "{expirationDays",
    amount: TEAM_INVITATION_EXPIRY_DAYS,
  },
] as const;

const { getCloudflareContextMock } = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

const {
  renderTransactionalEmail,
  sendTransactionalEmailNow,
} = await import("@/utils/email");

describe("transactional email", () => {
  beforeEach(() => {
    getCloudflareContextMock.mockResolvedValue({ env: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // A hard-coded duration drifts from the constant; the placeholder makes the copy follow it.
  describe.each(LOCALES)("expiry copy in %s", (locale) => {
    test.each(EXPIRY_COPY_CASES)(
      "states the $template expiry from its constant",
      async ({ template, catalogKey, placeholder, amount }) => {
        const catalog = await loadCatalog(locale);
        const [section, key] = catalogKey.split(".") as [keyof typeof catalog.Emails, string];
        const payload = LOGO_HEADER_PAYLOADS.find((candidate) => candidate.template === template);
        if (!payload) {
          throw new Error(`No payload for ${template}`);
        }

        const renderedEmail = await renderTransactionalEmail({ ...payload, locale });

        expect((catalog.Emails[section] as Record<string, string>)[key]).toContain(placeholder);
        expect(renderedEmail.text).toContain(new Intl.NumberFormat(locale).format(amount));
      },
    );
  });

  test("names the inviter and the team in the invitation subject", async () => {
    const renderedEmail = await renderTransactionalEmail({
      to: "invitee@example.com",
      template: EMAIL_TEMPLATE_TYPES.TEAM_INVITATION,
      locale: DEFAULT_LOCALE,
      data: { invitationToken: "invite-token", inviterName: "Inviter Person", teamName: "Team Name" },
    });

    expect(renderedEmail.subject).toContain("Inviter Person");
    expect(renderedEmail.subject).toContain("Team Name");
  });

  // The "ignore this email" line once sat in the fallback slot, and the plain text once had no URL.
  test.each(LOGO_HEADER_PAYLOADS)("puts the raw URL right after the copy-the-link line in $template", async (payload) => {
    const t = await getTranslator({ locale: DEFAULT_LOCALE, namespace: "Emails" });
    const renderedEmail = await renderTransactionalEmail(payload);
    const lines = renderedEmail.text?.split("\n") ?? [];
    const ctaUrl = expectedCtaUrl(payload);

    expect(lines[lines.indexOf(t("Common.fallbackText")) + 1]).toBe(ctaUrl);
    expect(renderedEmail.html).toContain(`${escapeHtml(t("Common.fallbackText"))}</p>`);
    expect(renderedEmail.html).toContain(`<a href="${escapeHtml(ctaUrl)}"`);
  });

  test.each([
    { replyTo: "support@example.com", footerKey: "Common.footerTextWithReplyTo" },
    { replyTo: undefined, footerKey: "Common.footerText" },
  ] as const)("matches the footer to the Reply-To header ($footerKey)", async ({ replyTo, footerKey }) => {
    getCloudflareContextMock.mockResolvedValue({ env: { EMAIL_REPLY_TO: replyTo } });
    const t = await getTranslator({ locale: DEFAULT_LOCALE, namespace: "Emails" });
    const renderedEmail = await renderTransactionalEmail({
      to: "user@example.com",
      template: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
      locale: DEFAULT_LOCALE,
      data: { verificationToken: "verify-token", username: "Ana" },
    });

    expect(renderedEmail.text?.endsWith(t(footerKey, { siteDomain: SITE_DOMAIN }))).toBe(true);
  });

  test("registers an email message catalog for every configured locale", async () => {
    expect(Object.keys(CATALOG_LOADERS).sort()).toEqual([...LOCALES].sort());

    for (const locale of LOCALES) {
      expect(await loadCatalog(locale)).toHaveProperty("Emails");
    }
  });

  test("escapes user-controlled team invitation content in HTML", async () => {
    const renderedEmail = await renderTransactionalEmail({
      to: "invitee@example.com",
      template: EMAIL_TEMPLATE_TYPES.TEAM_INVITATION,
      locale: "en",
      data: {
        invitationToken: "invite-token",
        inviterName: "<script>alert('x')</script>",
        teamName: "A&B \"Team\"",
      },
    });

    expect(renderedEmail.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(renderedEmail.html).toContain("A&amp;B &quot;Team&quot;");
    expect(renderedEmail.html).not.toContain("<script>alert");
    expect(renderedEmail.text).toContain("<script>alert('x')</script>");
    expect(renderedEmail.text).toContain("/team-invite?token=invite-token");
  });

  // Every template shares one builder, so the mark either reaches every inbox or none.
  // The dimensions are asserted because Outlook lays the message out before the image arrives.
  test.each(LOGO_HEADER_PAYLOADS)("puts the rasterized logo in the $template header", async (payload) => {
    const renderedEmail = await renderTransactionalEmail(payload);

    // One URL for every recipient — the `?v=` stamp only moves when `pnpm logo:generate` runs.
    expect(renderedEmail.html).toContain(
      `src="${SITE_URL}${EMAIL_LOGO.pathname}?v=${LOGO_VERSION}"`,
    );
    // Alt text stays the product name in every locale — it is all a blocked-image reader gets.
    expect(renderedEmail.html).toContain(`alt="${SITE_NAME}"`);
    expect(renderedEmail.html).toContain(
      `width="${EMAIL_LOGO.width}" height="${EMAIL_LOGO.height}"`,
    );
    // A hosted PNG, never SVG or a data URI: clients strip both.
    expect(renderedEmail.html).not.toContain("data:image");
  });

  // The owner acts on the team billing page, in the owner's own language.
  describe.each(LOCALES)("payment notices in %s", (locale) => {
    test.each(PAYMENT_STATUS_EMAIL_TEMPLATES)("%s links to the team billing page and names the team", async (template) => {
      const renderedEmail = await renderTransactionalEmail({
        to: "owner@example.com",
        template,
        locale,
        data: { username: "Ana", teamName: "A&B Team", teamSlug: "acme" },
      });

      expect(renderedEmail.text).toContain(absoluteLocalizedUrl({ pathname: `${TEAMS_DASHBOARD_PATH}/acme/billing`, locale }));
      expect(renderedEmail.subject).toContain("A&B Team");
      expect(renderedEmail.html).toContain(escapeHtml("A&B Team"));
      expect(renderedEmail.html).not.toContain("A&B Team");
    });
  });

  test("renders the password reset email in Spanish when the payload locale is es", async () => {
    const renderedEmail = await renderTransactionalEmail({
      to: "user@example.com",
      template: EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
      locale: "es",
      data: {
        resetToken: "reset-token",
        username: "Ana",
      },
    });

    expect(renderedEmail.html).toContain('<html lang="es">');
    expect(renderedEmail.html).toContain("Restablece tu contraseña");
    expect(renderedEmail.html).toContain("Hola Ana,");
    expect(renderedEmail.subject).toContain("Restablece tu contraseña");
    expect(renderedEmail.html).not.toContain("Reset your");
    expect(renderedEmail.html).toContain("/es/reset-password?token=");
  });

  test("renders the password reset email in English when the payload locale is en", async () => {
    const renderedEmail = await renderTransactionalEmail({
      to: "user@example.com",
      template: EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
      locale: "en",
      data: {
        resetToken: "reset-token",
        username: "Ana",
      },
    });

    expect(renderedEmail.html).toContain('<html lang="en">');
    expect(renderedEmail.html).toContain("Reset your");
    expect(renderedEmail.html).toContain("Hi Ana,");
    expect(renderedEmail.subject).toContain("Reset your password");
    expect(renderedEmail.html).toContain("/reset-password?token=");
    expect(renderedEmail.html).not.toContain("/en/reset-password?token=");
  });

  test("falls back to the default locale for an unknown payload locale", async () => {
    const defaultLocaleEmail = await renderTransactionalEmail({
      to: "user@example.com",
      template: EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
      locale: DEFAULT_LOCALE,
      data: {
        resetToken: "reset-token",
        username: "Ana",
      },
    });
    const renderedEmail = await renderTransactionalEmail({
      to: "user@example.com",
      template: EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
      // @ts-expect-error - intentionally testing an unsupported locale value
      locale: "xx",
      data: {
        resetToken: "reset-token",
        username: "Ana",
      },
    });

    expect(renderedEmail).toEqual(defaultLocaleEmail);
  });

  test("sends transactional emails with configured sender metadata", async () => {
    const send = vi.fn(async () => undefined);
    getCloudflareContextMock.mockResolvedValue({
      env: {
        EMAIL: { send },
        EMAIL_FROM: "noreply@example.com",
        EMAIL_FROM_NAME: "Example App",
        EMAIL_REPLY_TO: "support@example.com",
      },
    });

    await sendTransactionalEmailNow({
      to: "user@example.com",
      subject: "Welcome",
      html: "<p>Welcome</p>",
      text: "Welcome",
      type: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
    });

    expect(send).toHaveBeenCalledWith({
      to: "user@example.com",
      from: {
        email: "noreply@example.com",
        name: "Example App",
      },
      subject: "Welcome",
      html: "<p>Welcome</p>",
      text: "Welcome",
      replyTo: "support@example.com",
      headers: {
        "X-Transactional-Email-Type": EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
      },
    });
  });

  test("throws when the Cloudflare Email binding is missing", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: {
        EMAIL_FROM: "noreply@example.com",
      },
    });

    await expect(sendTransactionalEmailNow({
      to: "user@example.com",
      subject: "Welcome",
      html: "<p>Welcome</p>",
      text: "Welcome",
      type: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
    })).rejects.toThrow("Cloudflare Email Service binding EMAIL is not configured.");
  });
});

/** The button URL each template must carry, built from the payload so a fork's copy does not matter. */
function expectedCtaUrl(payload: (typeof LOGO_HEADER_PAYLOADS)[number]) {
  const { locale } = payload;
  switch (payload.template) {
    case EMAIL_TEMPLATE_TYPES.PASSWORD_RESET:
      return `${absoluteLocalizedUrl({ pathname: "/reset-password", locale })}?token=${payload.data.resetToken}`;
    case EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION:
      return `${absoluteLocalizedUrl({ pathname: "/verify-email", locale })}?token=${payload.data.verificationToken}`;
    case EMAIL_TEMPLATE_TYPES.TEAM_INVITATION:
      return `${absoluteLocalizedUrl({ pathname: "/team-invite", locale })}?token=${payload.data.invitationToken}`;
    case EMAIL_TEMPLATE_TYPES.PAYMENT_PAST_DUE:
    case EMAIL_TEMPLATE_TYPES.PAYMENT_UNPAID:
      return absoluteLocalizedUrl({ pathname: `${TEAMS_DASHBOARD_PATH}/${payload.data.teamSlug}/billing`, locale });
  }
}
