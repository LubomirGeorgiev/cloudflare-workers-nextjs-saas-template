"use client";

import React from "react";
import { useFormContext } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FieldConfig } from "@/lib/cms/zod-to-field-config";

type CmsDynamicFieldProps = {
  field: FieldConfig;
};

export function CmsDynamicField({ field }: CmsDynamicFieldProps) {
  const form = useFormContext();

  const renderFieldInput = (fieldProps: { onChange: (value: unknown) => void; value: unknown }) => {
    switch (field.type) {
      case "string":
        return (
          <Input
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            value={(fieldProps.value as string) || ""}
            onChange={(e) => fieldProps.onChange(e.target.value)}
            minLength={field.validation?.minLength}
            maxLength={field.validation?.maxLength}
            pattern={field.validation?.pattern}
          />
        );

      case "textarea":
        return (
          <Textarea
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            value={(fieldProps.value as string) || ""}
            onChange={(e) => fieldProps.onChange(e.target.value)}
            minLength={field.validation?.minLength}
            maxLength={field.validation?.maxLength}
            rows={4}
          />
        );

      case "number":
        return (
          <Input
            type="number"
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            value={(fieldProps.value as number) || ""}
            onChange={(e) => fieldProps.onChange(e.target.value)}
            min={field.validation?.min}
            max={field.validation?.max}
          />
        );

      case "date":
        return (
          <Input
            type="date"
            value={fieldProps.value ? new Date(fieldProps.value as string).toISOString().split("T")[0] : ""}
            onChange={(e) => fieldProps.onChange(e.target.value)}
          />
        );

      default:
        return (
          <Input
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            value={(fieldProps.value as string) || ""}
            onChange={(e) => fieldProps.onChange(e.target.value)}
          />
        );
    }
  };

  return (
    <FormField
      control={form.control}
      name={`fields.${field.name}`}
      render={({ field: fieldProps }) => (
        <FormItem>
          <FormLabel>
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </FormLabel>
          <FormControl>{renderFieldInput(fieldProps)}</FormControl>
          {field.description && <FormDescription>{field.description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
