import type { TranslatorNamespace } from "./translator";

type StripClientPrefix<Namespace> = Namespace extends `Client.${infer Path}` ? Path : never;

/** A namespace path under `Client` — the argument a client component passes to `useTranslations`, minus that prefix. */
export type ClientNamespace = StripClientPrefix<Extract<TranslatorNamespace, `Client.${string}`>>;

interface ClientMessageScope {
  /** Files and directories, relative to `src/`, whose render tree this provider wraps. */
  entryPaths: readonly string[];
  /** Namespaces the provider serializes. A parent path also covers its children. */
  namespaces: readonly ClientNamespace[];
}

// One entry per `NextIntlClientProvider` in the tree. A nested provider REPLACES its parent's
// messages rather than merging them, so each list must cover its whole subtree on its own.
// `client-namespaces.test.ts` walks the import graph from each `entryPaths` and fails when a list
// misses a namespace the subtree reads, or carries one it does not.
export const CLIENT_MESSAGE_SCOPES = {
  // The root shell's own chrome — the toaster, the top loader, the verification dialog. Route
  // groups nest their own provider below it, so page copy never belongs here.
  root: {
    entryPaths: ["components/root-shell.tsx", "app/[locale]/layout.tsx"],
    namespaces: ["AskiChatBanner", "Auth.EmailVerificationDialog"],
  },
  marketing: {
    entryPaths: ["app/[locale]/(marketing)"],
    namespaces: [
      "Common",
      "Landing.Cta",
      "Landing.DeployTerminal",
      "LocaleSwitcher",
      "Nav",
      "ThemeSwitch",
    ],
  },
  blog: {
    entryPaths: ["app/[locale]/(marketing)/blog"],
    namespaces: ["Blog.PostNotFound"],
  },
  docs: {
    entryPaths: ["app/[locale]/(marketing)/docs"],
    namespaces: [
      "Common",
      "Docs.ApiReference",
      "Docs.MarkdownButton",
      "Docs.Navigation",
      "Docs.Search",
      "Mcp",
    ],
  },
  auth: {
    entryPaths: ["app/[locale]/(auth)"],
    namespaces: [
      "Auth.Common",
      "Auth.ForgotPassword",
      "Auth.GoogleCallback",
      "Auth.ResetPassword",
      "Auth.SignIn",
      "Auth.SignUp",
      "Auth.TeamInvite",
      "Auth.VerifyEmail",
      "LocaleSwitcher",
      "Nav",
      "ThemeSwitch",
      "Validation",
    ],
  },
  legal: {
    entryPaths: ["app/[locale]/(legal)"],
    namespaces: ["LocaleSwitcher", "Nav", "ThemeSwitch"],
  },
  app: {
    entryPaths: ["app/[locale]/(app)"],
    namespaces: [
      "Admin.OAuthApps",
      "Admin.UserDetail",
      "ApiScopeSummary",
      "ApiScopes",
      "Common",
      "Dashboard.Billing",
      "Dashboard.Teams",
      "Errors",
      "Mcp",
      "OAuth",
      "RestApi",
      "Settings.ApiKeys",
      "Settings.ConnectedApps",
      "Settings.Device",
      "Settings.Language",
      "Settings.Nav",
      "Settings.Profile",
      "Settings.Security",
      "Settings.Sessions",
      "Sidebar",
      "ThemeSwitch",
      "Validation",
    ],
  },
} as const satisfies Record<string, ClientMessageScope>;
