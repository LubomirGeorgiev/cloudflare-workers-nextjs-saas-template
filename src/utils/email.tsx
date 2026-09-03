import "server-only";

import { createTranslator } from "next-intl";

import {
  EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS,
  SITE_DOMAIN,
  SITE_NAME,
} from "@/constants";
import { EMAIL_LOGO_IMAGE } from "@/constants/logo-url";
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
import { isLocalhost } from "./is-local";

// The ban and unban notices are deliberately English only, and are the one documented exception
// to "customer-facing email goes through next-intl with a row in every locale catalog".
//
// The reason a staff member types is free English text. Wrapping English staff prose in
// translated chrome produces a half-translated email, and staff cannot review copy they cannot
// read. So the whole message is English, with no catalog rows. Do not "fix" this.
//
// A literal, not DEFAULT_LOCALE: a fork can change its default locale, and this copy stays
// English either way.
const BAN_EMAIL_LOCALE = "en";

// "Contact support", never "reply to this email": the reply-to header is only set when
// EMAIL_REPLY_TO is configured, and the copy has to read correctly when it is not.
const BAN_NOTICE_COPY = {
  title: `Your ${SITE_NAME} account has been suspended`,
  intro:
    `Your ${SITE_NAME} account has been suspended. You can no longer sign in, and the API keys ` +
    "and connected applications on your account have been revoked.",
  subscriptionCancelled: "Any active subscription on the teams you own has been cancelled.",
  secondary: `If you believe this is a mistake, contact ${SITE_DOMAIN} support.`,
  footer: `This is an automated message from ${SITE_DOMAIN}.`,
} as const;

const UNBAN_NOTICE_COPY = {
  title: `Your ${SITE_NAME} account has been restored`,
  intro: `Your ${SITE_NAME} account has been restored. You can sign in again.`,
  // The point of this email: what did NOT come back. Without it the recipient returns to an
  // account whose integrations are dead and whose team quietly dropped to the free plan.
  notRestored:
    "Some things were not restored automatically: the API keys and connected applications on " +
    "your account were revoked and must be created again.",
  subscriptionCancelled:
    "Any subscription on the teams you own was cancelled and must be set up again.",
  secondary: `If you have any questions, contact ${SITE_DOMAIN} support.`,
  footer: `This is an automated message from ${SITE_DOMAIN}.`,
} as const;

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

// Local delivery for every transactional email. The EMAIL binding is `remote: true`, so a queued
// message leaves the developer machine and reaches a real inbox — from `pnpm preview` too, which
// builds as production.
function logTransactionalEmail({ to, subject, text, html, type }: TransactionalEmailOptions): void {
  console.warn([
    `\n\n=== ${type} email - logged, not sent (localhost) ===`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "",
    text ?? html ?? "",
    "=== end of email ===\n",
  ].join("\n"));
}

async function queueTransactionalEmail(payload: EmailSendJobPayload): Promise<void> {
  // The one gate every sender below passes through, so no template can miss it.
  if (isLocalhost) {
    logTransactionalEmail(await renderTransactionalEmail(payload));

    return;
  }

  const { env } = await getCloudflareContext();

  await env.SCHEDULER_QUEUE.send(createScheduledQueueMessage({
    type: SCHEDULED_JOB_TYPES.EMAIL_SEND,
    payload,
    runAt: new Date(),
  }));
}

/** The call to action, grouped so a notice with nothing to click can omit all three at once. */
interface EmailCallToAction {
  label: string;
  url: string;
  /** The "button not working?" line printed above the raw URL. */
  fallbackText: string;
}

