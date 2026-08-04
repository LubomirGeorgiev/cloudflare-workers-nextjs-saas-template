// Mechanizes the closure walk that `docs/worker-hot-path-and-bundle-size.md` describes by hand:
// from an entry the Worker evaluates on every cold isolate, which source modules does it reach by
// *static* import? `import()` is skipped — that is the whole point of moving a cost behind one.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

// `import type` / `export type` are erased before the bundler ever sees them, so they are not edges.
// A lazy `[^;]*?` middle keeps one statement from swallowing the next.
const FROM_IMPORT = /^[ \t]*(?:import|export)[ \t]+(type[ \t]+)?[^;]*?\bfrom[ \t]*["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import[ \t]*["']([^"']+)["']/gm;

const ALIAS_PREFIX = "@/";
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];

export interface ImportClosure {
  /** Repo-relative paths of every source module evaluated at startup, including the entry. */
  modules: ReadonlySet<string>;
  /** Bare specifiers the closure reaches — packages, `next/*`, `virtual:*`, `cloudflare:*`. */
  packages: ReadonlySet<string>;
}

export function collectStaticImportClosure({
  entries,
  repoRoot,
}: {
  entries: readonly string[];
  repoRoot: string;
}): ImportClosure {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const queue = entries.map((entry) => resolve(repoRoot, entry));

  while (queue.length > 0) {
    const file = queue.pop() as string;
    const relativePath = relative(repoRoot, file);
    if (modules.has(relativePath)) {
      continue;
    }
    modules.add(relativePath);

    if (file.endsWith(".json")) {
      continue;
    }

    for (const specifier of readStaticSpecifiers(file)) {
      if (!specifier.startsWith(".") && !specifier.startsWith(ALIAS_PREFIX)) {
        packages.add(specifier);
        continue;
      }

      const resolved = resolveSpecifier({ file, repoRoot, specifier });
      if (resolved === null) {
        throw new Error(`Unresolvable static import "${specifier}" from ${relativePath}`);
      }

      queue.push(resolved);
    }
  }

  return { modules, packages };
}

function readStaticSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];

  for (const match of source.matchAll(FROM_IMPORT)) {
    if (match[1] === undefined) {
      specifiers.push(match[2]);
    }
  }

  for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

function resolveSpecifier({
  file,
  repoRoot,
  specifier,
}: {
  file: string;
  repoRoot: string;
  specifier: string;
}): string | null {
  const base = specifier.startsWith(ALIAS_PREFIX)
    ? resolve(repoRoot, "src", specifier.slice(ALIAS_PREFIX.length))
    : resolve(dirname(file), specifier);

  const candidates = [
    ...(isFile(base) ? [base] : []),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];

  return candidates.find(isFile) ?? null;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}
