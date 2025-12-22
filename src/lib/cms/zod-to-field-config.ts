import { z } from "zod";

export type FieldConfig = {
  name: string;
  label: string;
  type: "string" | "number" | "date" | "textarea";
  required: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
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

  // Unwrap optional and default
  if (currentType instanceof z.ZodOptional) {
    isOptional = true;
    currentType = currentType._def.innerType;
  }

  if (currentType instanceof z.ZodDefault) {
    defaultValue = currentType._def.defaultValue();
    currentType = currentType._def.innerType;
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
      if (check.kind === "min") {
        validation.minLength = check.value;
      } else if (check.kind === "max") {
        validation.maxLength = check.value;
      } else if (check.kind === "regex") {
        validation.pattern = check.regex.source;
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
      if (check.kind === "min") {
        validation.min = check.value;
      } else if (check.kind === "max") {
        validation.max = check.value;
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

  // Unsupported type
  console.warn(`Unsupported Zod type for field "${name}":`, currentType.constructor.name);
  return null;
}
