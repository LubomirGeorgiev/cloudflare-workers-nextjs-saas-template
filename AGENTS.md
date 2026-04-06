# Cloudflare Workers Next.js SaaS Template - AI Assistant Guidelines

This document provides comprehensive context and guidelines for AI assistants working on this project.

**For additional project information, features, and setup instructions, refer to the README.md file in the project root.**

## Project Overview

This is a comprehensive, production-ready Next.js SaaS template designed to run on Cloudflare Workers with OpenNext. It includes authentication, team management, billing, and other common SaaS features needed to launch a modern web application.

**Live Demo**: [nextjs-saas-template.lubomirgeorgiev.com](https://nextjs-saas-template.lubomirgeorgiev.com/sign-up)

**GitHub Repository**: [cloudflare-workers-nextjs-saas-template](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template)

## Key Capabilities

- **Authentication & Security**: Complete auth system with Lucia Auth, WebAuthn/Passkeys, OAuth, rate limiting, and session management
- **Multi-tenancy**: Teams/organizations with role-based permissions and tenant isolation
- **Billing System**: Credit-based billing with Stripe integration, usage tracking, and transaction history
- **Admin Dashboard**: User management, credit administration, and analytics
- **Modern Stack**: Next.js 15, React Server Components, TypeScript, Tailwind CSS, Shadcn UI
- **Edge Computing**: Cloudflare Workers with D1 database, KV storage, and global deployment
- **Email System**: React Email templates with Resend/Brevo integration
- **Developer Experience**: Full TypeScript support, Drizzle ORM, automated deployments

You are an expert in TypeScript, Node.js, Next.js App Router, React, Shadcn UI, Radix UI, Tailwind CSS and DrizzleORM.

## Tech Stack

### Frontend
- Next.js 15 (App Router)
- React Server Components
- TypeScript
- Tailwind CSS
- Shadcn UI (Built on Radix UI)
- Lucide Icons
- NUQS for URL state management
- Zustand for client state

### Backend (Cloudflare Workers with OpenNext)
- DrizzleORM
- Cloudflare D1 (SQLite Database)
- Cloudflare KV (Session/Cache Storage)
- Cloudflare R2 (File Storage)
- OpenNext for SSR/Edge deployment

### Authentication & Authorization
- Lucia Auth (User Management)
- KV-based session management
- CUID2 for ID generation
- Team-based multi-tenancy

## Development Status

### Completed Features
- Infrastructure setup (Next.js, Cloudflare Workers, D1, KV)
- Authentication system (Lucia Auth)
- User management and settings
- Session management with KV storage
- Dashboard layout with navigation
- Password reset flow
- Email system with templates
- Security enhancements (rate limiting, input sanitization)
- Credit-based billing system
- Stripe payment processing
- Multi-tenancy implementation
- Team management with roles and permissions
- Admin dashboard

### In Progress
- Real-time updates
- Analytics dashboard
- File upload system with R2
- Audit logging

### Key Features

#### User Management
- Authentication (Lucia Auth)
- User profiles and settings
- Session management
- Admin panel with user/credit/transaction management
- Team management with role-based permissions

#### Multi-Tenancy
- Teams and organizations
- Role-based access control (system and custom roles)
- Fine-grained permissions with JSON storage
- Team invitations and onboarding
- Team settings and management

#### Billing & Subscriptions
- Credit-based billing system
- Credit packages and pricing
- Credit usage tracking
- Transaction history
- Monthly credit refresh
- Stripe payment processing

## Code Style and Structure

### General Principles

- Write concise, technical TypeScript code with accurate examples.
- Use functional and declarative programming patterns; avoid classes.
- Prefer iteration and modularization over code duplication.
- Use descriptive variable names with auxiliary verbs (e.g., isLoading, hasError).
- Structure files: exported component, subcomponents, helpers, static content, types.
- Never delete any comments in the code unless they are no longer relevant.

### Commenting Guidelines

- Do not add comments for obvious or self-explanatory code.
- Only add comments for non-trivial logic, edge cases, workarounds, or business rules that aren't immediately clear from the code itself.
- Comments should explain "why" something is done, not "what" is being done (the code should be self-documenting for the "what").
- Avoid redundant comments like `// Set user name` above `user.name = name`.
- TODO comments are intentional reminders for future work. Only remove a TODO comment if you have implemented the described feature or fix and verified that it works correctly.

### Function Guidelines

- When a function has more than 1 parameter, always pass them as a named object.
- Use the "function" keyword for pure functions.
- Avoid unnecessary curly braces in conditionals; use concise syntax for simple statements.

### Import Guidelines

- Add `import "server-only"` at the top of the file (ignore this rule for page.tsx files) if it's only intended to be used on the server.
- When creating React server actions use `actionClient` from `src/lib/safe-action.ts` on the server and `useAction` from `next-safe-action/hooks` in client components.

### Package Management

- Before adding any new packages, always check if we already have them in `package.json` to avoid duplicates.
- Use `pnpm` for all package management operations.
- Always use pnpm to install dependencies.

### Type Definitions

- When you have to add a global type, add it to `custom-env.d.ts` instead of `cloudflare-env.d.ts`, because otherwise it will be overridden by `pnpm run cf-typegen`.

## DRY (Don't Repeat Yourself) Principles

### Core Rules

#### 1. Extract Magic Values to Constants

If a value appears 2+ times, make it a constant.

**Bad**: Hardcoded strings/numbers in multiple places
**Good**: Single constant defined once, used everywhere

**Where**: `src/constants.ts` or `src/app/enums.ts`

#### 2. Centralize Validation Limits

Validation limits must be constants, not hardcoded numbers.

**Bad**: maxLength={160}, z.string().max(160), if (text.length > 160)
**Good**: Define MAX_LENGTH = 160 once, use everywhere

**Why**: Single source of truth across schemas, UI, and logic.

#### 3. Extract Repeated Formatting

If same formatting appears 2+ times, create utility function.

**Examples**: Date formatting, number formatting, text transformations

**Where**: `src/utils/` or `src/lib/`

#### 4. Helper Functions for Common Patterns

If writing same code 3+ times, extract to helper function.

**Principle**: If copy-pasting, you should be extracting.

#### 5. Extract Repeated Type Definitions

If TypeScript type appears 2+ times, make it a named type.

**Bad**: Union types repeated everywhere
**Good**: Single type definition, reused

#### 6. Use Existing Type Aliases

Check for existing types before writing verbose assertions.

**Bad**: as keyof typeof config.items
**Good**: Use ItemKey if it exists

#### 7. Centralize Cache Keys

Cache keys in central constant, not hardcoded strings.

**Where**: `src/utils/with-kv-cache.ts`

### When NOT to Apply DRY

Acceptable repetition:

1. Simple patterns that are clear and explicit
2. Different business logic that looks similar
3. Framework boilerplate

**Principle**: Prefer clear code over abstractions for simple patterns.

### DRY Checklist Before Committing

- Hardcoded values appearing multiple times?
- Repeated object literals or config?
- Copy-pasted code blocks?
- Repeated type annotations?
- Would extraction improve readability?

**Apply DRY if duplication causes maintenance risk and extraction improves clarity.**

### Quick Reference: Where to Put Extracted Code

**Constants** → `src/constants.ts` or `src/app/enums.ts`
**Cache keys** → `src/utils/with-kv-cache.ts`
**Utilities** → `src/utils/` or `src/lib/`
**Types** → Same file or `src/types.ts`
**Schemas** → `src/schemas/`

## TypeScript Conventions

### Type Definitions

- Use TypeScript for all code; prefer interfaces over types.
- Avoid enums; use maps instead.
- Use functional components with TypeScript interfaces.

### Naming Conventions

- Use lowercase with dashes for directories (e.g., components/auth-wizard).
- Favor named exports for components.

### Syntax and Formatting

- Use declarative JSX.
- Avoid unnecessary curly braces in conditionals; use concise syntax for simple statements.

## UI and Styling

### Component Libraries

- Use Shadcn UI, Hero-UI, and Tailwind for components and styling.
- Implement responsive design with Tailwind CSS; use a mobile-first approach.
- Optimize for light and dark mode.

### Layout Guidelines

- When using a "container" class, use the "mx-auto" class to center the content.

### Performance Optimization

- Minimize 'use client', 'useEffect', and 'setState'; favor React Server Components (RSC).
- Wrap client components in Suspense with fallback.
- Use dynamic loading for non-critical components.
- Optimize images: use WebP format, include size data, implement lazy loading.

## Next.js Patterns

### Key Conventions

- Use 'nuqs' for URL search parameter state management.
- Optimize Web Vitals (LCP, CLS, FID).
- Follow Next.js docs for Data Fetching, Rendering, and Routing.

### Client Component Usage

Limit 'use client':
- Favor server components and Next.js SSR.
- Use only for Web API access in small components.
- Avoid for data fetching or state management.

### Performance Guidelines

- Minimize 'use client', 'useEffect', and 'setState'; favor React Server Components (RSC).
- Wrap client components in Suspense with fallback.
- Use dynamic loading for non-critical components.

## Authentication Guidelines

### Authentication Stack

The authentication logic is in `src/utils/auth.ts` and `src/utils/kv-session.ts` and is based on Lucia Auth.

### Server Components

If we want to access the session in a server component, we need to use the `getSessionFromCookie` function in `src/utils/auth.ts`.

### Client Components

If we want to access the session in a client component, we can get it from `const session = useSessionStore();` in `src/state/session.ts`.

## Database Patterns

The database schema is in `src/db/schema.ts`.

### Drizzle ORM Guidelines

- Never use Drizzle ORM Transactions since Cloudflare D1 doesn't support them.
- When inserting or updating items with Drizzle ORM never pass an id since we autogenerate it in the schema.
- When using `db.insert().values()` never pass and id because we autogenerate them.

### Migration Workflow

Never generate SQL migration files. Instead after making changes to `./src/db/schema.ts` you should run `pnpm db:generate [MIGRATION_NAME]` to generate the migrations.

## Cloudflare Stack

You are also excellent at Cloudflare Workers and other tools like D1 serverless database and KV. You can suggest usage of new tools (changes in wrangler.jsonc file) to add more primitives like:
- R2: File storage
- KV: Key-value storage
  - Always use the existing KV namespace in `wrangler.jsonc` don't ever create new ones.
- AI: AI multimodal inference
- others primitives in `wrangler.jsonc`
- After adding a new primitive to `wrangler.jsonc`, always run `pnpm run cf-typegen` to generate the new types.

### Cloudflare Context Access

Cloudflare bindings accessed through getCloudflareContext

## State Management

- Server state with React Server Components
- Client state with Zustand where needed
- URL state with NUQS

## Security & Performance

- Edge computing with Cloudflare Workers
- React Server Components for performance
- Session-based auth with KV storage
- Rate limiting for API endpoints
- Input validation and sanitization
- Efficient data fetching and asset optimization

## Forms and Validation Patterns

### Zod Schema Reuse

All Zod validation schemas should be:
- Centralized in the `src/schemas/` directory
- Reused between both client-side (react-hook-form) and server-side (`next-safe-action`) validation
- Never duplicated or defined separately for client and server

#### Schema File Structure

Each schema file should export both the schema and its TypeScript type:

```typescript
import { z } from "zod"

export const mySchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(2).max(255),
  lastName: z.string().min(2).max(255),
})

export type MySchema = z.infer<typeof mySchema>
```

Key requirements:
- Export the schema with a camelCase name (e.g., `mySchema`)
- Export the TypeScript type using `z.infer` with PascalCase name (e.g., `MySchema`)
- This allows consumers to import both: `import { type MySchema, mySchema } from "@/schemas/my-schema.schema"`

### Server Actions with next-safe-action

All server actions that handle form submissions MUST use `next-safe-action`:

```typescript
import { actionClient } from "@/lib/safe-action"
import { mySchema } from "@/schemas/my-schema.schema";

export const myAction = actionClient
  .inputSchema(mySchema)
  .action(async ({ parsedInput }) => {
    // Server-side logic with validated input
    return { success: true };
  })
```

Key requirements:
- Use `actionClient` from `src/lib/safe-action.ts`
- Use `.inputSchema(schema)` to define input validation with the Zod schema
- The schema provides full type safety for the `parsedInput` parameter

### Client Forms with React Hook Form

Client forms should follow this pattern:

```typescript
"use client";

import { myAction } from "./my.actions";
import { type MySchema, mySchema } from "@/schemas/my-schema.schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

const MyForm = () => {
  const { execute: submitForm } = useAction(myAction, {
    onError: ({ error }) => {
      toast.dismiss()
      toast.error(error.serverError || "Something went wrong")
    },
    onExecute: () => {
      toast.loading("Processing...")
    },
    onSuccess: ({ data }) => {
      toast.dismiss()
      toast.success("Success!")
    }
  })

  const form = useForm<MySchema>({
    resolver: zodResolver(mySchema),
  });

  const onSubmit = async (data: MySchema) => {
    submitForm(data)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* Form fields */}
      </form>
    </Form>
  );
};
```

Key requirements:
- Import both the schema type AND the schema itself: `type MySchema, mySchema`
- Use `useForm<MySchema>` with `zodResolver(mySchema)` for client-side validation
- Use `useAction` from `next-safe-action/hooks` to call the server action
- Use toast notifications for loading, success, and error states
- Use `form.handleSubmit(onSubmit)` pattern for form submission

### Complete Example

See the sign-up implementation as the reference pattern:
- **Server Action**: `src/app/(auth)/sign-up/sign-up.actions.ts`
- **Client Form**: `src/app/(auth)/sign-up/sign-up.client.tsx`
- **Schema**: `src/schemas/signup.schema.ts`

### Benefits of This Pattern

1. **Single Source of Truth**: One schema definition for both client and server validation
2. **Type Safety**: Full TypeScript type inference from schema to form to server action
3. **DRY Principle**: No duplication of validation logic
4. **Runtime Safety**: Client-side validation for UX + Server-side validation for security
5. **Error Handling**: Consistent error handling through `useAction` callbacks

## Terminal Commands

In the terminal, you are also an expert at suggesting wrangler commands.
