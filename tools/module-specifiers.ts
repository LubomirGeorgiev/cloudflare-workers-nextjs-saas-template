import { isNoSubstitutionTemplateLiteral, isStringLiteral } from "typescript/ast";
import { API } from "typescript/sync";

/**
 * Runs `use` with a reader that lists the module specifiers a file imports, re-exports, `import()`s,
 * `require()`s, or augments with `declare module`. The reader works only inside `use`.
 */
export function withModuleSpecifierReader<T>(use: (readSpecifiers: (file: string) => string[]) => T): T {
  const api = new API();

  try {
    return use((file) => {
      const retained = api.createSourceFileFromFile(file);

      try {
        const { imports, moduleAugmentations } = retained.sourceFile;

        return [...imports, ...moduleAugmentations]
          .filter((node) => isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))
          .map((node) => node.text);
      } finally {
        retained.dispose();
      }
    });
  } finally {
    api.close();
  }
}
