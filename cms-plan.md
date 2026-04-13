# CMS Feature Plan - Lightweight Payload CMS Alternative

## Overview

Build a lightweight, modular CMS system for managing dynamic content collections (blog posts, docs, etc.) with:
- Configuration-driven setup via `cms.config.ts`
- Zod-based field validation
- JSON-based storage in D1 for maximum flexibility
- Built-in admin UI
- Team-based access control
- Type-safe API

## 1. Configuration Structure (`cms.config.ts`)

### Basic Structure

```typescript
import { z } from 'zod';
import { defineCollection, defineConfig } from './src/cms/config';

export const collections = {
  // Blog Posts Collection
  posts: defineCollection({
    slug: 'posts',
    labels: {
      singular: 'Post',
      plural: 'Posts',
    },
    fields: {
      // NOTE: 'content' is NOT defined here - it's always present in the cms_entries table
      // and stores TipTap/ProseMirror JSON for rich text editing
      title: z.string().min(1).max(200),
      slug: z.string().min(1).max(200),
      excerpt: z.string().max(500).optional(),
      published: z.boolean().default(false),
      author: z.string(), // Could be relationship to users
      tags: z.array(z.string()).default([]),
      featuredImage: z.string().optional(), // R2 URL
      seo: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        keywords: z.array(z.string()).optional(),
      }).optional(),
    },
    options: {
      slugField: 'slug', // Field to use for URL slugs
      titleField: 'title', // Field to display in lists
      enableVersions: true, // Track version history
      trash: true, // Enable soft deletes (move to trash instead of permanent delete)
      disableDuplicate: false, // Allow duplicating entries
    },
    admin: {
      description: 'Manage your blog posts and articles',
      defaultColumns: ['title', 'status', 'author'], // Columns to show in list view
      listSearchableFields: ['title', 'slug', 'content'], // Fields to search in list view
      hideAPIURL: false, // Show/hide API URL in admin
      useAsTitle: 'title', // Field to use as document title in admin
      group: 'Content', // Group collections in navigation
    },
    indexes: [
      // Define compound indexes for better query performance
      { fields: ['status'], unique: false },
      { fields: ['author', 'status'], unique: false },
    ],
    hooks: {
      beforeCreate: async (data) => {
        // Auto-generate slug from title if not provided
        if (!data.slug && data.title) {
          data.slug = generateSlug(data.title);
        }
        return data;
      },
      beforeUpdate: async (data, existing) => {
        // Custom validation or transformations
        return data;
      },
    },
  }),

  // Documentation Collection
  docs: defineCollection({
    slug: 'docs',
    labels: {
      singular: 'Doc',
      plural: 'Docs',
    },
    fields: {
      // NOTE: 'content' is NOT defined here - it's always present in cms_entries
      title: z.string().min(1).max(200),
      slug: z.string().min(1).max(200),
      category: z.enum(['getting-started', 'guides', 'api-reference', 'tutorials']),
      published: z.boolean().default(false),
    },
    options: {
      slugField: 'slug',
      titleField: 'title',
    },
  }),
};

export default defineConfig({
  collections,
  storage: {
    type: 'd1',
    tableName: 'cms_entries', // Single table for all collections
  },
  media: {
    enabled: true,
    storage: 'r2', // Use Cloudflare R2
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  admin: {
    basePath: '/admin/cms',
    defaultPageSize: 20,
  },
});
```

### Key Configuration Features

1. **Type-safe field definitions** using Zod schemas
2. **Global admin-only access** - only users with global admin role can access the CMS
3. **Lifecycle hooks** for custom logic (beforeCreate, afterCreate, etc.)
4. **Collection metadata** (labels, slug field, title field)
5. **Automatic timestamps** - createdAt/updatedAt always added automatically
6. **Media management** with R2 integration
7. **Soft deletes (trash)** - move entries to trash instead of permanent deletion
8. **Duplicate functionality** - clone entries with one click
9. **Compound indexes** - define multi-field indexes for better performance
10. **Admin UI customization** - default columns, searchable fields, grouping, etc.
11. **Version history** - track changes over time

## 2. Database Schema Design

### Approach: JSON-Based Storage

Use a single flexible table with JSON columns to store all CMS content. This approach:
- Supports dynamic schemas defined in `cms.config.ts`
- Leverages D1/SQLite's excellent JSON support
- Simplifies migrations (no schema changes needed for field updates)
- Maintains good query performance for most use cases

### Schema Definition

