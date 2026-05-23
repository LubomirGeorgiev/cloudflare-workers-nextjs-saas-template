import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import type { Plugin } from "vite";

export function analyzeBundle(): Plugin {
  let count = 0;
  const outputDir = ".bundle-analysis";

  return {
    name: "local-bundle-analyzer",
    apply: "build" as const,
    configResolved() {
      rmSync(outputDir, { recursive: true, force: true });
      mkdirSync(outputDir, { recursive: true });
    },
    generateBundle(options, bundle) {
      count += 1;
      const pluginContext = this as { environment?: { name?: string } };
      const environmentName =
        pluginContext.environment?.name ?? options.dir?.split("/").at(-1) ?? "build";

      const chunks = Object.values(bundle)
        .filter((item) => item.type === "chunk")
        .map((chunk) => {
          const code = chunk.code ?? "";
          const modules = Object.entries(chunk.modules ?? {})
            .map(([id, module]) => {
              const bundleModule = module as {
                renderedLength?: number;
                originalLength?: number;
              };

              return {
                id,
                renderedLength: bundleModule.renderedLength ?? 0,
                originalLength: bundleModule.originalLength ?? 0,
              };
            })
            .sort((left, right) => right.renderedLength - left.renderedLength);

          return {
            fileName: chunk.fileName,
            isEntry: chunk.isEntry,
            isDynamicEntry: chunk.isDynamicEntry,
            size: Buffer.byteLength(code),
            gzipSize: gzipSync(code).byteLength,
            brotliSize: brotliCompressSync(code).byteLength,
            imports: chunk.imports,
            dynamicImports: chunk.dynamicImports,
            modules,
          };
        })
        .sort((left, right) => right.size - left.size);

      const assets = Object.values(bundle)
        .filter((item) => item.type === "asset")
        .map((asset) => {
          const source =
            typeof asset.source === "string"
              ? asset.source
              : Buffer.from(asset.source);

          return {
            fileName: asset.fileName,
            size: Buffer.byteLength(source),
            gzipSize: gzipSync(source).byteLength,
            brotliSize: brotliCompressSync(source).byteLength,
          };
        })
        .sort((left, right) => right.size - left.size);

      writeFileSync(
        join(outputDir, `${String(count).padStart(2, "0")}-${environmentName}.json`),
        JSON.stringify({ environmentName, chunks, assets }, null, 2),
      );
    },
  };
}
