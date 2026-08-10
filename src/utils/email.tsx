import "server-only";

import { createTranslator } from "next-intl";

import {
  EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS,
  SITE_DOMAIN,
  SITE_NAME,
  SITE_URL,
} from "@/constants";
import { EMAIL_LOGO } from "@/constants/logo";
import { LOGO_VERSION } from "@/constants/logo-version";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";
import { loadCatalog } from "@/i18n/message-catalogs";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { escapeHtml } from "@/utils/escape-html";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";
import {
  createScheduledQueueMessage,
  EMAIL_TEMPLATE_TYPES,
  SCHEDULED_JOB_TYPES,
  type EmailSendJobPayload,
} from "@/lib/scheduler/jobs";
import isProd from "./is-prod";

// Not `absoluteLocalizedUrl`: that prefixes a locale, and the asset is the same in every language.
// The mark has to be a hosted absolute URL because clients that allow images at all fetch them —
// Gmail, Outlook and Yahoo each strip an inline data URI, and a `cid:` reference needs the
// multipart/related body the send path does not build.
// `?v=` is stamped by `pnpm logo:generate`, not per send: mail image proxies hold a URL for a long
// time and ignore our headers, so it has to change when the artwork does — and only then, or every
// recipient refetches and each message carries a URL unique enough to reveal who opened it.
const EMAIL_LOGO_URL = `${SITE_URL}${EMAIL_LOGO.pathname}?v=${LOGO_VERSION}`;

// The queue consumer has no request context (no cookies/headers), so it can't
// call getUserLocale()/getTranslations(). `loadCatalog` keeps one explicit `import()`
// per locale, so the Worker bundle never resolves a variable import path.
async function getEmailTranslator(locale: string) {
  // Resolve against the full catalog, not ENABLED_LOCALES: email language follows
  // the recipient's stored preference and is decoupled from public-route i18n, so a
  // localized message catalog is used even when locale-prefixed routing is disabled.
  const resolvedLocale: Locale = (LOCALES as readonly string[]).includes(locale)
    ? (locale as Locale)
    : DEFAULT_LOCALE;

  const messages = await loadCatalog(resolvedLocale);

  return {
    locale: resolvedLocale,
    t: createTranslator({ locale: resolvedLocale, messages, namespace: "Emails" }),
  };
}

// Avoid Pick<> from SendEmail.send() params: EmailDestinations is a to|cc|bcc
// union, so Pick makes `to` optional and breaks EmailMessageBuilder assignment.
type TransactionalEmailOptions = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
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

  const message: EmailMessageBuilder = {
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
    headers: {
      "X-Transactional-Email-Type": type,
    },
  };

  if (emailReplyTo) {
    message.replyTo = emailReplyTo;
  }

  await env.EMAIL.send(message);
}

async function queueTransactionalEmail(payload: EmailSendJobPayload): Promise<void> {
  const { env } = await getCloudflareContext();

  await env.SCHEDULER_QUEUE.send(createScheduledQueueMessage({
    type: SCHEDULED_JOB_TYPES.EMAIL_SEND,
    payload,
    runAt: new Date(),
  }));
}

