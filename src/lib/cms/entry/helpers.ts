import "server-only";

import { eq } from "drizzle-orm";

import { cmsConfig } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";
import { cmsEntryTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { getCmsImagePublicUrl } from "@/lib/cms/cms-images";
import type { CmsIncludeRelations } from "@/lib/cms/cms-cache-invalidation";
import type { GetCmsCollectionResult } from "@/lib/cms/entry/types";
import {
  CMS_STATUS_FILTER_ALL,
  type CmsEntryStatus,
  type CmsStatusFilter,
} from "@/types/cms";
import { v } from "@/lib/validation";

export function buildStatusWhereCondition(status: CmsStatusFilter) {
  if (status === CMS_STATUS_FILTER_ALL) {
    return undefined;
  }

  return eq(cmsEntryTable.status, status);
}

export function validateEntryFields(
  fields: unknown,
  collection: typeof cmsConfig.collections[keyof typeof cmsConfig.collections]
): unknown {
  if (!("fieldsSchema" in collection) || !collection.fieldsSchema) {
    return fields;
  }

  const parseResult = v.safeParse(collection.fieldsSchema, fields);
  if (!parseResult.success) {
    throw new ActionError(
      "INPUT_PARSE_ERROR",
      `Invalid fields: ${parseResult.issues.map(formatValibotIssue).join(", ")}`
    );
  }

  return parseResult.output;
}

function formatValibotIssue(issue: { path?: Array<{ key: unknown }>; message: string }): string {
  const path = issue.path?.map((item) => item.key).join(".");

  return path ? `${path}: ${issue.message}` : issue.message;
}

export function validateSeoDescription(seoDescription: string | null | undefined): void {
  if (seoDescription && seoDescription.length > CMS_SEO_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`SEO description exceeds maximum length of ${CMS_SEO_DESCRIPTION_MAX_LENGTH} characters (got ${seoDescription.length})`);
  }
}

export function handlePublishedAt(
  status: CmsEntryStatus,
  publishedAt: Date | undefined,
  existingPublishedAt?: Date | null
): Date | undefined {
  if (status === CMS_ENTRY_STATUS.PUBLISHED && !publishedAt && !existingPublishedAt) {
    // Auto-set publishedAt to now for published entries
    return new Date();
  }

  if (status === CMS_ENTRY_STATUS.SCHEDULED) {
    // Validate that scheduled entries have a future publishedAt date
    if (!publishedAt) {
      throw new Error("publishedAt is required for scheduled entries");
    }
    if (publishedAt <= new Date()) {
      throw new Error("publishedAt must be in the future for scheduled entries");
    }
  }

  return publishedAt;
}

export function serializeCmsIncludeRelations(includeRelations?: CmsIncludeRelations): string {
  return JSON.stringify(includeRelations ?? null);
}

export function deserializeCmsIncludeRelations(value: string): CmsIncludeRelations | undefined {
  return JSON.parse(value) ?? undefined;
}

export function buildCmsRelationsQuery(includeRelations?: CmsIncludeRelations) {
  // oxlint-disable-next-line typescript/no-explicit-any
  const relations = {} as Record<string, any>;

  if (includeRelations?.createdByUser) {
    relations.createdByUser = {
      columns: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
      },
    };
  }

  if (includeRelations?.media) {
    relations.entryMedia = {
      // oxlint-disable-next-line typescript/no-explicit-any
      orderBy: (fields: any, { asc }: any) => [asc(fields.position)],
      with: {
        media: true,
      },
    };
  }

  if (includeRelations?.tags) {
    relations.tags = {
      with: {
        tag: true,
      },
    };
  }

  // Always include featured image if present
  relations.featuredImage = true;

  return relations;
}

export function withFeaturedImageUrl(entry: GetCmsCollectionResult): GetCmsCollectionResult {
  if (entry.featuredImage?.bucketKey) {
    entry.featuredImageUrl = getCmsImagePublicUrl(entry.featuredImage.bucketKey);
  }

  return entry;
}
