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

  test("referenced validation message keys exist in every locale", () => {
    const sourceDirectory = fileURLToPath(new URL("..", import.meta.url));
    const messagesDirectory = fileURLToPath(new URL("../i18n/messages", import.meta.url));
    const validationKeys = new Set(
      listSourceFiles(sourceDirectory).flatMap((filePath) => {
        const source = readFileSync(filePath, "utf8");

        return [...source.matchAll(/\b(?:validationKey|encodeValidationMessage)\(\s*["']([^"']+)["']/g)].map(
          (match) => match[1]
        );
      })
    );
    const missingKeys = listMessageFiles(messagesDirectory).flatMap((filePath) => {
      const messages = JSON.parse(readFileSync(filePath, "utf8")) as {
        Client?: { Validation?: Record<string, string> };
      };
      const localizedKeys = new Set(Object.keys(messages.Client?.Validation ?? {}));

      return [...validationKeys]
        .filter((key) => !localizedKeys.has(key))
        .map((key) => `${relative(messagesDirectory, filePath)}:${key}`);
    });

    expect(missingKeys).toEqual([]);
  });
});

function listSchemaFiles(directory: string): string[] {
  return listFiles(directory, (fileName) => fileName.endsWith(".schema.ts"));
}

function listSourceFiles(directory: string): string[] {
  return listFiles(directory, (fileName) => /\.(?:ts|tsx)$/.test(fileName));
}

function listMessageFiles(directory: string): string[] {
  return listFiles(directory, (fileName) => fileName.endsWith(".json"));
}

function listFiles(directory: string, shouldInclude: (fileName: string) => boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listFiles(entryPath, shouldInclude);
    }

    return entry.isFile() && shouldInclude(entry.name) ? [entryPath] : [];
  });
}

function lineNumberForIndex(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}
