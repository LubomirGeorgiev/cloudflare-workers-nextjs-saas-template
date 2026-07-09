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
import { useTranslations } from "next-intl";

interface Feature {
  tag: string;
  key: "auth" | "data" | "edge" | "runtime" | "billing" | "ui" | "teams" | "dx";
  icon: LucideIcon;
}

const features: Feature[] = [
  { tag: "auth", key: "auth", icon: ShieldCheck },
  { tag: "data", key: "data", icon: Database },
  { tag: "edge", key: "edge", icon: Globe },
  { tag: "runtime", key: "runtime", icon: Zap },
  { tag: "billing", key: "billing", icon: ClipboardCheck },
  { tag: "ui", key: "ui", icon: Palette },
  { tag: "teams", key: "teams", icon: Users },
  { tag: "dx", key: "dx", icon: TerminalSquare },
];

export function Features() {
  const t = useTranslations("Client.Landing.Features");
  return (
    <section className="bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-edge">
            {t("eyebrow")}
          </p>
          <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {t("heading")}
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            {t("description")}
          </p>
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <FeatureCard key={feature.key} feature={feature} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const t = useTranslations("Client.Landing.Features");
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
        {t(`${feature.key}.name`)}
      </h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {t(`${feature.key}.description`)}
      </p>
    </div>
  );
}
