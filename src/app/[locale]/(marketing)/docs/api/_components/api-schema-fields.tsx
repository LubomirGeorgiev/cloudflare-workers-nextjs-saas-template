import type { ReactNode } from "react";

import type { ParameterView, SchemaFieldView } from "@/lib/api/reference-model";
import { cn } from "@/lib/utils";

// One row per documented field. Rows, not a table: a schema nests, and an indented row reads as
// nesting where a table cell does not. Type names, constraints, and enum values are contract
// vocabulary and stay untranslated — only the requiredness chips are localized, resolved once per
// operation by the caller rather than per row.

/** Matches MAX_FIELD_DEPTH in the view model; deeper shapes only appear in the JSON example. */
const INDENT_BY_DEPTH = ["pl-0", "pl-4", "pl-8"] as const;

export interface FieldRowLabels {
  required: string;
  optional: string;
  nullable: string;
}

/** In a request "required" is an instruction to the caller; in a response it is just a guarantee. */
const REQUIRED_STYLES = {
  request: "text-amber-700 dark:text-amber-400",
  response: "text-muted-foreground",
} as const;

type FieldRowVariant = keyof typeof REQUIRED_STYLES;

function FieldChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-4 text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function RequirementLabel({
  field,
  labels,
  variant,
}: {
  field: SchemaFieldView;
  labels: FieldRowLabels;
  variant: FieldRowVariant;
}) {
  if (!field.required) {
    return (
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {labels.optional}
      </span>
    );
  }

  return (
    <span className={cn("text-[10px] font-medium uppercase tracking-wide", REQUIRED_STYLES[variant])}>
      {labels.required}
    </span>
  );
}

function EnumValues({ values }: { values: string[] }) {
  if (values.length === 0) {
    return null;
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {values.map((value) => (
        <FieldChip key={value} className="bg-primary/5 text-foreground/70">
          {value}
        </FieldChip>
      ))}
    </div>
  );
}

function FieldRow({
  field,
  labels,
  variant,
}: {
  field: SchemaFieldView;
  labels: FieldRowLabels;
  variant: FieldRowVariant;
}) {
  const { name, typeLabel, nullable, description, constraints, enumValues, depth } = field;

  return (
    <div
      className={cn(
        "border-t border-border/60 py-2.5 first:border-t-0",
        INDENT_BY_DEPTH[Math.min(depth, INDENT_BY_DEPTH.length - 1)],
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <code className="font-mono text-xs font-medium text-foreground">{name}</code>
        <span className="font-mono text-[11px] text-muted-foreground">{typeLabel}</span>
        <RequirementLabel field={field} labels={labels} variant={variant} />
        {nullable ? <FieldChip>{labels.nullable}</FieldChip> : null}
        {constraints.map((constraint) => (
          <FieldChip key={constraint}>{constraint}</FieldChip>
        ))}
      </div>

      {description ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}

      <EnumValues values={enumValues} />
    </div>
  );
}

function FieldList({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border/70 bg-background/60 px-4">{children}</div>;
}

export function ApiSchemaFields({
  fields,
  variant,
  labels,
}: {
  fields: SchemaFieldView[];
  variant: FieldRowVariant;
  labels: FieldRowLabels;
}) {
  return (
    <FieldList>
      {fields.map((field) => (
        <FieldRow key={field.key} field={field} labels={labels} variant={variant} />
      ))}
    </FieldList>
  );
}

/** A parameter is a field with a location, so it renders as one rather than as a second row type. */
function toFieldView(parameter: ParameterView): SchemaFieldView {
  return {
    key: `${parameter.location}-${parameter.name}`,
    name: parameter.name,
    depth: 0,
    typeLabel: parameter.typeLabel,
    required: parameter.required,
    nullable: false,
    description: parameter.description,
    // The location is the one thing a parameter has and a body field does not.
    constraints: [`in: ${parameter.location}`, ...parameter.constraints],
    enumValues: [],
  };
}

export function ApiParameterFields({
  parameters,
  labels,
}: {
  parameters: ParameterView[];
  labels: FieldRowLabels;
}) {
  return (
    <FieldList>
      {parameters.map(toFieldView).map((field) => (
        <FieldRow key={field.key} field={field} labels={labels} variant="request" />
      ))}
    </FieldList>
  );
}
