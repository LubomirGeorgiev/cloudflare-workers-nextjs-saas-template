import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test, vi } from "vitest";

import { translateValidationKey } from "./validation-messages";

describe("translateValidationKey", () => {
  test("translates a keyed message with encoded params", () => {
    const fakeT = vi.fn(() => "Must be at least 6 characters");

    const result = translateValidationKey(fakeT, 'Validation.minLength {"min":6}');

    expect(fakeT).toHaveBeenCalledWith("minLength", { min: 6 });
    expect(result).toBe("Must be at least 6 characters");
  });

  test("translates a keyed message without params", () => {
    const fakeT = vi.fn(() => "This field is required");

    const result = translateValidationKey(fakeT, "Validation.required");

    expect(fakeT).toHaveBeenCalledWith("required", undefined);
    expect(result).toBe("This field is required");
  });

  test("returns non-keyed raw messages unchanged", () => {
    const fakeT = vi.fn();

    const result = translateValidationKey(fakeT, "Some raw text");

    expect(fakeT).not.toHaveBeenCalled();
    expect(result).toBe("Some raw text");
  });

  test("returns undefined input unchanged", () => {
    const fakeT = vi.fn();

    const result = translateValidationKey(fakeT, undefined);

    expect(fakeT).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe("schema validation messages", () => {
  test("do not hard-code bare validation message keys", () => {
    const schemasDirectory = fileURLToPath(new URL("../schemas", import.meta.url));
    const schemaFiles = listSchemaFiles(schemasDirectory);
    const violations = schemaFiles.flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");

      return [...source.matchAll(/["']Validation\./g)].map((match) =>
        `${relative(schemasDirectory, filePath)}:${lineNumberForIndex(source, match.index ?? 0)}`
      );
    });

    expect(violations).toEqual([]);
  });

  test("do not pass raw English copy as Valibot validation messages", () => {
    const sourceDirectory = fileURLToPath(new URL("..", import.meta.url));
    const sourceFiles = listSourceFiles(sourceDirectory).filter((filePath) =>
      shouldCheckPublicValidationMessages({ filePath, sourceDirectory })
    );
    const rawMessagePatterns = [
      /\b(?:requiredString|emailString|minString|maxString)\([^)]*["'][A-Z][^"']*[a-z][^"']*["']/,
      /\bv\.(?:string|number|boolean|date|custom|url)\([^)]*["'][A-Z][^"']*[a-z][^"']*["']/,
      /\bv\.(?:minLength|maxLength|minValue|maxValue)\([^)]*,\s*["'][A-Z][^"']*[a-z][^"']*["']/,
      /^\s*},\s*["'][A-Z][^"']*[a-z][^"']*["']/,
    ];

    const violations = sourceFiles.flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");

      return source.split("\n").flatMap((line, index) =>
        rawMessagePatterns.some((pattern) => pattern.test(line))
          ? [`${relative(sourceDirectory, filePath)}:${index + 1}`]
          : []
      );
    });

    expect(violations).toEqual([]);
  });
});

function listSchemaFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listSchemaFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith(".schema.ts") ? [entryPath] : [];
  });
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }

    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

function shouldCheckPublicValidationMessages({
  filePath,
  sourceDirectory,
}: {
  filePath: string;
  sourceDirectory: string;
}) {
  const relativePath = relative(sourceDirectory, filePath);

  if (relativePath.startsWith("app/(admin)/")) {
    return false;
  }

  if (relativePath === "actions/upload-image.action.ts") {
    return false;
  }

  return true;
}

function lineNumberForIndex(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}