function buildEmailTemplate({
  locale,
  title,
  greeting,
  intro,
  details,
  cta,
  secondaryText,
  footerText,
}: {
  /** The `<html lang>` value. A fixed-language template passes its own literal, not the default. */
  locale: string;
  title: string;
  greeting: string;
  intro: string;
  /** An indented quoted block between the intro and the secondary text; omitted when absent. */
  details?: string;
  /** Omitted for a notice with no action — no button, no fallback line, no raw URL. */
  cta?: EmailCallToAction;
  secondaryText: string;
  footerText: string;
}): EmailTemplate {
  const escapedTitle = escapeHtml(title);
  const escapedGreeting = escapeHtml(greeting);
  const escapedIntro = escapeHtml(intro);
  const escapedSecondaryText = escapeHtml(secondaryText);
  const escapedFooterText = escapeHtml(footerText);
  // Alt text, not a translated string: the product name is the same in every locale, so it needs
  // no catalog row, and it is what the reader sees while remote images are still blocked.
  const escapedSiteName = escapeHtml(SITE_NAME);

  // Every field goes through `escapeHtml` here and nowhere else, which is what makes an
  // admin-typed reason safe to render: there is one place that builds the markup.
  const detailsHtml = details
    ? `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #e6ebf1;background-color:#f6f9fc;font-size:16px;line-height:24px;">${escapeHtml(details)}</blockquote>`
    : "";
  const ctaHtml = cta
    ? `<div style="margin:30px 0;text-align:center;">
        <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 40px;border-radius:5px;background-color:#000000;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">${escapeHtml(cta.label)}</a>
      </div>`
    : "";
  const ctaFallbackHtml = cta
    ? `<p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapeHtml(cta.fallbackText)}</p>
      <p style="margin:16px 0 30px;font-size:14px;line-height:22px;text-align:center;word-break:break-all;color:#556cd6;text-decoration:underline;">${escapeHtml(cta.url)}</p>`
    : "";

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
        <img src="${escapeHtml(EMAIL_LOGO_IMAGE.url)}" width="${EMAIL_LOGO_IMAGE.width}" height="${EMAIL_LOGO_IMAGE.height}" alt="${escapedSiteName}" style="display:inline-block;border:0;outline:none;text-decoration:none;" />
      </div>
      <h1 style="margin:0 0 30px;font-size:18px;line-height:1.5;text-align:center;color:#525f7f;">${escapedTitle}</h1>
      <p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapedGreeting}</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapedIntro}</p>
      ${detailsHtml}
      ${ctaHtml}
      <p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapedSecondaryText}</p>
      ${ctaFallbackHtml}
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
      ...(details ? ["", details] : []),
      ...(cta ? ["", `${cta.label}: ${cta.url}`] : []),
      "",
      secondaryText,
      ...(cta ? ["", cta.fallbackText] : []),
      "",
      footerText,
    ].join("\n"),
  };
}

