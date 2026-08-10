import { afterEach, describe, expect, test, vi } from "vitest";

import { SITE_NAME, SITE_URL } from "@/constants";
import { EMAIL_LOGO } from "@/constants/logo";
import { LOGO_VERSION } from "@/constants/logo-version";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { CATALOG_LOADERS, loadCatalog } from "@/i18n/message-catalogs";
import { EMAIL_TEMPLATE_TYPES, type EmailSendJobPayload } from "@/lib/scheduler/jobs";

/** One payload per template, so the shared header is covered for every email the app sends. */
const LOGO_HEADER_PAYLOADS: EmailSendJobPayload[] = [
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
];

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
  afterEach(() => {
    vi.clearAllMocks();
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

  // Every template shares one builder, so the mark either reaches all three inboxes or none.
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