```typescript
// src/db/schema.ts

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const cmsEntries = sqliteTable('cms_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // Collection identifier (e.g., 'posts', 'docs')
  collection: text('collection').notNull(),

  // Slug for URL routing (extracted from fields for indexing)
  slug: text('slug').notNull(),

  // Status: 'draft' | 'published' | 'archived'
  status: text('status').notNull().default('draft'),

  // Soft delete (trash) support
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  deletedBy: text('deleted_by').references(() => users.id),

  // Rich text content using TipTap editor (based on ProseMirror)
  // Stores TipTap/ProseMirror JSON schema - see https://tiptap.dev/docs/editor/core-concepts/schema
  // and https://prosemirror.net/docs/guide/#schema
  // This is ALWAYS present and separate from dynamic fields defined in defineCollection
  content: text('content', { mode: 'json' }).notNull(),

  // JSON field containing all OTHER dynamic content (defined by defineCollection)
  // The 'content' field above is NOT defined in defineCollection, it's always present
  fields: text('fields', { mode: 'json' }).notNull(),

  // Metadata - timestamps are ALWAYS added automatically
  createdBy: text('created_by').notNull().references(() => users.id),
  updatedBy: text('updated_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),

  // Published timestamp for scheduling
  publishedAt: integer('published_at', { mode: 'timestamp' }),

  // Version tracking
  version: integer('version').notNull().default(1),
}, (table) => ({
  // Indexes for common queries
  collectionIdx: index('cms_entries_collection_idx').on(table.collection),
  slugIdx: index('cms_entries_slug_idx').on(table.collection, table.slug),
  statusIdx: index('cms_entries_status_idx').on(table.status),
  collectionStatusIdx: index('cms_entries_collection_status_idx').on(table.collection, table.status),

  // Unique constraint for collection + slug (globally unique per collection)
  uniqueSlug: index('cms_entries_unique_slug').on(table.collection, table.slug),
}));

// Media/file uploads table
export const cmsMedia = sqliteTable('cms_media', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // File metadata
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(), // bytes

  // R2 storage
  r2Key: text('r2_key').notNull(),
  r2Bucket: text('NEXT_INC_CACHE_R2_BUCKET').notNull(),
  publicUrl: text('public_url').notNull(),

  // Image-specific metadata (if applicable)
  width: integer('width'),
  height: integer('height'),
  alt: text('alt'),

  // Metadata - timestamps are ALWAYS added automatically
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  r2KeyIdx: index('cms_media_r2_key_idx').on(table.r2Key),
  uploadedByIdx: index('cms_media_uploaded_by_idx').on(table.uploadedBy),
}));

// Version history for content (optional - for revision tracking)
export const cmsEntryVersions = sqliteTable('cms_entry_versions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  entryId: text('entry_id').notNull().references(() => cmsEntries.id, { onDelete: 'cascade' }),

  version: integer('version').notNull(),
  content: text('content', { mode: 'json' }).notNull(), // TipTap/ProseMirror JSON
  fields: text('fields', { mode: 'json' }).notNull(),

  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  entryIdx: index('cms_entry_versions_entry_idx').on(table.entryId),
  versionIdx: index('cms_entry_versions_version_idx').on(table.entryId, table.version),
}));
```

### Example Data Storage

```json
// Example row in cms_entries table
{
  "id": "cm1abc123",
  "collection": "posts",
  "slug": "my-first-blog-post",
  "status": "published",
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "This is the rich text content in TipTap/ProseMirror format..."
          }
        ]
      },
      {
        "type": "heading",
        "attrs": {
          "level": 2
        },
        "content": [
          {
            "type": "text",
            "text": "A heading example"
          }
        ]
      }
    ]
  },
  "fields": {
    "title": "My First Blog Post",
    "slug": "my-first-blog-post",
    "excerpt": "A short excerpt",
    "published": true,
    "author": "user_123",
    "tags": ["nextjs", "cloudflare"],
    "featuredImage": "https://r2.example.com/image.jpg",
    "seo": {
      "title": "My First Blog Post - SEO Title",
      "description": "SEO description here",
      "keywords": ["blog", "post"]
    }
  },
  "createdBy": "user_123",
  "updatedBy": "user_123",
  "createdAt": 1705315200,
  "updatedAt": 1705315200,
  "publishedAt": 1705315200,
  "version": 1
}
```

### Benefits of This Approach

1. **Schema flexibility**: Add/remove fields without migrations
2. **Simple queries**: Standard SQL for filtering by collection, status, etc.
3. **JSON queries**: D1 supports JSON path queries for filtering by field values
4. **Performance**: Indexes on common access patterns
5. **Global CMS**: No multi-tenancy complexity, global admin access only
6. **Audit trail**: Track who created/updated content with automatic timestamps
7. **Versioning**: Optional revision history
8. **Lightweight**: Single table for all collections with JSON storage

## 3. Core CMS Modules

### File Structure

```
src/cms/
   config.ts              # Config helper functions (defineCollection, defineConfig)
   types.ts               # TypeScript types for CMS
   db.ts                  # Database operations
   validation.ts          # Zod schema validation
   hooks.ts               # Hook execution logic
   access-control.ts      # Permission checking
   media.ts               # Media upload/management
   api/                   # Server actions
      entries.action.ts  # CRUD operations for entries
      media.action.ts    # Media upload/delete
      collections.action.ts # Get collection config
   components/            # Admin UI components
       CollectionList.tsx
       EntryEditor.tsx
       FieldRenderer.tsx  # Render fields based on Zod type
       MediaLibrary.tsx
       RichTextEditor.tsx
```

### 3.1 Config Helpers (`src/cms/config.ts`)

```typescript
import { z } from 'zod';

export type CollectionHooks<T> = {
  beforeCreate?: (data: T) => Promise<T> | T;
  afterCreate?: (data: T) => Promise<void> | void;
  beforeUpdate?: (data: T, existing: T) => Promise<T> | T;
  afterUpdate?: (data: T, existing: T) => Promise<void> | void;
  beforeDelete?: (data: T) => Promise<boolean> | boolean;
  afterDelete?: (data: T) => Promise<void> | void;
};

export type CollectionOptions = {
  slugField?: string; // Field to use for URL slugs
  titleField?: string; // Field to display in admin list views
  enableVersions?: boolean; // Track version history
  trash?: boolean; // Enable soft deletes (move to trash instead of permanent delete)
  disableDuplicate?: boolean; // Disable duplicate functionality
  // Note: timestamps are ALWAYS added automatically (createdAt, updatedAt)
  // Note: CMS is global-only, no team scoping
};

export type CollectionAdminOptions = {
  description?: string; // Description shown in list view
  defaultColumns?: string[]; // Columns to show by default in list view
  listSearchableFields?: string[]; // Fields to search in list view
  hideAPIURL?: boolean; // Hide API URL in admin UI
  useAsTitle?: string; // Field to use as document title
  group?: string | false; // Group in navigation (false to hide from nav)
  hidden?: boolean | ((user: any) => boolean); // Hide from navigation entirely
};

export type CollectionIndex = {
  fields: string[]; // Fields to index together
  unique?: boolean; // Whether the index should enforce uniqueness
};

export type Collection<T extends z.ZodRawShape> = {
  slug: string;
  labels: {
    singular: string;
    plural: string;
  };
  fields: T;
  options?: CollectionOptions;
  admin?: CollectionAdminOptions;
  indexes?: CollectionIndex[];
  hooks?: CollectionHooks<z.infer<z.ZodObject<T>>>;
  // Note: No access control config needed - only global admins can access CMS
};

export function defineCollection<T extends z.ZodRawShape>(
  config: Collection<T>
): Collection<T> {
  return config;
}

export type CMSConfig = {
  collections: Record<string, Collection<any>>;
  storage: {
    type: 'd1';
    tableName: string;
  };
  media?: {
    enabled: boolean;
    storage: 'r2';
    maxFileSize: number;
    allowedTypes: string[];
  };
  admin?: {
    basePath: string;
    defaultPageSize: number;
  };
};

export function defineConfig(config: CMSConfig): CMSConfig {
  return config;
}

// Type helper to extract field types from collection
export type InferCollectionType<T extends Collection<any>> =
  z.infer<z.ZodObject<T['fields']>>;
```

