"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { createTranslationAction } from "../../../_actions/cms-entry-actions";
import { CmsTranslationSwitcher } from "../../_components/cms-translation-switcher";
import { LOCALE_LABELS, type Locale } from "@/i18n/config";
import type { CmsEntryLocaleSibling } from "@/lib/cms/entry";
import type { CollectionsUnion } from "@/../cms.config";

// Editor-header switcher: shows every enabled locale for this entry's (collection, slug) group — the one
// being edited, links to existing siblings, and create-buttons for the missing ones. Lets an admin see
// coverage and add a locale without leaving the entry (mirrors the table's globe menu).
export function CmsEntryLocaleSwitcher({
  collection,
  slug,
  currentLocale,
  siblings,
}: {
  collection: CollectionsUnion;
  slug: string;
  currentLocale: Locale;
  siblings: CmsEntryLocaleSibling[];
}) {
  const router = useRouter();
  const [aiEnabled, setAiEnabled] = useState(true);
  const toastIdRef = useRef<string | number | undefined>(undefined);

  const { execute, isExecuting } = useAction(createTranslationAction, {
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
      router.push(`/admin/cms/${collection}/${data.id}`);
    },
  });

  const handleCreate = (targetLocale: Locale) => {
    toastIdRef.current = toast.loading(
      aiEnabled
        ? `Translating to ${LOCALE_LABELS[targetLocale]}…`
        : "Creating translation…"
    );
    execute({ collection, slug, sourceLocale: currentLocale, targetLocale, autoTranslate: aiEnabled });
  };

  return (
    <CmsTranslationSwitcher
      currentLocale={currentLocale}
      siblings={siblings}
      hrefForSibling={(sibling) => `/admin/cms/${collection}/${sibling.id}`}
      onCreate={handleCreate}
      isExecuting={isExecuting}
      aiEnabled={aiEnabled}
      onAiEnabledChange={setAiEnabled}
    />
  );
}
