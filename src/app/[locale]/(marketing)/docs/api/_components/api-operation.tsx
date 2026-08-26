import { LinkIcon } from "lucide-react";

import { ApiCodeBlock } from "./api-code-block";
import { ApiJsonPreview } from "./api-json-preview";
import { ApiParameterFields, ApiSchemaFields, type FieldRowLabels } from "./api-schema-fields";
import { filterAttributes, methodStyle } from "./api-reference-dom";
import { API_AUTH_DOCS_PATH, API_ERRORS_DOCS_PATH, MCP_DOCS_PATH } from "@/constants";
import {
  MARKDOWN_DIRECTIVE_ATTRIBUTE,
  MARKDOWN_DIRECTIVES,
} from "@/constants/markdown-directives";
import { Link } from "@/i18n/navigation";
import type { getTranslator } from "@/i18n/translator";
import type { OperationView, ResponseView } from "@/lib/api/reference-model";
import { cn } from "@/lib/utils";

const SKIP_IN_MARKDOWN = {
  [MARKDOWN_DIRECTIVE_ATTRIBUTE]: MARKDOWN_DIRECTIVES.skip,
};

// One fully server-rendered operation. The documented failure statuses collapse into one block
// here; the RFC 9457 problem shape they all share is documented once on the errors page. The page
// builds one label set with `buildApiOperationLabels` and hands it to every operation, so this
// whole subtree renders synchronously and the strings resolve once.

type ApiReferenceTranslator = Awaited<
  ReturnType<typeof getTranslator<"Client.Docs.ApiReference">>
>;

interface CodeBlockLabels {
  example: string;
  copyExample: string;
}

interface OperationBadgeLabels {
  scope: string;
  /** What the scope badge reads for the operation that needs a credential but no scope. */
  anyScope: string;
  anyScopeDescription: string;
  mcpTool: string;
  operationId: string;
}

interface ErrorResponsesLabels {
  heading: string;
  expand: string;
  /** Rich text with a link to the shared error reference, so it arrives already rendered. */
  hint: React.ReactNode;
}

interface ApiOperationLabels {
  code: CodeBlockLabels;
  fields: FieldRowLabels;
  errors: ErrorResponsesLabels;
  badges: OperationBadgeLabels;
  parameters: string;
  requestBody: string;
  request: string;
  copyRequest: string;
  response: string;
  /** Takes the operation summary, so the one label serves every operation on the page. */
  anchor: (summary: string) => string;
}

/** Resolves every string an operation renders. Call once per page, not once per operation. */
export function buildApiOperationLabels(t: ApiReferenceTranslator): ApiOperationLabels {
  const code: CodeBlockLabels = {
    example: t("exampleLabel"),
    copyExample: t("copyExample"),
  };

  return {
    code,
    fields: {
      required: t("required"),
      optional: t("optional"),
      nullable: t("nullable"),
    },
    errors: {
      heading: t("errorResponsesLabel"),
      expand: t("expandLabel"),
      hint: t.rich("errorResponsesHint", {
        errors: (chunks) => (
          <Link href={API_ERRORS_DOCS_PATH} className="underline underline-offset-4">
            {chunks}
          </Link>
        ),
      }),
    },
    badges: {
      scope: t("scopeLabel"),
      anyScope: t("anyScopeLabel"),
      anyScopeDescription: t("anyScopeDescription"),
      mcpTool: t("mcpToolLabel"),
      operationId: t("operationIdLabel"),
    },
    parameters: t("parametersLabel"),
    requestBody: t("requestBodyLabel"),
    request: t("requestLabel"),
    copyRequest: t("copyRequest"),
    response: t("responseLabel"),
    anchor: (summary) => t("anchorLabel", { operation: summary }),
  };
}

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

function SuccessResponse({
  response,
  labels,
  fieldLabels,
}: {
  response: ResponseView;
  labels: CodeBlockLabels;
  fieldLabels: FieldRowLabels;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/25 dark:text-emerald-300 dark:ring-emerald-400/25">
          {response.status}
        </span>
        <span className="text-xs text-muted-foreground">{response.description}</span>
        {response.schema ? (
          <code className="font-mono text-[11px] text-muted-foreground/70">
            {response.schema.contentType} {response.schema.typeLabel}
          </code>
        ) : null}
      </div>

      {response.schema && response.schema.fields.length > 0 ? (
        <ApiSchemaFields fields={response.schema.fields} variant="response" labels={fieldLabels} />
      ) : null}

      {response.schema ? (
        <ApiCodeBlock
          label={labels.example}
          copyValue={JSON.stringify(response.schema.example, null, 2)}
          copyLabel={labels.copyExample}
        >
          <ApiJsonPreview value={response.schema.example} />
        </ApiCodeBlock>
      ) : null}
    </div>
  );
}

