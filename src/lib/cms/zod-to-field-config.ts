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
      currentType = currentType._def.innerType;
    } else {
      defaultValue = currentType._def.defaultValue();
      currentType = currentType._def.innerType;
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
      options: currentType.options.map((option: string) => ({
        label: option
          .replace(/([A-Z])/g, " $1")
          .replace(/[-_]/g, " ")
          .replace(/^./, (str: string) => str.toUpperCase())
          .trim(),
        value: option,
      })),
    } as FieldConfig;
  }

  // Unsupported type
  console.warn(`Unsupported Zod type for field "${name}":`, currentType.constructor.name);
  return null;
}
