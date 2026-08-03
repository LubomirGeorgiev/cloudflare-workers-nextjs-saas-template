import { LinkIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ApiCodeBlock } from "./api-code-block";
import { ApiJsonPreview } from "./api-json-preview";
import { ApiParameterFields, ApiSchemaFields } from "./api-schema-fields";
import { filterAttributes, methodStyle } from "./api-reference-dom";
import { API_AUTH_DOCS_PATH, API_ERRORS_DOCS_PATH, MCP_DOCS_PATH } from "@/constants";
import { Link } from "@/i18n/navigation";
import type { OperationView, ResponseView } from "@/lib/api/reference-model";
import { cn } from "@/lib/utils";

// One fully server-rendered operation. Every documented failure shares the RFC 9457 problem shape,
// so the error statuses collapse into one collapsed block instead of repeating that schema five
// times per endpoint.

export function ApiMethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase leading-4 ring-1 ring-inset",
        methodStyle(method),
        className,
      )}
    >
      {method}
    </span>
  );
}

function OperationSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

async function SuccessResponse({ response }: { response: ResponseView }) {
  const t = await getTranslations("Client.Docs.ApiReference");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/25 dark:text-emerald-300 dark:ring-emerald-400/25">
          {response.status}
        </span>
        <span className="text-xs text-muted-foreground">{response.description}</span>
        {response.schema ? (
          <span className="font-mono text-[11px] text-muted-foreground/70">
            {response.schema.typeLabel}
          </span>
        ) : null}
      </div>

      {response.schema && response.schema.fields.length > 0 ? (
        <ApiSchemaFields fields={response.schema.fields} variant="response" />
      ) : null}

      {response.schema ? (
        <ApiCodeBlock
          label={t("exampleLabel")}
          copyValue={JSON.stringify(response.schema.example, null, 2)}
          copyLabel={t("copyExample")}
        >
          <ApiJsonPreview value={response.schema.example} />
        </ApiCodeBlock>
      ) : null}
    </div>
  );
}

async function ErrorResponses({ operation }: { operation: OperationView }) {
  const t = await getTranslations("Client.Docs.ApiReference");

  return (
    <details className="group rounded-lg border border-border/70 bg-background/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <span className="flex flex-wrap items-center gap-2">
          {t("errorResponsesLabel")}
          {operation.errorResponses.map((response) => (
            <span key={response.status} className="font-mono text-[11px] text-muted-foreground/70">
              {response.status}
            </span>
          ))}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 group-open:hidden">
          {t("expandLabel")}
        </span>
      </summary>

      <div className="space-y-3 border-t border-border/60 px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t.rich("errorResponsesHint", {
            errors: (chunks) => (
              <Link href={API_ERRORS_DOCS_PATH} className="underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>

        <dl className="space-y-1.5">
          {operation.errorResponses.map((response) => (
            <div key={response.status} className="flex gap-3 text-xs">
              <dt className="w-8 shrink-0 font-mono font-medium text-foreground">{response.status}</dt>
              <dd className="text-muted-foreground">{response.description}</dd>
            </div>
          ))}
        </dl>

        {operation.errorExample ? (
          <ApiCodeBlock
            label={t("exampleLabel")}
            copyValue={JSON.stringify(operation.errorExample, null, 2)}
            copyLabel={t("copyExample")}
          >
            <ApiJsonPreview value={operation.errorExample} />
          </ApiCodeBlock>
        ) : null}
      </div>
    </details>
  );
}

const BADGE_CLASS_NAME =
  "inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2.5 py-1";

/** What the operation costs a credential and what an agent calls it: scope, MCP tool, operationId. */
async function OperationBadges({ operation }: { operation: OperationView }) {
  const t = await getTranslations("Client.Docs.ApiReference");

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {operation.scope ? (
        <Link
          href={API_AUTH_DOCS_PATH}
          title={operation.scopeDescription ?? undefined}
          className={cn(BADGE_CLASS_NAME, "transition-colors hover:border-border hover:bg-muted/40")}
        >
          <span className="text-muted-foreground">{t("scopeLabel")}</span>
          <code className="font-mono font-medium text-foreground">{operation.scope}</code>
        </Link>
      ) : null}

      {operation.mcpToolName ? (
        <Link
          href={MCP_DOCS_PATH}
          className={cn(BADGE_CLASS_NAME, "transition-colors hover:border-border hover:bg-muted/40")}
        >
          <span className="text-muted-foreground">{t("mcpToolLabel")}</span>
          <code className="font-mono font-medium text-foreground">{operation.mcpToolName}</code>
        </Link>
      ) : null}

      <span className={BADGE_CLASS_NAME}>
        <span className="text-muted-foreground">{t("operationIdLabel")}</span>
        <code className="font-mono font-medium text-foreground">{operation.operationId}</code>
      </span>
    </div>
  );
}

export async function ApiOperation({ operation }: { operation: OperationView }) {
  const t = await getTranslations("Client.Docs.ApiReference");

  return (
    <article
      id={operation.anchorId}
      {...filterAttributes({
        target: "operation",
        searchText: operation.searchText,
        method: operation.method,
      })}
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-border/70 bg-card/60"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 bg-muted/30 px-5 py-3">
        <ApiMethodBadge method={operation.method} />
        <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">
          {operation.path}
        </code>
        <a
          href={`#${operation.anchorId}`}
          aria-label={t("anchorLabel", { operation: operation.summary })}
          className="text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </a>
      </header>

      <div className="space-y-5 px-5 py-5">
        <div className="space-y-2">
          <h3 className="text-base font-semibold tracking-tight">{operation.summary}</h3>
          {operation.description ? (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {operation.description}
            </p>
          ) : null}
        </div>

        <OperationBadges operation={operation} />

        {operation.parameters.length > 0 ? (
          <OperationSection title={t("parametersLabel")}>
            <ApiParameterFields parameters={operation.parameters} />
          </OperationSection>
        ) : null}

        {operation.requestBody ? (
          <OperationSection title={t("requestBodyLabel")}>
            {operation.requestBody.fields.length > 0 ? (
              <ApiSchemaFields fields={operation.requestBody.fields} variant="request" />
            ) : null}
          </OperationSection>
        ) : null}

        <OperationSection title={t("requestLabel")}>
          <ApiCodeBlock
            label="curl"
            copyValue={operation.curl}
            copyLabel={t("copyRequest")}
          >
            <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground/90">
              <code>{operation.curl}</code>
            </pre>
          </ApiCodeBlock>
        </OperationSection>

        {operation.successResponses.length > 0 ? (
          <OperationSection title={t("responseLabel")}>
            <div className="space-y-4">
              {operation.successResponses.map((response) => (
                <SuccessResponse key={response.status} response={response} />
              ))}
            </div>
          </OperationSection>
        ) : null}

        {operation.errorResponses.length > 0 ? <ErrorResponses operation={operation} /> : null}
      </div>
    </article>
  );
}