function ErrorResponses({
  operation,
  labels,
}: {
  operation: OperationView;
  labels: ErrorResponsesLabels;
}) {
  return (
    <details className="group rounded-lg border border-border/70 bg-background/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <span className="flex flex-wrap items-center gap-2">
          {labels.heading}
          {operation.errorResponses.map((response) => (
            <span key={response.status} className="font-mono text-[11px] text-muted-foreground/70">
              {response.status}
            </span>
          ))}
        </span>
        <span
          {...SKIP_IN_MARKDOWN}
          className="text-[10px] uppercase tracking-wide text-muted-foreground/60 group-open:hidden"
        >
          {labels.expand}
        </span>
      </summary>

      <div {...SKIP_IN_MARKDOWN} className="space-y-3 border-t border-border/60 px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{labels.hint}</p>

        <dl className="space-y-1.5">
          {operation.errorResponses.map((response) => (
            <div key={response.status} className="flex gap-3 text-xs">
              <dt className="w-8 shrink-0 font-mono font-medium text-foreground">{response.status}</dt>
              <dd className="text-muted-foreground">{response.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}

const BADGE_CLASS_NAME =
  "inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2.5 py-1";

/** What the operation costs a credential and what an agent calls it: scope, MCP tool, operationId. */
function OperationBadges({
  operation,
  labels,
}: {
  operation: OperationView;
  labels: OperationBadgeLabels;
}) {
  const scopeTitle = operation.scope ? operation.scopeDescription : labels.anyScopeDescription;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {/* An unscoped operation still demands a credential, so it states that rather than showing
          nothing, which a reader takes for a public endpoint or a broken row. */}
      <Link
        href={API_AUTH_DOCS_PATH}
        title={scopeTitle ?? undefined}
        className={cn(BADGE_CLASS_NAME, "transition-colors hover:border-border hover:bg-muted/40")}
      >
        <span className="text-muted-foreground">{labels.scope}</span>
        {operation.scope ? (
          <code className="font-mono font-medium text-foreground">{operation.scope}</code>
        ) : (
          <span className="font-medium text-foreground">{labels.anyScope}</span>
        )}
      </Link>

      {operation.mcpToolName ? (
        <Link
          href={MCP_DOCS_PATH}
          className={cn(BADGE_CLASS_NAME, "transition-colors hover:border-border hover:bg-muted/40")}
        >
          <span className="text-muted-foreground">{labels.mcpTool}</span>
          <code className="font-mono font-medium text-foreground">{operation.mcpToolName}</code>
        </Link>
      ) : null}

      <span className={BADGE_CLASS_NAME}>
        <span className="text-muted-foreground">{labels.operationId}</span>
        <code className="font-mono font-medium text-foreground">{operation.operationId}</code>
      </span>
    </div>
  );
}

export function ApiOperation({
  operation,
  labels,
}: {
  operation: OperationView;
  labels: ApiOperationLabels;
}) {
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
          {...SKIP_IN_MARKDOWN}
          href={`#${operation.anchorId}`}
          aria-label={labels.anchor(operation.summary)}
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

        <OperationBadges operation={operation} labels={labels.badges} />

        {operation.parameters.length > 0 ? (
          <OperationSection title={labels.parameters}>
            <ApiParameterFields parameters={operation.parameters} labels={labels.fields} />
          </OperationSection>
        ) : null}

        {operation.requestBody ? (
          <OperationSection title={labels.requestBody}>
            <p className="text-[11px] text-muted-foreground">
              <code className="font-mono">{operation.requestBody.contentType}</code>
            </p>
            {operation.requestBody.fields.length > 0 ? (
              <ApiSchemaFields
                fields={operation.requestBody.fields}
                variant="request"
                labels={labels.fields}
              />
            ) : null}
          </OperationSection>
        ) : null}

        <OperationSection title={labels.request}>
          <ApiCodeBlock
            label="curl"
            copyValue={operation.curl}
            copyLabel={labels.copyRequest}
          >
            <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground/90">
              <code>{operation.curl}</code>
            </pre>
          </ApiCodeBlock>
        </OperationSection>

        {operation.successResponses.length > 0 ? (
          <OperationSection title={labels.response}>
            <div className="space-y-4">
              {operation.successResponses.map((response) => (
                <SuccessResponse
                  key={response.status}
                  response={response}
                  labels={labels.code}
                  fieldLabels={labels.fields}
                />
              ))}
            </div>
          </OperationSection>
        ) : null}

        {operation.errorResponses.length > 0 ? (
          <ErrorResponses operation={operation} labels={labels.errors} />
        ) : null}
      </div>
    </article>
  );
}
