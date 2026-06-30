import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { GITHUB_REPO_URL } from "@/constants";

const faqs = [
  {
    question: "Is this template really free?",
    answer: (
      <>
        Yes, this template is completely free and <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">open source</a>! You can use it for both personal and commercial projects without any licensing fees. You can fork, copy, modify, and distribute it as you see fit without any restrictions and attribution.
      </>
    ),
  },
  {
    question: "What features are included?",
    answer: (
      <>
        The template includes a comprehensive set of features:
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Authentication with email/password and forgot password flow</li>
          <li>Database integration with Drizzle ORM and Cloudflare D1</li>
          <li>Email service powered by Cloudflare Email Service</li>
          <li>Modern UI components from Shadcn UI and Tailwind CSS</li>
          <li>Form validations and error handling</li>
          <li>Dark mode support</li>
          <li>Responsive design</li>
          <li>TypeScript throughout the codebase</li>
          <li>Automated deployments with GitHub Actions</li>
          <li>Captcha integration with Turnstile</li>
          <li>SEO optimization with Next.js</li>
          <li>And countless other features...</li>
        </ul>
      </>
    ),
  },
  {
    question: "What's the tech stack?",
    answer: (
      <>
        <p>The template uses modern and reliable technologies:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Next.js App Router with React Server Components through Vinext and Vite</li>
          <li>TypeScript for type safety</li>
          <li>Tailwind CSS and Shadcn UI for styling</li>
          <li>DrizzleORM with Cloudflare D1 for database</li>
          <li>Lucia Auth for authentication</li>
          <li>Cloudflare Workers for serverless deployment</li>
          <li>Cloudflare KV for session storage</li>
          <li>Cloudflare Email Service for transactional email</li>
        </ul>
      </>
    ),
  },
  {
    question: "How do I deploy my application?",
    answer: (
      <>
        <p>Deployment is automated with GitHub Actions. You&apos;ll need to:</p>
        <ol className="list-decimal pl-6 mt-2 space-y-1">
          <li>Create Cloudflare D1 and KV namespaces</li>
          <li>Onboard your sending domain in Cloudflare Email Service</li>
          <li>Enable Cloudflare Images for image optimization</li>
          <li>Configure Turnstile for captcha</li>
          <li>Add your Cloudflare API token to GitHub secrets</li>
          <li>Push to the main branch</li>
        </ol>
        <p className="mt-2">The deployment process is fully documented in the <a href={`${GITHUB_REPO_URL}/blob/main/README.md`} target="_blank" rel="noreferrer">GitHub repository</a>.</p>
      </>
    ),
  },
  {
    question: "What do I need to get started?",
    answer: (
      <>
        <p>You&apos;ll need a Cloudflare account (free tier is fine), Node.js installed locally, and basic knowledge of React and TypeScript. The template includes detailed documentation to guide you through the setup.</p>
        <p>You can also check out the <a href={`${GITHUB_REPO_URL}/blob/main/README.md`} target="_blank" rel="noreferrer">documentation</a> for more information.</p>
      </>
    ),
  },
  {
    question: "What are the upcoming features?",
    answer: (
      <>
        <p>We have an exciting roadmap ahead! Planned features include:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Multi-language support (i18n)</li>
          <li>Billing and payment processing</li>
          <li>Admin dashboard</li>
          <li>Email verification on sign up</li>
          <li>Notifications system</li>
          <li>Webhooks support</li>
          <li>Team collaboration features</li>
          <li>Real-time updates</li>
          <li>Analytics dashboard</li>
        </ul>
      </>
    ),
  },
  {
    question: "How are email templates handled?",
    answer: (
      <>
        Transactional email templates are rendered by the app and sent through Cloudflare Email Service from the Worker.
      </>
    ),
  },
  {
    question: "How do I customize the template?",
    answer: (
      <>
        <p>Before deploying to production, you should:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Update project details in <code>src/constants.ts</code></li>
          <li>Modify the footer in <code>src/components/footer.tsx</code></li>
          <li>Optionally update the color palette in <code>src/app/globals.css</code></li>
        </ul>
      </>
    ),
  },
  {
    question: "How can I contribute?",
    answer: (
      <>
        Contributions are welcome! Feel free to open issues, submit pull requests, or help improve the documentation on <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">GitHub</a>. The project follows standard open source contribution guidelines.
      </>
    ),
  },
];

export function FAQ() {
  return (
    <section className="border-t border-border bg-card/40 py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:px-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-edge">
            {"// faq"}
          </p>
          <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Questions, answered
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            Still curious? The README covers everything else, and issues are always open.
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq, index) => (
            <AccordionItem key={index} value={`item-${index}`} className="border-border">
              <AccordionTrigger className="text-left font-display text-base font-medium">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent>
                <div className="prose prose-sm dark:prose-invert w-full max-w-none text-muted-foreground prose-a:text-edge">
                  {faq.answer}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