### 3.2 Database Operations (`src/cms/db.ts`)

```typescript
import { db } from '@/db/client';
import { cmsEntries, cmsMedia, cmsEntryVersions } from '@/db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export type CreateEntryInput = {
  collection: string;
  slug: string;
  content: Record<string, any>; // TipTap/ProseMirror JSON
  fields: Record<string, any>;
  status?: 'draft' | 'published' | 'archived';
  createdBy: string;
};

export type UpdateEntryInput = {
  id: string;
  content?: Record<string, any>; // TipTap/ProseMirror JSON
  fields?: Record<string, any>;
  status?: 'draft' | 'published' | 'archived';
  updatedBy: string;
};

export type QueryOptions = {
  collection: string;
  status?: 'draft' | 'published' | 'archived';
  limit?: number;
  offset?: number;
  includeDeleted?: boolean; // Include soft-deleted entries
};

// Create entry
export async function createEntry(input: CreateEntryInput) {
  const { env } = await getCloudflareContext();

  const entry = await db(env.DB)
    .insert(cmsEntries)
    .values({
      collection: input.collection,
      slug: input.slug,
      content: input.content, // TipTap/ProseMirror JSON
      fields: input.fields,
      status: input.status || 'draft',
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      publishedAt: input.status === 'published' ? new Date() : null,
      // timestamps (createdAt, updatedAt) are added automatically by DB defaults
    })
    .returning();

  return entry[0];
}

// Get entry by ID
export async function getEntryById(id: string) {
  const { env } = await getCloudflareContext();

  const entry = await db(env.DB)
    .select()
    .from(cmsEntries)
    .where(eq(cmsEntries.id, id))
    .limit(1);

  return entry[0] || null;
}

// Get entry by slug
export async function getEntryBySlug(collection: string, slug: string) {
  const { env } = await getCloudflareContext();

  const entry = await db(env.DB)
    .select()
    .from(cmsEntries)
    .where(
      and(
        eq(cmsEntries.collection, collection),
        eq(cmsEntries.slug, slug),
        // Exclude soft-deleted entries
        eq(cmsEntries.deletedAt, null)
      )
    )
    .limit(1);

  return entry[0] || null;
}

// Query entries
export async function queryEntries(options: QueryOptions) {
  const { env } = await getCloudflareContext();

  const conditions = [eq(cmsEntries.collection, options.collection)];

  // Filter by status
  if (options.status) {
    conditions.push(eq(cmsEntries.status, options.status));
  }

  // Exclude soft-deleted entries by default
  if (!options.includeDeleted) {
    conditions.push(eq(cmsEntries.deletedAt, null));
  }

  let query = db(env.DB)
    .select()
    .from(cmsEntries)
    .where(and(...conditions))
    .orderBy(desc(cmsEntries.createdAt)); // Always sort by newest first

  // Pagination
  if (options.limit) {
    query = query.limit(options.limit);
  }
  if (options.offset) {
    query = query.offset(options.offset);
  }

  return await query;
}

// Update entry
export async function updateEntry(input: UpdateEntryInput) {
  const { env } = await getCloudflareContext();

  const updates: any = {
    updatedBy: input.updatedBy,
    updatedAt: new Date(),
  };

  if (input.content) {
    updates.content = input.content; // TipTap/ProseMirror JSON
    updates.version = sql`version + 1`;
  }

  if (input.fields) {
    updates.fields = input.fields;
    updates.version = sql`version + 1`;
  }

  if (input.status) {
    updates.status = input.status;
    if (input.status === 'published' && !updates.publishedAt) {
      updates.publishedAt = new Date();
    }
  }

  const updated = await db(env.DB)
    .update(cmsEntries)
    .set(updates)
    .where(eq(cmsEntries.id, input.id))
    .returning();

  return updated[0];
}

// Delete entry
export async function deleteEntry(id: string) {
  const { env } = await getCloudflareContext();

  await db(env.DB)
    .delete(cmsEntries)
    .where(eq(cmsEntries.id, id));

  return true;
}

// Count entries
export async function countEntries(
  collection: string,
  status?: string,
  includeDeleted = false
) {
  const { env } = await getCloudflareContext();

  const conditions = [eq(cmsEntries.collection, collection)];

  if (status) {
    conditions.push(eq(cmsEntries.status, status));
  }

  // Exclude soft-deleted entries by default
  if (!includeDeleted) {
    conditions.push(eq(cmsEntries.deletedAt, null));
  }

  const result = await db(env.DB)
    .select({ count: sql<number>`count(*)` })
    .from(cmsEntries)
    .where(and(...conditions));

  return result[0].count;
}
```

