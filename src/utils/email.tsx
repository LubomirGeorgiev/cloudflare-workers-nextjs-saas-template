import "server-only";

import {
  EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS,
  SITE_DOMAIN,
  SITE_URL,
} from "@/constants";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import isProd from "./is-prod";

interface BrevoEmailOptions {
  to: { email: string; name?: string }[];
  subject: string;
  replyTo?: string;
  htmlContent: string;
  textContent?: string;
  templateId?: number;
  params?: Record<string, string>;
  tags?: string[];
}

interface ResendEmailOptions {
  to: string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  text?: string;
  tags?: { name: string; value: string }[];
}

type EmailProvider = "resend" | "brevo" | null;

interface EmailTemplate {
  html: string;
  text: string;
}

async function getEmailEnv() {
  const { env } = await getCloudflareContext();

  return {
    emailFrom: env.EMAIL_FROM,
    emailFromName: env.EMAIL_FROM_NAME,
    emailReplyTo: env.EMAIL_REPLY_TO,
  };
}

async function getEmailProvider(): Promise<EmailProvider> {
  if (process.env.RESEND_API_KEY) {
    return "resend";
  }

  if (process.env.BREVO_API_KEY) {
    return "brevo";
  }

  return null;
}

// TODO Migrate to https://blog.cloudflare.com/email-for-agents/
async function sendResendEmail({
  to,
  subject,
  html,
  from,
  replyTo: originalReplyTo,
  text,
  tags,
}: ResendEmailOptions) {
  if (!isProd) {
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const { emailFrom, emailFromName, emailReplyTo } = await getEmailEnv();
  const replyTo = originalReplyTo ?? emailReplyTo;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    } as const,
    body: JSON.stringify({
      from: from ?? `${emailFromName} <${emailFrom}>`,
      to,
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      tags,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to send email via Resend: ${JSON.stringify(error)}`);
  }

  return response.json();
}

async function sendBrevoEmail({
  to,
  subject,
  replyTo: originalReplyTo,
  htmlContent,
  textContent,
  templateId,
  params,
  tags,
}: BrevoEmailOptions) {
  if (!isProd) {
    return;
  }

  if (!process.env.BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is not set");
  }

  const { emailFrom, emailFromName, emailReplyTo } = await getEmailEnv();
  const replyTo = originalReplyTo ?? emailReplyTo;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": process.env.BREVO_API_KEY,
    } as const,
    body: JSON.stringify({
      sender: {
        name: emailFromName,
        email: emailFrom,
      },
      to,
      htmlContent,
      textContent,
      subject,
      templateId,
      params,
      tags,
      ...(replyTo ? {
        replyTo: {
          email: replyTo,
        }
      } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to send email via Brevo: ${JSON.stringify(error)}`);
  }

  return response.json();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmailTemplate({
  title,
  greeting,
  intro,
  buttonLabel,
  buttonUrl,
  secondaryText,
  fallbackText,
  footerText,
}: {
  title: string;
  greeting: string;
  intro: string;
  buttonLabel: string;
  buttonUrl: string;
  secondaryText: string;
  fallbackText: string;
  footerText: string;
}): EmailTemplate {
  const escapedTitle = escapeHtml(title);
  const escapedGreeting = escapeHtml(greeting);
  const escapedIntro = escapeHtml(intro);
  const escapedButtonLabel = escapeHtml(buttonLabel);
  const escapedButtonUrl = escapeHtml(buttonUrl);
  const escapedSecondaryText = escapeHtml(secondaryText);
  const escapedFallbackText = escapeHtml(fallbackText);
  const escapedFooterText = escapeHtml(footerText);

  return {
    html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapedTitle}</title>
  </head>
  <body style="margin:0;padding:30px 16px;background-color:#f6f9fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Ubuntu,sans-serif;color:#525f7f;">
    <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border:1px solid #f0f0f0;border-radius:5px;box-shadow:0 5px 10px rgba(20,50,70,.2);padding:40px;">
      <h1 style="margin:0 0 30px;font-size:18px;line-height:1.5;text-align:center;color:#525f7f;">${escapedTitle}</h1>
      <p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapedGreeting}</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapedIntro}</p>
      <div style="margin:30px 0;text-align:center;">
        <a href="${escapedButtonUrl}" style="display:inline-block;padding:13px 40px;border-radius:5px;background-color:#000000;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">${escapedButtonLabel}</a>
      </div>
      <p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapedSecondaryText}</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapedFallbackText}</p>
      <p style="margin:16px 0 30px;font-size:14px;line-height:22px;text-align:center;word-break:break-all;color:#556cd6;text-decoration:underline;">${escapedButtonUrl}</p>
    </div>
    <p style="margin:20px auto 0;max-width:600px;font-size:12px;line-height:16px;text-align:center;color:#8898aa;">${escapedFooterText}</p>
  </body>
