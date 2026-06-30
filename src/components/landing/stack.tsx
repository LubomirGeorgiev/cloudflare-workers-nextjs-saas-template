const PLATFORM = [
  "Workers",
  "D1",
  "KV",
  "R2",
  "Images",
  "Queues",
  "Turnstile",
];

const FRAMEWORK = [
  "Next.js via Vinext",
  "React Server Components",
  "Drizzle ORM",
  "Lucia Auth",
  "Tailwind CSS",
  "Stripe",
];

export function Stack() {
  return (
    <section className="border-y border-border bg-card/40">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {"// the whole stack, already assembled"}
        </p>
        <div className="mt-6 grid gap-8 md:grid-cols-2">
          <StackGroup heading="Cloudflare platform" items={PLATFORM} />
          <StackGroup heading="App framework" items={FRAMEWORK} />
        </div>
      </div>
    </section>
  );
}

function StackGroup({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div>
      <h3 className="font-mono text-xs uppercase tracking-wide text-edge">{heading}</h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground/80"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