### 3.3 Validation & Type Safety (`src/cms/validation.ts`)

```typescript
import { z } from 'zod';
import cmsConfig from '@/cms.config';

// Get Zod schema for a collection
export function getCollectionSchema(collectionSlug: string) {
  const collection = cmsConfig.collections[collectionSlug];
  if (!collection) {
    throw new Error(`Collection "${collectionSlug}" not found`);
  }

  return z.object(collection.fields);
}

// Validate entry data against collection schema
export function validateEntry(collectionSlug: string, data: unknown) {
  const schema = getCollectionSchema(collectionSlug);
  return schema.parse(data);
}

// Safe validation with error handling
export function safeValidateEntry(collectionSlug: string, data: unknown) {
  const schema = getCollectionSchema(collectionSlug);
  return schema.safeParse(data);
}

// Generate TypeScript types from config (build-time script)
export function generateTypes() {
  // This would be a build script that generates TypeScript types
  // from cms.config.ts for type-safe API usage

  // Example output:
  // export type Post = {
  //   title: string;
  //   slug: string;
  //   content: string;
  //   // ...
  // };
}
```

### 3.4 Access Control (`src/cms/auth.ts`)

Since the CMS is admin-only, access control is very simple - just check if the user is a global admin.

```typescript
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getCloudflareContext } from '@opennextjs/cloudflare';

// Check if user has global admin role
import { ROLES_ENUM } from '@/db/schema';

export async function isGlobalAdmin(userId: string): Promise<boolean> {
  const { env } = await getCloudflareContext();

  const user = await db(env.DB)
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user[0]?.role === ROLES_ENUM.ADMIN;
}

// Assert user is a global admin (throws if not)
export async function assertIsAdmin(userId: string | null) {
  if (!userId) {
    throw new Error('Unauthorized: No user session');
  }

  const isAdmin = await isGlobalAdmin(userId);
  if (!isAdmin) {
    throw new Error('Unauthorized: Only global admins can access the CMS');
  }
}
```

**Note**: You'll need to add a `role` column to your `users` table:

```typescript
// In src/db/schema.ts, add to users table:
role: text('role').notNull().default('user'), // 'admin' | 'user'
```

That's it! No collection-specific permissions, no complex access control - just a simple admin check.

## 4. Admin UI Implementation

### 4.1 Admin Routes Structure

```
src/app/(admin)/
   cms/
      layout.tsx                    # Admin layout with navigation
      page.tsx                      # Dashboard/overview
      [collection]/                 # Dynamic collection routes
         page.tsx                  # List entries
         new/
            page.tsx              # Create new entry
         [entryId]/
             page.tsx              # Edit entry
             versions/
                 page.tsx          # View version history
      media/
          page.tsx                  # Media library
```

### 4.2 Key Components

#### Collection List Component

```typescript
// src/cms/components/CollectionList.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Table } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export function CollectionList({
  collection,
  entries,
  totalCount
}: CollectionListProps) {
  const router = useRouter();
  const config = cmsConfig.collections[collection];

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{config.labels.plural}</h1>
        <Button onClick={() => router.push(`/admin/cms/${collection}/new`)}>
          Create {config.labels.singular}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{config.options?.titleField || 'Title'}</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>{entry.fields[config.options?.titleField || 'title']}</TableCell>
              <TableCell>
                <Badge>{entry.status}</Badge>
              </TableCell>
              <TableCell>{formatDate(entry.updatedAt)}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  onClick={() => router.push(`/admin/cms/${collection}/${entry.id}`)}
                >
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination component */}
    </div>
  );
}
```

#### Entry Editor Component

```typescript
// src/cms/components/EntryEditor.tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { FieldRenderer } from './FieldRenderer';
import { createEntryAction, updateEntryAction } from '@/cms/api/entries.action';

export function EntryEditor({
  collection,
  entry,
  mode = 'create'
}: EntryEditorProps) {
  const schema = getCollectionSchema(collection);
  const config = cmsConfig.collections[collection];

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: entry?.fields || {},
  });

  const onSubmit = async (data: any) => {
    if (mode === 'create') {
      await createEntryAction({ collection, fields: data });
    } else {
      await updateEntryAction({ id: entry.id, fields: data });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {Object.entries(config.fields).map(([fieldName, zodSchema]) => (
          <FieldRenderer
            key={fieldName}
            name={fieldName}
            schema={zodSchema}
            control={form.control}
          />
        ))}

        <div className="flex gap-4">
          <Button type="submit">Save</Button>
          <Button type="button" variant="outline" onClick={saveDraft}>
            Save as Draft
          </Button>
        </div>
      </form>
    </Form>
  );
}
```

#### Field Renderer (Auto-generate form fields from Zod)

```typescript
// src/cms/components/FieldRenderer.tsx
'use client';

import { Control } from 'react-hook-form';
import { z } from 'zod';
import { FormField, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { RichTextEditor } from './RichTextEditor';

export function FieldRenderer({ name, schema, control }: FieldRendererProps) {
  // Detect Zod type and render appropriate input
  const zodType = schema._def.typeName;

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{formatFieldLabel(name)}</FormLabel>
          <FormControl>
            {renderInput(zodType, field, schema)}
          </FormControl>
        </FormItem>
      )}
    />
  );
}

function renderInput(zodType: string, field: any, schema: z.ZodType) {
  // Detect rich text by field name or custom metadata
  if (field.name === 'content' || field.name.includes('html')) {
    return <RichTextEditor {...field} />;
  }

  switch (zodType) {
    case 'ZodString':
      const maxLength = (schema as any)._def.checks?.find(
        (c: any) => c.kind === 'max'
      )?.value;

      if (maxLength > 500) {
        return <Textarea {...field} />;
      }
      return <Input {...field} />;

    case 'ZodBoolean':
      return <Switch checked={field.value} onCheckedChange={field.onChange} />;

    case 'ZodNumber':
      return <Input type="number" {...field} />;

    case 'ZodDate':
      return <Input type="datetime-local" {...field} />;

    case 'ZodEnum':
      return (
        <Select value={field.value} onValueChange={field.onChange}>
          {/* Render enum options */}
        </Select>
      );

    case 'ZodArray':
      return <ArrayInput {...field} />;

    default:
      return <Input {...field} />;
  }
}
```

