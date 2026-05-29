import "server-only";

import {
  EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS,
  SITE_DOMAIN,
  SITE_URL,
} from "@/constants";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import {
  createScheduledQueueMessage,
  EMAIL_TEMPLATE_TYPES,
  SCHEDULED_JOB_TYPES,
  type EmailSendJobPayload,
} from "@/lib/scheduler/jobs";
import isProd from "./is-prod";

type EmailSendOptions = Parameters<Cloudflare.Env["EMAIL"]["send"]>[0];
type TransactionalEmailOptions = Pick<EmailSendOptions, "html" | "subject" | "text" | "to"> & {
  type: EmailSendJobPayload["template"];
};

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

export async function sendTransactionalEmailNow({
  to,
  subject,
  html,
  text,
  type,
}: TransactionalEmailOptions) {
  const { env } = await getCloudflareContext();
  const { emailFrom, emailFromName, emailReplyTo } = await getEmailEnv();

  if (!env.EMAIL) {
    throw new Error("Cloudflare Email Service binding EMAIL is not configured.");
  }

  if (!emailFrom) {
    throw new Error("EMAIL_FROM is not configured.");
  }

  await env.EMAIL.send({
    to,
    from: emailFromName
      ? {
          email: emailFrom,
          name: emailFromName,
        }
      : emailFrom,
    subject,
    html,
    text,
    ...(emailReplyTo ? { replyTo: emailReplyTo } : {}),
    headers: {
      "X-Transactional-Email-Type": type,
    },
  });
}

async function queueTransactionalEmail(payload: EmailSendJobPayload): Promise<void> {
  const { env } = await getCloudflareContext();

  await env.SCHEDULER_QUEUE.send(createScheduledQueueMessage({
    type: SCHEDULED_JOB_TYPES.EMAIL_SEND,
    payload,
    runAt: new Date(),
  }));
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

export function renderTransactionalEmail(payload: EmailSendJobPayload): TransactionalEmailOptions {
  switch (payload.template) {
    case EMAIL_TEMPLATE_TYPES.PASSWORD_RESET: {
      const resetUrl = `${SITE_URL}/reset-password?token=${payload.data.resetToken}`;
      const emailTemplate = buildEmailTemplate({
        title: `Reset your ${SITE_DOMAIN} password`,
        greeting: `Hi ${payload.data.username},`,
        intro: `We received a request to reset your password for your ${SITE_DOMAIN} account. Click the button below to choose a new password. For security reasons, this link will expire in 1 hour.`,
        buttonLabel: "Reset Password",
        buttonUrl: resetUrl,
        secondaryText: `If you didn't request this password reset, you can safely ignore this email. Your ${SITE_DOMAIN} account password will remain unchanged.`,
        fallbackText: "If you're having trouble with the button above, copy and paste this URL into your browser:",
        footerText: `This is an automated message from ${SITE_DOMAIN}. If you did not request this email, please ignore it or contact support if you have concerns.`,
      });

      return {
        to: payload.to,
        subject: `Reset your password for ${SITE_DOMAIN}`,
        html: emailTemplate.html,
        text: emailTemplate.text,
        type: payload.template,
      };
    }
    case EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION: {
      const verificationUrl = `${SITE_URL}/verify-email?token=${payload.data.verificationToken}`;
      const expirationHours = EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS / 60 / 60;
      const emailTemplate = buildEmailTemplate({
        title: `Verify your ${SITE_DOMAIN} email`,
        greeting: `Hi ${payload.data.username},`,
        intro: `Thanks for signing up for ${SITE_DOMAIN}! We need to verify your email address to complete your registration. Please click the button below to verify your email address.`,
        buttonLabel: "Verify Email Address",
        buttonUrl: verificationUrl,
        secondaryText: `This verification link will expire in ${expirationHours} hour${expirationHours > 1 ? "s" : ""}. After that, you'll need to request a new verification email.`,
        fallbackText: `If you didn't create an account on ${SITE_DOMAIN}, you can safely ignore this email.`,
        footerText: `This is an automated message from ${SITE_DOMAIN}. Please do not reply to this email.`,
      });

      return {
        to: payload.to,
        subject: `Verify your email for ${SITE_DOMAIN}`,
        html: emailTemplate.html,
        text: emailTemplate.text,
        type: payload.template,
      };
    }
    case EMAIL_TEMPLATE_TYPES.TEAM_INVITATION: {
      const inviteUrl = `${SITE_URL}/team-invite?token=${payload.data.invitationToken}`;
      const emailTemplate = buildEmailTemplate({
        title: `You've been invited to join a team on ${SITE_DOMAIN}`,
        greeting: "Hello,",
        intro: `${payload.data.inviterName} has invited you to join the "${payload.data.teamName}" team on ${SITE_DOMAIN}.`,
        buttonLabel: "Accept Invitation",
        buttonUrl: inviteUrl,
        secondaryText: `This invitation was sent to ${payload.to}. If you don't have an account yet, you'll be able to create one when you accept the invitation.`,
        fallbackText: `If you didn't expect to receive an invitation to this team, you can safely ignore this email.`,
        footerText: `This is an automated message from ${SITE_DOMAIN}. Please do not reply to this email.`,
      });

      return {
        to: payload.to,
        subject: `You've been invited to join a team on ${SITE_DOMAIN}`,
        html: emailTemplate.html,
        text: emailTemplate.text,
        type: payload.template,
      };
    }
  }
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

  await queueTransactionalEmail({
    to: email,
    template: EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
    data: {
      resetToken,
      username,
    },
  });
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

  await queueTransactionalEmail({
    to: email,
    template: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
    data: {
      verificationToken,
      username,
    },
  });
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

  await queueTransactionalEmail({
    to: email,
    template: EMAIL_TEMPLATE_TYPES.TEAM_INVITATION,
    data: {
      invitationToken,
      inviterName,
      teamName,
    },
  });
}
