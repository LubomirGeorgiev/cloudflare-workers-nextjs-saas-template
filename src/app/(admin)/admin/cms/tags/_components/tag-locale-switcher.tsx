"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { createTagTranslationAction } from "../../../_actions/cms-tag-actions";
import { CmsTranslationSwitcher } from "../../_components/cms-translation-switcher";
import { LOCALE_LABELS, type Locale } from "@/i18n/config";
import type { CmsTagLocaleSibling } from "@/lib/cms/tags";

// Tag-editor translations panel: shows every enabled locale for this tag's slug group — the one being
// edited, links to existing sibling translations, and create-buttons for the missing ones (AI-assisted).
// Mirrors the entry editor's CmsEntryLocaleSwitcher; both render the shared CmsTranslationSwitcher shell.
export function TagLocaleSwitcher({
  slug,
  currentLocale,
  siblings,
}: {
  slug: string;
  currentLocale: Locale;
  siblings: CmsTagLocaleSibling[];
}) {
  const router = useRouter();
  const [aiEnabled, setAiEnabled] = useState(true);
  const toastIdRef = useRef<string | number | undefined>(undefined);

  const { execute, isExecuting } = useAction(createTagTranslationAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to create translation", {
        id: toastIdRef.current,
      });
    },
    onSuccess: ({ data }) => {
      if (!data) {
        return;
      }
      if (aiEnabled && !data.aiTranslated) {
        toast.warning("Created as a copy — AI translation was unavailable. Translate it manually.", {
          id: toastIdRef.current,
        });
      } else {
        toast.success(aiEnabled ? "Translation created with AI" : "Translation created", {
          id: toastIdRef.current,
        });
      }
      router.push(`/admin/cms/tags/${data.id}`);
    },
  });

  const handleCreate = (targetLocale: Locale) => {
    toastIdRef.current = toast.loading(
      aiEnabled
        ? `Translating to ${LOCALE_LABELS[targetLocale]}…`
        : "Creating translation…"
    );
    execute({ slug, sourceLocale: currentLocale, targetLocale, autoTranslate: aiEnabled });
  };

  return (
    <CmsTranslationSwitcher
      currentLocale={currentLocale}
      siblings={siblings}
      hrefForSibling={(sibling) => `/admin/cms/tags/${sibling.id}`}
      onCreate={handleCreate}
      isExecuting={isExecuting}
      aiEnabled={aiEnabled}
      onAiEnabledChange={setAiEnabled}
    />
  );
}