## 5. API Layer (Server Actions)

### 5.1 Entry CRUD Actions

```typescript
// src/cms/api/entries.action.ts
'use server';

import { z } from 'zod';
import { createServerAction } from 'zsa';
import { getSessionFromCookie } from '@/utils/auth';
import { assertIsAdmin } from '@/cms/auth';
import { validateEntry } from '@/cms/validation';
import {
  createEntry,
  updateEntry,
  deleteEntry,
  queryEntries,
  getEntryById
} from '@/cms/db';
import cmsConfig from '@/cms.config';

export const createEntryAction = createServerAction()
  .input(z.object({
    collection: z.string(),
    content: z.record(z.any()), // TipTap/ProseMirror JSON
    fields: z.record(z.any()),
    status: z.enum(['draft', 'published', 'archived']).optional(),
  }))
  .handler(async ({ input }) => {
    const { session } = await getSessionFromCookie();

    // Only global admins can access CMS
    await assertIsAdmin(session?.userId || null);

    // Validate fields against collection schema
    const validatedFields = validateEntry(input.collection, input.fields);

    // Execute hooks
    const config = cmsConfig.collections[input.collection];
    let finalFields = validatedFields;
    if (config.hooks?.beforeCreate) {
      finalFields = await config.hooks.beforeCreate(validatedFields);
    }

    // Extract slug for indexing
    const slug = finalFields[config.options?.slugField || 'slug'] as string;

    // Create entry
    const entry = await createEntry({
      collection: input.collection,
      slug,
      content: input.content, // TipTap/ProseMirror JSON - always required
      fields: finalFields,
      status: input.status,
      createdBy: session!.userId,
    });

    // After create hook
    if (config.hooks?.afterCreate) {
      await config.hooks.afterCreate(entry.fields);
    }

    return entry;
  });

export const updateEntryAction = createServerAction()
  .input(z.object({
    id: z.string(),
    content: z.record(z.any()).optional(), // TipTap/ProseMirror JSON
    fields: z.record(z.any()).optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
  }))
  .handler(async ({ input }) => {
    const { session } = await getSessionFromCookie();

    // Only global admins can access CMS
    await assertIsAdmin(session?.userId || null);

    // Get existing entry
    const existing = await getEntryById(input.id);
    if (!existing) {
      throw new Error('Entry not found');
    }

    // Validate and execute hooks
    let finalFields = input.fields;
    if (input.fields) {
      finalFields = validateEntry(existing.collection, input.fields);

      const config = cmsConfig.collections[existing.collection];
      if (config.hooks?.beforeUpdate) {
        finalFields = await config.hooks.beforeUpdate(finalFields, existing.fields);
      }
    }

    // Update entry
    const updated = await updateEntry({
      id: input.id,
      content: input.content, // TipTap/ProseMirror JSON
      fields: finalFields,
      status: input.status,
      updatedBy: session!.userId,
    });

    return updated;
  });

export const deleteEntryAction = createServerAction()
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    const { session } = await getSessionFromCookie();

    // Only global admins can access CMS
    await assertIsAdmin(session?.userId || null);

    const entry = await getEntryById(input.id);
    if (!entry) {
      throw new Error('Entry not found');
    }

    const config = cmsConfig.collections[entry.collection];
    if (config.hooks?.beforeDelete) {
      const shouldDelete = await config.hooks.beforeDelete(entry.fields);
      if (!shouldDelete) {
        throw new Error('Delete prevented by hook');
      }
    }

    await deleteEntry(input.id);

    if (config.hooks?.afterDelete) {
      await config.hooks.afterDelete(entry.fields);
    }

    return { success: true };
  });

export const listEntriesAction = createServerAction()
  .input(z.object({
    collection: z.string(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }))
  .handler(async ({ input }) => {
    const { session } = await getSessionFromCookie();

    // Only global admins can access CMS admin actions
    // For public queries, use the public API functions instead (getPublishedEntries, etc.)
    await assertIsAdmin(session?.userId || null);

    const entries = await queryEntries({
      collection: input.collection,
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });

    return entries;
  });
```

### 5.2 Media Upload Actions

```typescript
// src/cms/api/media.action.ts
'use server';

import { z } from 'zod';
import { createServerAction } from 'zsa';
import { getSessionFromCookie } from '@/utils/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { db } from '@/db/client';
import { cmsMedia } from '@/db/schema';
import { fileTypeFromBuffer } from 'file-type'

export const uploadMediaAction = createServerAction()
  .input(z.object({
    file: z.instanceof(File),
    alt: z.string().optional(),
  }))
  .handler(async ({ input }) => {
    const { session } = await getSessionFromCookie();

    // Only global admins can access CMS
    await assertIsAdmin(session?.userId || null);

    const { env } = await getCloudflareContext();

    // Validate file
    const config = cmsConfig.media;
    if (!config?.enabled) {
      throw new ZSAError('MEDIA_UPLOADS_DISABLED', 'Media uploads disabled');
    }

    if (input.file.size > config.maxFileSize) {
      throw new ZSAError('FILE_TOO_LARGE', 'File too large');
    }

    if (!config.allowedTypes.includes(input.file.type)) {
      throw new Error('File type not allowed');
    }

    // Generate unique key (global CMS, no team scoping)
    const buffer = await input.file.arrayBuffer();
    const fileType = await fileTypeFromBuffer(buffer);
    const key = `cms/${createId()}.${fileType?.ext}`;

    if (
      !fileType
      || !fileType.ext
      || !config.allowedTypes.includes(fileType.mime)
    ) {
      throw new ZSAError('INVALID_FILE_TYPE', 'Invalid file type');
    }

    // Upload to R2
    await env.NEXT_INC_CACHE_R2_BUCKET.put(key, buffer, {
      httpMetadata: {
        contentType: fileType?.mime,
      },
    });

    // Get public URL
    const publicUrl = `${env.R2_PUBLIC_URL}/${key}`;

    // Save metadata to database
    const media = await db(env.DB)
      .insert(cmsMedia)
      .values({
        filename: input.file.name,
        mimeType: input.file.type,
        size: input.file.size,
        r2Key: key,
        r2Bucket: 'cms-media',
        publicUrl,
        alt: input.alt,
        uploadedBy: session!.userId,
      })
      .returning();

    return media[0];
  });
```