export async function renderTransactionalEmail(
  payload: EmailSendJobPayload,
): Promise<TransactionalEmailOptions> {
  // Resolved per case, not once above the switch: the ban and unban notices are fixed English
  // and carry no `locale` field at all, so loading a message catalog for them would be dead work
  // and would force a field onto their payloads purely to satisfy this call.
  switch (payload.template) {
    case EMAIL_TEMPLATE_TYPES.PASSWORD_RESET: {
      const { locale, t } = await getEmailTranslator(payload.locale);
      const resetUrl = `${absoluteLocalizedUrl({ pathname: "/reset-password", locale })}?token=${payload.data.resetToken}`;
      const emailTemplate = buildEmailTemplate({
        locale,
        title: t("PasswordReset.title", { siteDomain: SITE_DOMAIN }),
        greeting: t("Common.greeting", { username: payload.data.username }),
        intro: t("PasswordReset.intro", { siteDomain: SITE_DOMAIN }),
        cta: {
          label: t("PasswordReset.buttonLabel"),
          url: resetUrl,
          fallbackText: t("Common.fallbackText"),
        },
        secondaryText: t("PasswordReset.secondaryText", { siteDomain: SITE_DOMAIN }),
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
      const { locale, t } = await getEmailTranslator(payload.locale);
      const verificationUrl = `${absoluteLocalizedUrl({ pathname: "/verify-email", locale })}?token=${payload.data.verificationToken}`;
      const expirationHours = EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS / 60 / 60;
      const emailTemplate = buildEmailTemplate({
        locale,
        title: t("EmailVerification.title", { siteDomain: SITE_DOMAIN }),
        greeting: t("Common.greeting", { username: payload.data.username }),
        intro: t("EmailVerification.intro", { siteDomain: SITE_DOMAIN }),
        cta: {
          label: t("EmailVerification.buttonLabel"),
          url: verificationUrl,
          fallbackText: t("EmailVerification.fallbackText", { siteDomain: SITE_DOMAIN }),
        },
        secondaryText: t("EmailVerification.secondaryText", { expirationHours }),
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
      const { locale, t } = await getEmailTranslator(payload.locale);
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
        cta: {
          label: t("TeamInvitation.buttonLabel"),
          url: inviteUrl,
          fallbackText: t("TeamInvitation.fallbackText"),
        },
        secondaryText: t("TeamInvitation.secondaryText", { recipientEmail: payload.to }),
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
    case EMAIL_TEMPLATE_TYPES.BAN_NOTICE: {
      // No `cta`, by design: there is nothing a suspended account should be invited to click, and
      // a large black call-to-action button is the wrong tone for a suspension notice.
      const emailTemplate = buildEmailTemplate({
        locale: BAN_EMAIL_LOCALE,
        title: BAN_NOTICE_COPY.title,
        greeting: `Hi ${payload.data.username},`,
        intro: payload.data.subscriptionCancelled
          ? `${BAN_NOTICE_COPY.intro} ${BAN_NOTICE_COPY.subscriptionCancelled}`
          : BAN_NOTICE_COPY.intro,
        details: payload.data.externalReason
          ? `Reason: ${payload.data.externalReason}`
          : undefined,
        secondaryText: BAN_NOTICE_COPY.secondary,
        footerText: BAN_NOTICE_COPY.footer,
      });

      return {
        to: payload.to,
        subject: BAN_NOTICE_COPY.title,
        html: emailTemplate.html,
        text: emailTemplate.text,
        type: payload.template,
      };
    }
    case EMAIL_TEMPLATE_TYPES.UNBAN_NOTICE: {
      const notRestored = payload.data.cancelledSubscriptionCount > 0
        ? `${UNBAN_NOTICE_COPY.notRestored} ${UNBAN_NOTICE_COPY.subscriptionCancelled}`
        : UNBAN_NOTICE_COPY.notRestored;

      const emailTemplate = buildEmailTemplate({
        locale: BAN_EMAIL_LOCALE,
        title: UNBAN_NOTICE_COPY.title,
        greeting: `Hi ${payload.data.username},`,
        intro: payload.data.externalReason
          ? `${UNBAN_NOTICE_COPY.intro} ${payload.data.externalReason}`
          : UNBAN_NOTICE_COPY.intro,
        details: notRestored,
        secondaryText: UNBAN_NOTICE_COPY.secondary,
        footerText: UNBAN_NOTICE_COPY.footer,
      });

      return {
        to: payload.to,
        subject: UNBAN_NOTICE_COPY.title,
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

export async function sendBanNoticeEmail({
  email,
  username,
  externalReason,
  subscriptionCancelled,
}: {
  email: string;
  username: string;
  /** Staff-written, sent verbatim. Absent = the notice carries no reason block. */
  externalReason?: string;
  subscriptionCancelled: boolean;
}): Promise<void> {
  await queueTransactionalEmail({
    to: email,
    template: EMAIL_TEMPLATE_TYPES.BAN_NOTICE,
    data: { username, externalReason, subscriptionCancelled },
  });
}

export async function sendUnbanNoticeEmail({
  email,
  username,
  externalReason,
  cancelledSubscriptionCount,
}: {
  email: string;
  username: string;
  externalReason?: string;
  cancelledSubscriptionCount: number;
}): Promise<void> {
  await queueTransactionalEmail({
    to: email,
    template: EMAIL_TEMPLATE_TYPES.UNBAN_NOTICE,
    data: { username, externalReason, cancelledSubscriptionCount },
  });
}
