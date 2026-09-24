"use client";

// The one client-side translation seam. Every client component reads its hooks here, so
// `project/client-translations-under-client-namespace` can track the binding from one module.
export { useFormatter, useLocale, useTranslations } from "use-intl/react";