## 6. Public API for Frontend

### 6.1 Query Functions

```typescript
// src/cms/client.ts
// Public functions for querying CMS data in frontend

import { cache } from 'react';
import { queryEntries, getEntryBySlug } from './db';
import type { InferCollectionType } from './config';

// Get all published entries for a collection
export const getPublishedEntries = cache(
  async <T extends keyof typeof cmsConfig.collections>(
    collection: T,
    options?: {
      limit?: number;
      offset?: number;
    }
  ): Promise<Array<InferCollectionType<typeof cmsConfig.collections[T]>>> => {
    const entries = await queryEntries({
      collection,
      status: 'published',
      ...options,
    });

    return entries.map(e => e.fields);
  }
);

// Get entry by slug (only published)
export const getEntryBySlugPublic = cache(
  async <T extends keyof typeof cmsConfig.collections>(
    collection: T,
    slug: string
  ): Promise<InferCollectionType<typeof cmsConfig.collections[T]> | null> => {
    const entry = await getEntryBySlug(collection, slug);

    // Only return published entries
    if (!entry || entry.status !== 'published') {
      return null;
    }

    return entry.fields;
  }
);

// Example usage in a page:
// const posts = await getPublishedEntries('posts', { limit: 10 });
// const post = await getEntryBySlugPublic('posts', 'my-slug');
```

### 6.2 Rendering TipTap Content on the Frontend

For displaying CMS content to public users, use TipTap's static renderer to convert the stored JSON to React components without mounting the full editor. This provides excellent performance and avoids loading unnecessary editor code.

**Installation**:
```bash
pnpm add @tiptap/static-renderer
```

**Implementation**:

```typescript
// src/cms/components/TipTapRenderer.tsx
'use client';

import { renderToReactElement } from '@tiptap/static-renderer/pm/react';
import StarterKit from '@tiptap/starter-kit';
import type { JSONContent } from '@tiptap/core';

interface TipTapRendererProps {
  content: JSONContent;
  className?: string;
}

export function TipTapRenderer({ content, className }: TipTapRendererProps) {
  // Render TipTap JSON to React elements without mounting the editor
  const element = renderToReactElement({
    extensions: [
      StarterKit,
      // Add any other extensions you use in the editor
      // e.g., Image, Link, etc.
    ],
    content,
  });

  return <div className={className}>{element}</div>;
}
```

**Usage in Frontend Pages**:

```typescript
// app/blog/[slug]/page.tsx
import { getEntryBySlugPublic } from '@/cms/client';
import { TipTapRenderer } from '@/cms/components/TipTapRenderer';
import { notFound } from 'next/navigation';

export default async function BlogPostPage({
  params,
}: {
  params: { slug: string };
}) {
  const post = await getEntryBySlugPublic('posts', params.slug);

  if (!post) {
    notFound();
  }

  return (
    <article className="container mx-auto py-8">
      <h1 className="text-4xl font-bold mb-6">{post.title}</h1>

      {/* Render TipTap/ProseMirror JSON content */}
      <TipTapRenderer
        content={post.content}
        className="prose prose-lg dark:prose-invert max-w-none"
      />
    </article>
  );
}
```

**Benefits**:

