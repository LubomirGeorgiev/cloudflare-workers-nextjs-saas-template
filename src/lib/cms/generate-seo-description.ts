import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { CollectionsUnion } from "@/../cms.config";
import { CMS_SEO_DESCRIPTION_AI_MODEL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/constants";

type GenerateSeoDescriptionParams = {
  title: string;
  htmlContent: string;
  collectionSlug: CollectionsUnion;
};

/**
 * Generate an SEO description using Cloudflare AI based on the entry's title and HTML content
 *
 * @param params - Object containing title, htmlContent, and collectionSlug
 * @returns A generated SEO description (max 160 characters) or null if AI is not available
 */
export async function generateSeoDescription({
  title,
  htmlContent,
  collectionSlug,
}: GenerateSeoDescriptionParams): Promise<string | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const AI = env.AI;

    if (!AI) {
      return null;
    }

    // Extract first 1000 characters of HTML content for context
    // This gives the AI enough context while staying within token limits
    const contentPreview = htmlContent.slice(0, 1000).trim();

    const prompt = `Generate a concise SEO meta description (maximum 160 characters) for a ${collectionSlug} entry with the following title and HTML content preview:

Title: "${title}"
Website Name: "${SITE_NAME}"
Website URL: "${SITE_URL}"
Website SEO Description: "${SITE_DESCRIPTION}"

HTML Content Preview:
\`\`\`html
${contentPreview}
\`\`\`

The description should be:
- Compelling and informative
- Include relevant keywords naturally
- Exactly 160 characters or less
- Written in a way that encourages clicks
- Appropriate for a ${collectionSlug} entry

Return only the description text, no quotes or additional text.`;

    const result = await AI.run(CMS_SEO_DESCRIPTION_AI_MODEL, {
      prompt,
      max_tokens: 100,
    });

    if (!result || !result.response) {
      return null;
    }

    // Clean up the response and ensure it's max 160 characters
    let description = result.response.trim();

    // Remove quotes if present
    description = description.replace(/^["']|["']$/g, '');

    // Truncate to 160 characters if needed
    if (description.length > 160) {
      description = description.slice(0, 157) + '...';
    }

    return description || null;
  } catch (error) {
    console.error('Error generating SEO description:', error);
    return null;
  }
}
