import { afterEach, describe, expect, test, vi } from "vitest";

import { LOCALES } from "@/i18n/config";
import { MESSAGE_CATALOGS } from "@/i18n/message-catalogs";
import { EMAIL_TEMPLATE_TYPES } from "@/lib/scheduler/jobs";

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

  test("registers an email message catalog for every configured locale", () => {
    expect(Object.keys(MESSAGE_CATALOGS).sort()).toEqual([...LOCALES].sort());

    for (const locale of LOCALES) {
      expect(MESSAGE_CATALOGS[locale]).toHaveProperty("Emails");
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
  });

  test("renders the password reset email in English by default", async () => {
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
  });

  test("falls back to the default locale for an unknown payload locale", async () => {
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

    expect(renderedEmail.html).toContain('<html lang="en">');
    expect(renderedEmail.html).toContain("Reset your");
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