1. **Performance**: No editor overhead - only renders the content
2. **Bundle Size**: Smaller JavaScript bundle (doesn't include editor code)
3. **SEO**: Server-side rendering works perfectly
4. **Consistency**: Uses the same extensions as the editor, ensuring identical rendering
5. **Type Safety**: Full TypeScript support with JSONContent type

**Advanced Configuration**:

```typescript
// src/cms/components/TipTapRenderer.tsx
import { renderToReactElement } from '@tiptap/static-renderer/pm/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

export function TipTapRenderer({ content, className }: TipTapRendererProps) {
  const element = renderToReactElement({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Disable default code block
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'rounded-lg shadow-md',
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 hover:underline',
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
    ],
    content,
  });

  return (
    <div className={className}>
      {element}
    </div>
  );
}
```

**Important Notes**:

- Always use the **same extensions** in both the editor and renderer
- If you add custom extensions to the editor, add them to the renderer too
- The renderer output is already sanitized by TipTap's schema
- Consider adding custom styling via Tailwind's `@layer` or CSS modules
- For syntax highlighting in code blocks, use `@tiptap/extension-code-block-lowlight`

## 7. Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create database schema and migrations
- [ ] Implement `cms.config.ts` structure and helpers
- [ ] Build database operations (CRUD)
- [ ] Implement validation and type safety
- [ ] Create access control system

### Phase 2: Admin UI - List & View (Week 2)
- [ ] Build admin layout and navigation
- [ ] Create collection list component
- [ ] Implement pagination
- [ ] Add filtering and sorting
- [ ] Build entry detail view (read-only)

### Phase 3: Admin UI - Create & Edit (Week 3)
- [ ] Implement field renderer component
- [ ] Build entry editor form
- [ ] Add rich text editor integration (TipTap)
- [ ] Create TipTapRenderer component for frontend display
- [ ] Implement draft/publish workflow
- [ ] Add validation error display

### Phase 4: Media Management (Week 4)
- [ ] Set up R2 bucket for media storage
- [ ] Implement media upload action
- [ ] Build media library UI
- [ ] Add image preview and metadata editing
- [ ] Integrate media picker with entry editor

### Phase 5: Advanced Features (Week 5)
- [ ] Implement version history
- [ ] Add bulk operations (delete, publish)
- [ ] Build search functionality
- [ ] Add audit logging
- [ ] Implement webhooks for external integrations

### Phase 6: Polish & Optimization (Week 6)
- [ ] Add loading states and optimistic updates
- [ ] Implement caching strategy (KV)
- [ ] Performance optimization
- [ ] Error handling improvements
- [ ] Documentation and examples

## 8. Example Usage

### Define Collections in `cms.config.ts`

```typescript
export const collections = {
  posts: defineCollection({
    slug: 'posts',
    labels: { singular: 'Post', plural: 'Posts' },
    fields: {
      // NOTE: 'content' is NOT defined here - it's always present in cms_entries
      title: z.string().min(1).max(200),
      slug: z.string().min(1).max(200),
      published: z.boolean().default(false),
    },
    options: {
      slugField: 'slug',
      titleField: 'title',
      // Note: timestamps are ALWAYS added automatically
      // Note: CMS is global-only, no team scoping
      // Note: Only global admins can access CMS - no access config needed
      // Note: content field (TipTap/ProseMirror JSON) is ALWAYS present, not defined in fields
    },
  }),
};
```

### Use in Frontend

```typescript
// app/blog/page.tsx
import { getPublishedEntries } from '@/cms/client';
import { TipTapRenderer } from '@/cms/components/TipTapRenderer';

export default async function BlogPage() {
  const posts = await getPublishedEntries('posts', { limit: 10 });

  return (
    <div className="container mx-auto py-8">
      {posts.map(post => (
        <article key={post.slug} className="mb-8">
          <h2 className="text-2xl font-bold mb-4">{post.title}</h2>
          {/* Render TipTap/ProseMirror content using static renderer */}
          <TipTapRenderer
            content={post.content}
            className="prose dark:prose-invert"
          />
        </article>
      ))}
    </div>
  );
}

// app/blog/[slug]/page.tsx
import { getEntryBySlugPublic } from '@/cms/client';
import { TipTapRenderer } from '@/cms/components/TipTapRenderer';
import { notFound } from 'next/navigation';

export default async function BlogPostPage({
  params
}: {
  params: { slug: string }
}) {
  const post = await getEntryBySlugPublic('posts', params.slug);

  if (!post) {
    notFound();
  }

  return (
    <article className="container mx-auto py-8">
      <h1 className="text-4xl font-bold mb-6">{post.title}</h1>
      {/* Render TipTap/ProseMirror content using static renderer */}
      <TipTapRenderer
        content={post.content}
        className="prose prose-lg dark:prose-invert max-w-none"
      />
    </article>
  );
}
```

### Manage in Admin UI

1. Navigate to `/admin/cms`
2. Select "Posts" collection
3. Click "Create Post"
4. Fill in fields (auto-generated form)
5. Save as draft or publish immediately
6. View in frontend at `/blog/[slug]`

## 9. Benefits of This Approach

1. **Lightweight**: No external dependencies for CMS core
2. **Type-safe**: Full TypeScript support with Zod
3. **Flexible**: JSON storage allows any field structure
4. **Integrated**: Works seamlessly with existing auth system
5. **Performant**: Cloudflare edge deployment, D1 database
6. **Familiar**: Similar API to Payload CMS
7. **Customizable**: Hooks for custom logic
8. **Secure**: Global admin access control with automatic timestamps
9. **Simple**: No multi-tenancy complexity, global CMS only
10. **Automatic**: Timestamps always added, no configuration needed

## 10. Additional Features from Payload CMS

### 10.1 Soft Deletes (Trash)

When `options.trash` is enabled, entries are soft-deleted instead of permanently removed:

**Implementation**:
```typescript
// Soft delete entry (move to trash)
export async function trashEntry(id: string, userId: string) {
  const { env } = await getCloudflareContext();

  const updated = await db(env.DB)
    .update(cmsEntries)
    .set({
      deletedAt: new Date(),
      deletedBy: userId,
    })
    .where(eq(cmsEntries.id, id))
    .returning();

  return updated[0];
}

// Restore from trash
export async function restoreEntry(id: string) {
  const { env } = await getCloudflareContext();

  const updated = await db(env.DB)
    .update(cmsEntries)
    .set({
      deletedAt: null,
      deletedBy: null,
    })
    .where(eq(cmsEntries.id, id))
    .returning();

  return updated[0];
}

// Permanently delete
export async function permanentlyDeleteEntry(id: string) {
  const { env } = await getCloudflareContext();

  await db(env.DB)
    .delete(cmsEntries)
    .where(eq(cmsEntries.id, id));

  return true;
}
```

**Admin UI**:
- Add "Trash" view to list trashed entries
- Add "Restore" and "Delete Permanently" actions
- Filter out trashed entries from main list (where deletedAt IS NULL)

### 10.2 Duplicate Functionality

Allow users to duplicate entries (unless `options.disableDuplicate` is true):

**Implementation**:
```typescript
export const duplicateEntryAction = createServerAction()
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    const { session } = await getSessionFromCookie();

    // Only global admins can access CMS
    await assertIsAdmin(session?.userId || null);

    const original = await getEntryById(input.id);
    if (!original) {
      throw new Error('Entry not found');
    }

    const config = cmsConfig.collections[original.collection];

    // Check if duplicate is disabled
    if (config.options?.disableDuplicate) {
      throw new Error('Duplicate is disabled for this collection');
    }

    // Clone the entry with new slug
    const newFields = { ...original.fields };
    const slugField = config.options?.slugField || 'slug';
    newFields[slugField] = `${newFields[slugField]}-copy-${Date.now()}`;

    // Create new entry
    const duplicated = await createEntry({
      collection: original.collection,
      slug: newFields[slugField],
      fields: newFields,
      status: 'draft', // Always create as draft
      createdBy: session!.userId,
    });

    return duplicated;
  });
```

**Admin UI**:
- Add "Duplicate" button in entry edit view
- Show confirmation dialog
- Redirect to edit view of duplicated entry

### 10.3 Compound Indexes

Support for defining compound indexes in collection config:

**Usage**:
```typescript
indexes: [
  { fields: ['status'], unique: false },
  { fields: ['teamId', 'slug'], unique: true }, // Unique team + slug combination
]
```

**Migration Generation**:
When generating migrations, parse the `indexes` config and create appropriate SQL:

```sql
-- Generated from indexes config
CREATE INDEX idx_posts_status_publishedAt ON cms_entries(status, publishedAt)
  WHERE collection = 'posts';

CREATE UNIQUE INDEX idx_posts_teamId_slug ON cms_entries(teamId, slug)
  WHERE collection = 'posts';
```

### 10.4 Admin Navigation Grouping

Collections can be grouped in the admin navigation:

**Example Config**:
```typescript
export const collections = {
  posts: defineCollection({
    // ...
    admin: { group: 'Content' },
  }),
  docs: defineCollection({
    // ...
    admin: { group: 'Content' },
  }),
  users: defineCollection({
    // ...
    admin: { group: 'Admin' },
  }),
  settings: defineCollection({
    // ...
    admin: { group: false }, // Hide from navigation
  }),
};
```

**Admin UI**:
- Group collections under collapsible sections
- Collections with `group: false` are hidden from nav but routes still work
- Sort groups alphabetically, collections within groups by label

## 11. Future Enhancements

- **Relationships**: Link between collections (e.g., post -> author)
- **Localization**: Multi-language support
- **Workflows**: Draft -> Review -> Publish
- **Scheduled Publishing**: Publish at specific time
- **SEO Tools**: Meta tags, sitemap generation
- **Analytics**: Content performance tracking
- **API Keys**: External API access
- **Webhooks**: Trigger external services on events
- **Import/Export**: Bulk data operations
- **Custom Fields**: Plugin system for custom field types
- **Live Preview**: Real-time preview of changes
- **Document Locking**: Prevent concurrent edits
- **Rich Text Relationships**: Reference other entries within rich text
- **Folders**: Organize entries into folders

## 12. Comparison: Lightweight CMS vs Payload CMS

### What We're Keeping from Payload CMS

✅ **Configuration-driven approach** - Define collections in a config file
✅ **Field-based schemas** - Structure your content with typed fields
✅ **Hooks** - Lifecycle hooks for custom logic
✅ **Admin UI** - Auto-generated admin interface
✅ **Timestamps** - Automatic createdAt/updatedAt tracking
✅ **Versions** - Optional revision history
✅ **Trash** - Soft deletes for recovery
✅ **Duplicate** - Clone entries
✅ **Media uploads** - File management

### What We're Simplifying

🎯 **Zod instead of custom field types** - Use Zod schemas you already know
🎯 **JSON storage instead of separate tables** - One table for all collections
🎯 **Global admin-only access** - No per-collection permissions configuration
🎯 **No GraphQL** - REST API via server actions only
🎯 **No plugin system** - Direct code modifications
🎯 **No admin customization DSL** - Use React components directly
🎯 **No separate backend** - Fully integrated with Next.js app
🎯 **Automatic timestamps** - No configuration needed, always enabled

### What We're NOT Building (For Now)

❌ **GraphQL API** - Not needed, using server actions
❌ **Localization** - Can be added later if needed
❌ **Relationships** - Can be added in Phase 5+
❌ **Document locking** - Not critical for initial version
❌ **Live preview** - Can be added later
❌ **Folders** - Can be added later
❌ **Query presets** - Not needed initially

### Key Advantages of This Approach

1. **Zero Dependencies**: No CMS package to install, maintain, or upgrade
2. **Fully Integrated**: Uses your existing auth, teams, and database
3. **Edge-Native**: Designed for Cloudflare Workers from the ground up
4. **Type-Safe**: Full TypeScript + Zod validation throughout
5. **Lightweight**: ~5-10KB of config vs 100s of KB for Payload
6. **Flexible**: Direct access to code, no abstraction layers
7. **Familiar**: Uses patterns you already use (server actions, Zod, React)
8. **Maintainable**: All code is in your repository, no black boxes

### When to Use This CMS

✅ Building a SaaS app that needs content management
✅ Need blog, docs, or other simple content types
✅ Want full control over the code
✅ Deploying to Cloudflare Workers
✅ Prefer lightweight solutions
✅ Team already knows Zod and Next.js

### When to Use Payload CMS Instead

❌ Need a standalone CMS separate from your app
❌ Require extensive plugin ecosystem
❌ Need GraphQL API
❌ Need complex relationships between collections
❌ Want a fully managed admin panel solution
❌ Prefer convention over configuration

---

This plan provides a complete, production-ready CMS system that integrates seamlessly with your existing Next.js SaaS template while remaining lightweight and maintainable. By taking inspiration from Payload CMS's excellent API design while simplifying the implementation, we get the best of both worlds: a familiar, powerful CMS that's perfectly suited for Cloudflare Workers and your SaaS template.
