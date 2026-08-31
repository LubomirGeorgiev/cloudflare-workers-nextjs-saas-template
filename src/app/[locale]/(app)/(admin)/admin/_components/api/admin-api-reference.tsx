import {
  ApiParameterFields,
  ApiSchemaFields,
  type FieldRowLabels,
} from "@/app/[locale]/(marketing)/docs/api/_components/api-schema-fields";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiReferenceView, OperationView } from "@/lib/api/reference-model";

// A compact, fully server-rendered reference for the internal surface, built from the same view
// model the public `/docs/api` page uses. Deliberately not the public page's operation component:
// that one is bound to the marketing docs' translated label set and links out to public docs pages,
// none of which exist for this surface. Staff need the contract, not a landing page.
//
// The field rows are the public ones, because a row is where the contract actually is: an internal
// operation that documents less than a public one is the failure this page exists to prevent. They
// take their labels as props, so reusing them pulls in no translated string.

// Staff tooling, so the labels are literal English like the rest of the admin subtree.
const FIELD_LABELS: FieldRowLabels = {
  required: "Required",
  optional: "Optional",
  nullable: "Nullable",
};

// One step below `text-xs`, matching the scope tokens in `src/components/api-scope-grid.tsx`, so a
// monospace identifier sits on the same optical line as the prose beside it.
const IDENTIFIER_TEXT = "font-mono text-[11px]";

/** Tailwind classes per HTTP method, so a destructive operation reads as one at a glance. */
const METHOD_STYLE: Record<string, string> = {
  GET: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  POST: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  PUT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PATCH: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  DELETE: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function OperationSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

/** Everything the caller sends: path, query, and header parameters, then the body. */
function OperationRequest({ operation }: { operation: OperationView }) {
  return (
    <>
      {operation.parameters.length > 0 ? (
        <OperationSection title="Parameters">
          <ApiParameterFields parameters={operation.parameters} labels={FIELD_LABELS} />
        </OperationSection>
      ) : null}

      {operation.requestBody ? (
        <OperationSection title="Request body">
          <p className={`${IDENTIFIER_TEXT} text-muted-foreground`}>
            {operation.requestBody.contentType} {operation.requestBody.typeLabel}
          </p>
          {operation.requestBody.fields.length > 0 ? (
            <ApiSchemaFields
              fields={operation.requestBody.fields}
              variant="request"
              labels={FIELD_LABELS}
            />
          ) : null}
        </OperationSection>
      ) : null}
    </>
  );
}

export function AdminApiReference({
  view,
  mcpToolNames,
}: {
  view: ApiReferenceView;
  /** operationId -> internal MCP tool name, passed in so this never imports the MCP package. */
  mcpToolNames: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      {view.groups.map((group) => (
        <Card key={group.name}>
          <CardHeader>
            <CardTitle>{group.name}</CardTitle>
            <CardDescription>
              {group.operations.length} operation{group.operations.length === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {group.operations.map((operation) => (
              <div key={operation.operationId} className="space-y-3 border-b pb-5 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 font-semibold ${IDENTIFIER_TEXT} ${
                      METHOD_STYLE[operation.method] ?? "bg-muted text-muted-foreground"
                    }`}
                  >
                    {operation.method}
                  </span>
                  <code className="font-mono text-xs break-all">{operation.path}</code>
                </div>

                <p className="text-sm text-muted-foreground">{operation.description}</p>

                <div className="flex flex-wrap items-center gap-2">
                  {operation.scope ? (
                    <Badge variant="outline" className={IDENTIFIER_TEXT}>
                      {operation.scope}
                    </Badge>
                  ) : null}
                  <Badge variant="secondary" className={IDENTIFIER_TEXT}>
                    {operation.operationId}
                  </Badge>
                  {mcpToolNames[operation.operationId] ? (
                    <Badge variant="secondary" className={IDENTIFIER_TEXT}>
                      MCP: {mcpToolNames[operation.operationId]}
                    </Badge>
                  ) : null}
                </div>

                <OperationRequest operation={operation} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