</html>`,
    text: [
      title,
      "",
      greeting,
      "",
      intro,
      "",
      `${buttonLabel}: ${buttonUrl}`,
      "",
      secondaryText,
      "",
      fallbackText,
      "",
      footerText,
    ].join("\n"),
  };
}

export async function sendPasswordResetEmail({
  email,
  resetToken,
  username
}: {
  email: string;
  resetToken: string;
  username: string;
}) {
  const resetUrl = `${SITE_URL}/reset-password?token=${resetToken}`;

  if (!isProd) {
    console.warn('\n\n\nPassword reset url: ', resetUrl)

    return
  }

  const emailTemplate = buildEmailTemplate({
    title: `Reset your ${SITE_DOMAIN} password`,
    greeting: `Hi ${username},`,
    intro: `We received a request to reset your password for your ${SITE_DOMAIN} account. Click the button below to choose a new password. For security reasons, this link will expire in 1 hour.`,
    buttonLabel: "Reset Password",
    buttonUrl: resetUrl,
    secondaryText: `If you didn't request this password reset, you can safely ignore this email. Your ${SITE_DOMAIN} account password will remain unchanged.`,
    fallbackText: "If you're having trouble with the button above, copy and paste this URL into your browser:",
    footerText: `This is an automated message from ${SITE_DOMAIN}. If you did not request this email, please ignore it or contact support if you have concerns.`,
  });
  const provider = await getEmailProvider();

  if (!provider && isProd) {
    throw new Error("No email provider configured. Set either RESEND_API_KEY or BREVO_API_KEY in your environment.");
  }

  if (provider === "resend") {
    await sendResendEmail({
      to: [email],
      subject: `Reset your password for ${SITE_DOMAIN}`,
      html: emailTemplate.html,
      text: emailTemplate.text,
      tags: [{ name: "type", value: "password-reset" }],
    });
  } else {
    await sendBrevoEmail({
      to: [{ email, name: username }],
      subject: `Reset your password for ${SITE_DOMAIN}`,
      htmlContent: emailTemplate.html,
      textContent: emailTemplate.text,
      tags: ["password-reset"],
    });
  }
}

export async function sendVerificationEmail({
  email,
  verificationToken,
  username
}: {
  email: string;
  verificationToken: string;
  username: string;
}) {
  const verificationUrl = `${SITE_URL}/verify-email?token=${verificationToken}`;

  if (!isProd) {
    console.warn('\n\n\nVerification url: ', verificationUrl)

    return
  }

  const expirationHours = EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS / 60 / 60;
  const emailTemplate = buildEmailTemplate({
    title: `Verify your ${SITE_DOMAIN} email`,
    greeting: `Hi ${username},`,
    intro: `Thanks for signing up for ${SITE_DOMAIN}! We need to verify your email address to complete your registration. Please click the button below to verify your email address.`,
    buttonLabel: "Verify Email Address",
    buttonUrl: verificationUrl,
    secondaryText: `This verification link will expire in ${expirationHours} hour${expirationHours > 1 ? "s" : ""}. After that, you'll need to request a new verification email.`,
    fallbackText: `If you didn't create an account on ${SITE_DOMAIN}, you can safely ignore this email.`,
    footerText: `This is an automated message from ${SITE_DOMAIN}. Please do not reply to this email.`,
  });
  const provider = await getEmailProvider();

  if (!provider && isProd) {
    throw new Error("No email provider configured. Set either RESEND_API_KEY or BREVO_API_KEY in your environment.");
  }

  if (provider === "resend") {
    await sendResendEmail({
      to: [email],
      subject: `Verify your email for ${SITE_DOMAIN}`,
      html: emailTemplate.html,
      text: emailTemplate.text,
      tags: [{ name: "type", value: "email-verification" }],
    });
  } else {
    await sendBrevoEmail({
      to: [{ email, name: username }],
      subject: `Verify your email for ${SITE_DOMAIN}`,
      htmlContent: emailTemplate.html,
      textContent: emailTemplate.text,
      tags: ["email-verification"],
    });
  }
}

export async function sendTeamInvitationEmail({
  email,
  invitationToken,
  teamName,
  inviterName
}: {
  email: string;
  invitationToken: string;
  teamName: string;
  inviterName: string;
}) {
  const inviteUrl = `${SITE_URL}/team-invite?token=${invitationToken}`;

  if (!isProd) {
    console.warn('\n\n\nTeam invitation url: ', inviteUrl)
    return
  }

  const emailTemplate = buildEmailTemplate({
    title: `You've been invited to join a team on ${SITE_DOMAIN}`,
    greeting: "Hello,",
    intro: `${inviterName} has invited you to join the "${teamName}" team on ${SITE_DOMAIN}.`,
    buttonLabel: "Accept Invitation",
    buttonUrl: inviteUrl,
    secondaryText: `This invitation was sent to ${email}. If you don't have an account yet, you'll be able to create one when you accept the invitation.`,
    fallbackText: `If you didn't expect to receive an invitation to this team, you can safely ignore this email.`,
    footerText: `This is an automated message from ${SITE_DOMAIN}. Please do not reply to this email.`,
  });

  const provider = await getEmailProvider();

  if (!provider && isProd) {
    throw new Error("No email provider configured. Set either RESEND_API_KEY or BREVO_API_KEY in your environment.");
  }

  if (provider === "resend") {
    await sendResendEmail({
      to: [email],
      subject: `You've been invited to join a team on ${SITE_DOMAIN}`,
      html: emailTemplate.html,
      text: emailTemplate.text,
      tags: [{ name: "type", value: "team-invitation" }],
    });
  } else {
    await sendBrevoEmail({
      to: [{ email }],
      subject: `You've been invited to join a team on ${SITE_DOMAIN}`,
      htmlContent: emailTemplate.html,
      textContent: emailTemplate.text,
      tags: ["team-invitation"],
    });
  }
}
