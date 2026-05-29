import { afterEach, describe, expect, test, vi } from "vitest";

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

  test("escapes user-controlled team invitation content in HTML", () => {
    const renderedEmail = renderTransactionalEmail({
      to: "invitee@example.com",
      template: EMAIL_TEMPLATE_TYPES.TEAM_INVITATION,
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
