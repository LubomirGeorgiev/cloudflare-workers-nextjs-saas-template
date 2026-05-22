import { z } from "zod";

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

type ZodCheckDef = {
  check?: string;
  format?: string;
  inclusive?: boolean;
  kind?: string;
  maximum?: number;
  minimum?: number;
  pattern?: RegExp;
  regex?: RegExp;
  value?: number;
};

/**
 * Introspects a Zod schema and generates field configurations for form rendering
 * This runs at runtime on the client side
 */
export function zodSchemaToFieldConfigs(schema: z.ZodTypeAny): FieldConfig[] {
  const fields: FieldConfig[] = [];

  // Handle ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;

    for (const [key, value] of Object.entries(shape)) {
      const field = zodTypeToFieldConfig(key, value as z.ZodTypeAny);
      if (field) {
        fields.push(field);
      }
    }
  }

  return fields;
}

function zodTypeToFieldConfig(name: string, zodType: z.ZodTypeAny): FieldConfig | null {
  let currentType = zodType;
  let isOptional = false;
  let defaultValue: unknown = undefined;

  while (
    currentType instanceof z.ZodOptional ||
    currentType instanceof z.ZodNullable ||
    currentType instanceof z.ZodDefault
  ) {
    if (currentType instanceof z.ZodOptional || currentType instanceof z.ZodNullable) {
      isOptional = true;
      currentType = currentType.unwrap() as z.ZodTypeAny;
    } else {
      defaultValue = getDefaultValue(currentType);
      currentType = currentType.unwrap() as z.ZodTypeAny;
    }
  }

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

  // Handle string
  if (currentType instanceof z.ZodString) {
    const checks = currentType._def.checks || [];
    const validation: FieldConfig["validation"] = {};

    for (const check of checks) {
      const checkDef = getCheckDef(check);
      if (checkDef.kind === "min" && typeof checkDef.value === "number") {
        validation.minLength = checkDef.value;
      } else if (checkDef.check === "min_length" && typeof checkDef.minimum === "number") {
        validation.minLength = checkDef.minimum;
      } else if (checkDef.kind === "max" && typeof checkDef.value === "number") {
        validation.maxLength = checkDef.value;
      } else if (checkDef.check === "max_length" && typeof checkDef.maximum === "number") {
        validation.maxLength = checkDef.maximum;
      } else if (checkDef.kind === "regex" && checkDef.regex) {
        validation.pattern = checkDef.regex.source;
      } else if (checkDef.check === "string_format" && checkDef.format === "regex" && checkDef.pattern) {
        validation.pattern = checkDef.pattern.source;
      }
    }

    // Use textarea for longer strings
    const isTextarea = validation.maxLength && validation.maxLength > 100;

    return {
      ...baseConfig,
      type: isTextarea ? "textarea" : "string",
      validation: Object.keys(validation).length > 0 ? validation : undefined,
    } as FieldConfig;
  }

  // Handle number
  if (currentType instanceof z.ZodNumber) {
    const checks = currentType._def.checks || [];
    const validation: FieldConfig["validation"] = {};

    for (const check of checks) {
      const checkDef = getCheckDef(check);
      if (checkDef.kind === "min" && typeof checkDef.value === "number") {
        validation.min = checkDef.value;
      } else if (checkDef.check === "greater_than" && checkDef.inclusive && typeof checkDef.value === "number") {
        validation.min = checkDef.value;
      } else if (checkDef.kind === "max" && typeof checkDef.value === "number") {
        validation.max = checkDef.value;
      } else if (checkDef.check === "less_than" && checkDef.inclusive && typeof checkDef.value === "number") {
        validation.max = checkDef.value;
      }
    }

    return {
      ...baseConfig,
      type: "number",
      validation: Object.keys(validation).length > 0 ? validation : undefined,
    } as FieldConfig;
  }

  // Handle date
  if (currentType instanceof z.ZodDate) {
    return {
      ...baseConfig,
      type: "date",
    } as FieldConfig;
  }

  if (currentType instanceof z.ZodBoolean) {
    return {
      ...baseConfig,
      type: "boolean",
    } as FieldConfig;
  }

  if (currentType instanceof z.ZodEnum) {
    return {
      ...baseConfig,
      type: "select",
      options: currentType.options.map((option) => {
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

  // Unsupported type
  console.warn(`Unsupported Zod type for field "${name}":`, currentType.constructor.name);
  return null;
}

function getCheckDef(check: unknown): ZodCheckDef {
  return ((check as { _zod?: { def?: ZodCheckDef } })._zod?.def ?? check) as ZodCheckDef;
}

function getDefaultValue(schema: z.ZodTypeAny): unknown {
  const defaultValue = (schema as unknown as { _def: { defaultValue: unknown } })._def.defaultValue;

  return typeof defaultValue === "function" ? defaultValue() : defaultValue;
}
