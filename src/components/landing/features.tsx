import {
  ShieldCheck,
  Database,
  Zap,
  Palette,
  Globe,
  TerminalSquare,
  ClipboardCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

interface Feature {
  tag: string;
  name: string;
  description: string;
  icon: LucideIcon;
}

const features: Feature[] = [
  {
    tag: "auth",
    name: "Authentication, solved",
    description:
      "Email and password sign-in, sign-up, password reset, and sessions on Lucia Auth — plus passkeys and Google OAuth.",
    icon: ShieldCheck,
  },
  {
    tag: "data",
    name: "Database & email",
    description:
      "Drizzle ORM over Cloudflare D1, KV-backed sessions, and transactional email sent straight from the Worker.",
    icon: Database,
  },
  {
    tag: "edge",
    name: "Deployed to the edge",
    description:
      "Ship to Cloudflare Workers and serve from 330+ cities with zero cold starts. One command pushes to production.",
    icon: Globe,
  },
  {
    tag: "runtime",
    name: "Modern runtime",
    description:
      "Next.js App Router and React Server Components running on Vinext and Vite for an instant dev loop.",
    icon: Zap,
  },
  {
    tag: "billing",
    name: "Billing built in",
    description:
      "Stripe checkout and a credit system are wired up, so you can charge customers without starting from scratch.",
    icon: ClipboardCheck,
  },
  {
    tag: "ui",
    name: "A real design system",
    description:
      "Tailwind CSS with Shadcn and Base UI components, dark mode, and responsive layouts ready to extend.",
    icon: Palette,
  },
  {
    tag: "teams",
    name: "Teams & admin",
    description:
      "Multi-tenant teams, role-based access, and an admin panel for managing users and content out of the box.",
    icon: Users,
  },
  {
    tag: "dx",
    name: "Developer experience",
    description:
      "TypeScript end to end, Oxlint, a CMS for blog and docs, and GitHub Actions deployment you don't have to write.",
    icon: TerminalSquare,
  },
];

export function Features() {
  return (
    <section className="bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-edge">
            {"// what's in the box"}
          </p>
          <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Skip the boilerplate. Build the product.
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            Every undifferentiated part of a SaaS is already here and tested. Open the
            repo and start writing the code that only your product needs.
          </p>
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <FeatureCard key={feature.name} feature={feature} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  return (
    <div className="group relative bg-card p-6 transition-colors hover:bg-accent/40">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px scale-x-0 bg-edge transition-transform duration-300 group-hover:scale-x-100"
      />
      <div className="flex items-center justify-between">
        <Icon className="size-6 text-edge" strokeWidth={1.75} aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {feature.tag}
        </span>
      </div>
      <h3 className="mt-5 font-display text-lg font-semibold text-foreground">
        {feature.name}
      </h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {feature.description}
      </p>
    </div>
  );
}
