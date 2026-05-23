import type { GenericSchema } from "valibot";

export type FieldConfig = {
  name: string;
  label: string;
  type: "string" | "number" | "date" | "textarea" | "boolean" | "select";
  required: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
  options?: Array<{
    label: string;
    value: string;
  }>;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
};

type ValibotSchemaLike = GenericSchema & {
  default?: unknown;
  entries?: Record<string, GenericSchema>;
  options?: readonly unknown[];
  pipe?: readonly ValibotPipeItem[];
  type?: string;
  wrapped?: GenericSchema;
};

type ValibotPipeItem = {
  requirement?: number | RegExp;
  type?: string;
};

export function valibotSchemaToFieldConfigs(schema: GenericSchema): FieldConfig[] {
  const schemaLike = schema as ValibotSchemaLike;

  if (schemaLike.type !== "object" || !schemaLike.entries) {
    return [];
  }

  const fields: FieldConfig[] = [];

  for (const [key, value] of Object.entries(schemaLike.entries)) {
    const field = valibotTypeToFieldConfig(key, value);
    if (field) {
      fields.push(field);
    }
  }

  return fields;
}

function valibotTypeToFieldConfig(name: string, schema: GenericSchema): FieldConfig | null {
  let currentSchema = schema as ValibotSchemaLike;
  let isOptional = false;
  let defaultValue: unknown = undefined;

  while (
    currentSchema.type === "optional" ||
    currentSchema.type === "nullable" ||
    currentSchema.type === "nullish"
  ) {
    if (currentSchema.type === "optional" || currentSchema.type === "nullable" || currentSchema.type === "nullish") {
      isOptional = true;
    }

    if ("default" in currentSchema) {
      defaultValue = getDefaultValue(currentSchema);
    }

    if (!currentSchema.wrapped) {
      break;
    }

    currentSchema = currentSchema.wrapped as ValibotSchemaLike;
  }

  const pipe = currentSchema.pipe ?? [];
  const baseSchema = (pipe[0] as ValibotSchemaLike | undefined) ?? currentSchema;
  const validations = pipe.slice(1);
  const label = name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();

  const baseConfig: Partial<FieldConfig> = {
    name,
    label,
    required: !isOptional,
    defaultValue,
  };

  if (baseSchema.type === "string") {
    const validation: FieldConfig["validation"] = {};

    for (const item of validations) {
      if (item.type === "min_length" && typeof item.requirement === "number") {
        validation.minLength = item.requirement;
      } else if (item.type === "max_length" && typeof item.requirement === "number") {
        validation.maxLength = item.requirement;
      } else if (item.type === "regex" && item.requirement instanceof RegExp) {
        validation.pattern = item.requirement.source;
      }
    }

    const isTextarea = validation.maxLength && validation.maxLength > 100;

    return {
      ...baseConfig,
      type: isTextarea ? "textarea" : "string",
      validation: Object.keys(validation).length > 0 ? validation : undefined,
    } as FieldConfig;
  }

  if (baseSchema.type === "number") {
    const validation: FieldConfig["validation"] = {};

    for (const item of validations) {
      if (item.type === "min_value" && typeof item.requirement === "number") {
        validation.min = item.requirement;
      } else if (item.type === "max_value" && typeof item.requirement === "number") {
        validation.max = item.requirement;
      }
    }

    return {
      ...baseConfig,
      type: "number",
      validation: Object.keys(validation).length > 0 ? validation : undefined,
    } as FieldConfig;
  }

  if (baseSchema.type === "date") {
    return {
      ...baseConfig,
      type: "date",
    } as FieldConfig;
  }

  if (baseSchema.type === "boolean") {
    return {
      ...baseConfig,
      type: "boolean",
    } as FieldConfig;
  }

  if (baseSchema.type === "picklist" && baseSchema.options) {
    return {
      ...baseConfig,
      type: "select",
      options: baseSchema.options.map((option) => {
        const value = String(option);

        return {
          label: value
            .replace(/([A-Z])/g, " $1")
            .replace(/[-_]/g, " ")
            .replace(/^./, (str: string) => str.toUpperCase())
            .trim(),
          value,
        };
      }),
    } as FieldConfig;
  }

  console.warn(`Unsupported Valibot type for field "${name}":`, baseSchema.type);
  return null;
}

function getDefaultValue(schema: ValibotSchemaLike): unknown {
  return typeof schema.default === "function" ? schema.default() : schema.default;
}
