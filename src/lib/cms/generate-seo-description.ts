import "server-only";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import type { CollectionsUnion } from "@/../cms.config";
import { SITE_NAME, SITE_URL, CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";
import { DEFAULT_LOCALE, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { MESSAGE_CATALOGS } from "@/i18n/message-catalogs";
import type { JSONContent } from "@tiptap/core";
import { extractTextFromContent } from "@/lib/cms/extract-text-from-content";
import { runAiText } from "@/lib/ai/generate-text";
import { truncateSeoDescription } from "@/lib/cms/seo-description";

// AI prompt context should be deterministic, so read the site description from the
// default-locale catalog instead of the request locale.
const SITE_SEO_DESCRIPTION = MESSAGE_CATALOGS[DEFAULT_LOCALE].Client.Landing.meta.description;

type GenerateSeoDescriptionParams = {
  title: string;
  content: JSONContent;
  collectionSlug: CollectionsUnion;
  locale?: Locale;
};

export async function generateSeoDescription({
  title,
  content,
  collectionSlug,
  locale = DEFAULT_LOCALE,
}: GenerateSeoDescriptionParams): Promise<string | null> {
  try {
    const { env } = await getCloudflareContext();
    const AI = env.AI;

    if (!AI) {
      return null;
    }

    // Extract plain text from TipTap JSON content
    const plainText = extractTextFromContent(content);

    // Extract first 1000 characters for context
    // This gives the AI enough context while staying within token limits
    const contentPreview = plainText.slice(0, 1000).trim();

    const languageName = LOCALE_LABELS[locale];

    const prompt = `Generate a concise SEO meta description (maximum ${CMS_SEO_DESCRIPTION_MAX_LENGTH} characters) for a ${collectionSlug} entry with the following title and content preview:

Title: "${title}"
Website Name: "${SITE_NAME}"
Website URL: "${SITE_URL}"
Website SEO Description: "${SITE_SEO_DESCRIPTION}"

Content Preview:
\`\`\`markdown
${contentPreview}
\`\`\`

The description should be:
- Written in ${languageName} (locale "${locale}"), matching the language of the content
- Compelling and informative
- Include relevant keywords naturally
- Exactly ${CMS_SEO_DESCRIPTION_MAX_LENGTH} characters or less
- Written in a way that encourages clicks
- Appropriate for a ${collectionSlug} entry

Return only the description text, no quotes or additional text.`;

    const response = await runAiText({ AI, prompt, maxTokens: 100 });

    if (!response) {
      return null;
    }

    // Clean up the response and ensure it's max ${CMS_SEO_DESCRIPTION_MAX_LENGTH} characters
    let description = response.trim();

    // Remove quotes if present
    description = description.replace(/^["']|["']$/g, "");

    return truncateSeoDescription(description) || null;
  } catch (error) {
    console.error("Error generating SEO description:", error);
    return null;
  }
}