function buildEmailTemplate({
  locale,
  title,
  greeting,
  intro,
  buttonLabel,
  buttonUrl,
  secondaryText,
  fallbackText,
  footerText,
}: {
  locale: Locale;
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
  // Alt text, not a translated string: the product name is the same in every locale, so it needs
  // no catalog row, and it is what the reader sees while remote images are still blocked.
  const escapedSiteName = escapeHtml(SITE_NAME);

  return {
    html: `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapedTitle}</title>
  </head>
  <body style="margin:0;padding:30px 16px;background-color:#f6f9fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Ubuntu,sans-serif;color:#525f7f;">
    <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border:1px solid #f0f0f0;border-radius:5px;box-shadow:0 5px 10px rgba(20,50,70,.2);padding:40px;">
      <div style="margin:0 0 24px;text-align:center;">
        <img src="${escapeHtml(EMAIL_LOGO_URL)}" width="${EMAIL_LOGO.width}" height="${EMAIL_LOGO.height}" alt="${escapedSiteName}" style="display:inline-block;border:0;outline:none;text-decoration:none;" />
      </div>
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

export async function renderTransactionalEmail(
  payload: EmailSendJobPayload,
): Promise<TransactionalEmailOptions> {
  const { locale, t } = await getEmailTranslator(payload.locale);

  switch (payload.template) {
    case EMAIL_TEMPLATE_TYPES.PASSWORD_RESET: {
      const resetUrl = `${absoluteLocalizedUrl({ pathname: "/reset-password", locale })}?token=${payload.data.resetToken}`;
      const emailTemplate = buildEmailTemplate({
        locale,
        title: t("PasswordReset.title", { siteDomain: SITE_DOMAIN }),
        greeting: t("Common.greeting", { username: payload.data.username }),
        intro: t("PasswordReset.intro", { siteDomain: SITE_DOMAIN }),
        buttonLabel: t("PasswordReset.buttonLabel"),
        buttonUrl: resetUrl,
        secondaryText: t("PasswordReset.secondaryText", { siteDomain: SITE_DOMAIN }),
        fallbackText: t("Common.fallbackText"),
        footerText: t("PasswordReset.footerText", { siteDomain: SITE_DOMAIN }),
      });

      return {
        to: payload.to,
        subject: t("PasswordReset.subject", { siteDomain: SITE_DOMAIN }),
        html: emailTemplate.html,
        text: emailTemplate.text,
        type: payload.template,
      };
    }
    case EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION: {
      const verificationUrl = `${absoluteLocalizedUrl({ pathname: "/verify-email", locale })}?token=${payload.data.verificationToken}`;
      const expirationHours = EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS / 60 / 60;
      const emailTemplate = buildEmailTemplate({
        locale,
        title: t("EmailVerification.title", { siteDomain: SITE_DOMAIN }),
        greeting: t("Common.greeting", { username: payload.data.username }),
        intro: t("EmailVerification.intro", { siteDomain: SITE_DOMAIN }),
        buttonLabel: t("EmailVerification.buttonLabel"),
        buttonUrl: verificationUrl,
        secondaryText: t("EmailVerification.secondaryText", { expirationHours }),
        fallbackText: t("EmailVerification.fallbackText", { siteDomain: SITE_DOMAIN }),
        footerText: t("Common.footerText", { siteDomain: SITE_DOMAIN }),
      });

      return {
        to: payload.to,
        subject: t("EmailVerification.subject", { siteDomain: SITE_DOMAIN }),
        html: emailTemplate.html,
        text: emailTemplate.text,
        type: payload.template,
      };
    }
    case EMAIL_TEMPLATE_TYPES.TEAM_INVITATION: {
      const inviteUrl = `${absoluteLocalizedUrl({ pathname: "/team-invite", locale })}?token=${payload.data.invitationToken}`;
      const emailTemplate = buildEmailTemplate({
        locale,
        title: t("TeamInvitation.title", { siteDomain: SITE_DOMAIN }),
        greeting: t("TeamInvitation.greeting"),
        intro: t("TeamInvitation.intro", {
          inviterName: payload.data.inviterName,
          teamName: payload.data.teamName,
          siteDomain: SITE_DOMAIN,
        }),
        buttonLabel: t("TeamInvitation.buttonLabel"),
        buttonUrl: inviteUrl,
        secondaryText: t("TeamInvitation.secondaryText", { recipientEmail: payload.to }),
        fallbackText: t("TeamInvitation.fallbackText"),
        footerText: t("Common.footerText", { siteDomain: SITE_DOMAIN }),
      });

      return {
        to: payload.to,
        subject: t("TeamInvitation.subject", { siteDomain: SITE_DOMAIN }),
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
  username,
  // Resolved by the caller via getUserLocale() when available (request-scoped);
  // the queue consumer has no request context, so it can't resolve this itself.
  locale = DEFAULT_LOCALE,
}: {
  email: string;
  resetToken: string;
  username: string;
  locale?: Locale;
}) {
  const resetUrl = `${absoluteLocalizedUrl({ pathname: "/reset-password", locale })}?token=${resetToken}`;

  if (!isProd) {
    console.warn('\n\n\nPassword reset url: ', resetUrl)

    return
  }

  await queueTransactionalEmail({
    to: email,
    template: EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
    locale,
    data: {
      resetToken,
      username,
    },
  });
}

export async function sendVerificationEmail({
  email,
  verificationToken,
  username,
  // Resolved by the caller via getUserLocale() when available (request-scoped);
  // the queue consumer has no request context, so it can't resolve this itself.
  locale = DEFAULT_LOCALE,
}: {
  email: string;
  verificationToken: string;
  username: string;
  locale?: Locale;
}) {
  const verificationUrl = `${absoluteLocalizedUrl({ pathname: "/verify-email", locale })}?token=${verificationToken}`;

  if (!isProd) {
    console.warn('\n\n\nVerification url: ', verificationUrl)

    return
  }

  await queueTransactionalEmail({
    to: email,
    template: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
    locale,
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
  inviterName,
  // The recipient may not be a user yet (non-user invite), so we use the
  // inviter's locale instead, resolved by the caller via getUserLocale().
  locale = DEFAULT_LOCALE,
}: {
  email: string;
  invitationToken: string;
  teamName: string;
  inviterName: string;
  locale?: Locale;
}) {
  const inviteUrl = `${absoluteLocalizedUrl({ pathname: "/team-invite", locale })}?token=${invitationToken}`;

  if (!isProd) {
    console.warn('\n\n\nTeam invitation url: ', inviteUrl)
    return
  }

  await queueTransactionalEmail({
    to: email,
    template: EMAIL_TEMPLATE_TYPES.TEAM_INVITATION,
    locale,
    data: {
      invitationToken,
      inviterName,
      teamName,
    },
  });
}
