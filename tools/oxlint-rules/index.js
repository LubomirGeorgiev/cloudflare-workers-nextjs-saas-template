import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const RULE_NAME = "no-unused-module-exports"
const RECORD_SEPARATOR = "\0"

// Next/Vinext read these exports by convention, so they are live without imports.
const DEFAULT_IGNORE_EXPORTS = [
  "default",
  "metadata",
  "viewport",
  "generateMetadata",
  "generateViewport",
  "generateStaticParams",
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "config",
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "middleware",
]

const DEFAULT_IGNORE_FILE_PATTERNS = [
  String.raw`(?:^|/)node_modules/`,
  String.raw`(?:^|/)(?:next-env|worker-configuration)\.d\.ts$`,
  String.raw`(?:^|/)src/db/migrations/`,
]

const DEFAULT_OPTIONS = {
  project: "./tsconfig.json",
  ignoreExports: DEFAULT_IGNORE_EXPORTS,
  ignoreExportPatterns: [],
  ignoreFilePatterns: DEFAULT_IGNORE_FILE_PATTERNS,
}

const analysisCache = new Map()

function normalizePath(filePath) {
  return path.resolve(filePath).replaceAll(path.sep, "/")
}

function toRelativePath(filePath, rootDir) {
  return path.relative(rootDir, filePath).replaceAll(path.sep, "/")
}

function compilePatterns(patterns) {
  return patterns.map((pattern) => new RegExp(pattern))
}

function getRuleOptions(rawOptions) {
  const rootDir = normalizePath(rawOptions?.rootDir ?? process.cwd())
  const ignoreExports = new Set([
    ...DEFAULT_IGNORE_EXPORTS,
    ...(rawOptions?.ignoreExports ?? []),
  ])

  return {
    project: rawOptions?.project ?? DEFAULT_OPTIONS.project,
    rootDir,
    ignoreExports,
    ignoreExportPatterns: compilePatterns([
      ...DEFAULT_OPTIONS.ignoreExportPatterns,
      ...(rawOptions?.ignoreExportPatterns ?? []),
    ]),
    ignoreFilePatterns: compilePatterns([
      ...DEFAULT_IGNORE_FILE_PATTERNS,
      ...(rawOptions?.ignoreFilePatterns ?? []),
    ]),
  }
}

function shouldIgnoreExport(name, options) {
  if (options.ignoreExports.has(name)) {
    return true
  }

  return options.ignoreExportPatterns.some((pattern) => pattern.test(name))
}

function shouldIgnoreFile(filePath, options) {
  const relativePath = toRelativePath(filePath, options.rootDir)

  return options.ignoreFilePatterns.some(
    (pattern) => pattern.test(relativePath) || pattern.test(filePath),
  )
}

function getCacheKey(options) {
  return JSON.stringify({
    project: options.project,
    rootDir: options.rootDir,
    ignoreExports: [...options.ignoreExports].sort(),
    ignoreExportPatterns: options.ignoreExportPatterns.map((pattern) => pattern.source),
    ignoreFilePatterns: options.ignoreFilePatterns.map((pattern) => pattern.source),
  })
}

function readTsConfig(options) {
  const projectPath = normalizePath(path.resolve(options.rootDir, options.project))
  const configFile = ts.readConfigFile(projectPath, ts.sys.readFile)

  if (configFile.error) {
    throw new Error(formatTypeScriptDiagnostic(configFile.error))
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(projectPath),
    undefined,
    projectPath,
  )

  if (parsedConfig.errors.length > 0) {
    throw new Error(parsedConfig.errors.map(formatTypeScriptDiagnostic).join("\n"))
  }

  return parsedConfig
}

function formatTypeScriptDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
}

function createExportRecord({ fileName, name }) {
  return `${fileName}${RECORD_SEPARATOR}${name}`
}

function parseExportRecord(record) {
  const separatorIndex = record.indexOf(RECORD_SEPARATOR)

  return {
    fileName: record.slice(0, separatorIndex),
    name: record.slice(separatorIndex + 1),
  }
}

function addExport(exportsByFile, fileName, name, options) {
  if (shouldIgnoreExport(name, options)) {
    return
  }

  const exports = exportsByFile.get(fileName) ?? new Set()
  exports.add(name)
  exportsByFile.set(fileName, exports)
}

function addEdge(edges, fromFile, fromName, toFile, toName) {
  const fromRecord = createExportRecord({ fileName: fromFile, name: fromName })
  const targets = edges.get(fromRecord) ?? []

  targets.push({ fileName: toFile, name: toName })
  edges.set(fromRecord, targets)
}

function collectBindingNames(name, names = []) {
  if (ts.isIdentifier(name)) {
    names.push(name.text)
    return names
  }

  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        collectBindingNames(element.name, names)
      }
    }
  }

  return names
}

function getDeclarationExportNames(declaration) {
  if (ts.isVariableStatement(declaration)) {
    return declaration.declarationList.declarations.flatMap((item) =>
      collectBindingNames(item.name),
    )
  }

  if (
    (ts.isFunctionDeclaration(declaration) ||
      ts.isClassDeclaration(declaration) ||
      ts.isInterfaceDeclaration(declaration) ||
      ts.isTypeAliasDeclaration(declaration) ||
      ts.isEnumDeclaration(declaration) ||
      ts.isModuleDeclaration(declaration)) &&
    declaration.name
  ) {
    return [declaration.name.text]
  }

  return []
}

function hasExportModifier(node) {
  return ts
    .getModifiers(node)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
}

function hasDefaultModifier(node) {
  return ts
    .getModifiers(node)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
}

function getExportedName(specifier) {
  return (specifier.propertyName ?? specifier.name).text
}

function getReExportedName(specifier) {
  return specifier.name.text
}

function isImportLikeCall(node, name) {
  return (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    ((name === "import" && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
      (name === "require" &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"))
  )
}

function getModuleSpecifierText(node) {
  return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : undefined
}

function createModuleResolver(compilerOptions, internalFiles) {
  const moduleResolutionHost = ts.createCompilerHost(compilerOptions, true)
  const moduleResolutionCache = ts.createModuleResolutionCache(
    process.cwd(),
    normalizePath,
    compilerOptions,
  )

  return function resolveModule(specifier, containingFile) {
    const resolution = ts.resolveModuleName(
      specifier,
      containingFile,
      compilerOptions,
      moduleResolutionHost,
      moduleResolutionCache,
    )

    const resolvedModule = resolution.resolvedModule

    if (!resolvedModule || resolvedModule.isExternalLibraryImport) {
      return undefined
    }

    const resolvedFileName = normalizePath(resolvedModule.resolvedFileName)

    if (!internalFiles.has(resolvedFileName)) {
      return undefined
    }

    return resolvedFileName
  }
}

function createUsageMarker({ exportsByFile, edges, starEdges, usedExports }) {
  const pending = []

  function markAllExports(fileName) {
    const fileExports = exportsByFile.get(fileName)

    if (!fileExports) {
      return
    }

    for (const name of fileExports) {
      markUsed(fileName, name)
    }
  }

  function markUsed(fileName, name) {
    if (name === "*") {
      markAllExports(fileName)
      return
    }

    const record = createExportRecord({ fileName, name })

    if (usedExports.has(record)) {
      return
    }

    usedExports.add(record)
    pending.push(record)

    while (pending.length > 0) {
      const currentRecord = pending.shift()
      const current = parseExportRecord(currentRecord)

      for (const target of edges.get(currentRecord) ?? []) {
        markUsed(target.fileName, target.name)
      }

      for (const targetFile of starEdges.get(current.fileName) ?? []) {
        const targetExports = exportsByFile.get(targetFile)

        if (targetExports?.has(current.name)) {
          markUsed(targetFile, current.name)
        }
      }
    }
  }

  return { markAllExports, markUsed }
}

function collectExports(sourceFile, resolveModule, analysis, options) {
  const fileName = normalizePath(sourceFile.fileName)

  sourceFile.forEachChild((node) => {
    if (hasExportModifier(node) && !hasDefaultModifier(node)) {
      for (const name of getDeclarationExportNames(node)) {
        addExport(analysis.exportsByFile, fileName, name, options)
      }
    }

    if (hasExportModifier(node) && hasDefaultModifier(node)) {
      addExport(analysis.exportsByFile, fileName, "default", options)
    }

    if (!ts.isExportDeclaration(node)) {
      return
    }

    const moduleSpecifier = getModuleSpecifierText(node)
    const targetFile = moduleSpecifier
      ? resolveModule(moduleSpecifier, fileName)
      : undefined

    if (!node.exportClause) {
      if (targetFile) {
        const starTargets = analysis.starEdges.get(fileName) ?? new Set()
        starTargets.add(targetFile)
        analysis.starEdges.set(fileName, starTargets)
      }

      return
    }

    if (ts.isNamespaceExport(node.exportClause)) {
      const exportedName = node.exportClause.name.text
      addExport(analysis.exportsByFile, fileName, exportedName, options)

      if (targetFile) {
        addEdge(analysis.edges, fileName, exportedName, targetFile, "*")
      }

      return
    }

    for (const specifier of node.exportClause.elements) {
      const exportedName = getReExportedName(specifier)
      addExport(analysis.exportsByFile, fileName, exportedName, options)

      if (targetFile) {
        addEdge(
          analysis.edges,
          fileName,
          exportedName,
          targetFile,
          getExportedName(specifier),
        )
      }
    }
  })
}

function collectImportUsage(sourceFile, resolveModule, usage) {
  const fileName = normalizePath(sourceFile.fileName)

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = getModuleSpecifierText(node)
      const targetFile = moduleSpecifier
        ? resolveModule(moduleSpecifier, fileName)
        : undefined

      if (targetFile && node.importClause) {
        if (node.importClause.name) {
          usage.markUsed(targetFile, "default")
        }

        if (node.importClause.namedBindings) {
          if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            usage.markAllExports(targetFile)
          } else {
            for (const specifier of node.importClause.namedBindings.elements) {
              usage.markUsed(
                targetFile,
                (specifier.propertyName ?? specifier.name).text,
              )
            }
          }
        }
      }
    }

    if (isImportLikeCall(node, "import")) {
      const targetFile = resolveModule(node.arguments[0].text, fileName)

      if (targetFile) {
        usage.markAllExports(targetFile)
      }
    }

    if (isImportLikeCall(node, "require")) {
      const targetFile = resolveModule(node.arguments[0].text, fileName)

      if (targetFile) {
        if (
          ts.isVariableDeclaration(node.parent) &&
          ts.isObjectBindingPattern(node.parent.name)
        ) {
          for (const element of node.parent.name.elements) {
            if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) {
              continue
            }

            const importName =
              element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text

            usage.markUsed(targetFile, importName)
          }
        } else {
          usage.markAllExports(targetFile)
        }
      }
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      const targetFile = resolveModule(node.argument.literal.text, fileName)

      if (targetFile && node.qualifier && ts.isIdentifier(node.qualifier)) {
        usage.markUsed(targetFile, node.qualifier.text)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

function analyzeProject(rawOptions) {
  const options = getRuleOptions(rawOptions)
  const cacheKey = getCacheKey(options)
  const cachedAnalysis = analysisCache.get(cacheKey)

  if (cachedAnalysis) {
    return cachedAnalysis
  }

  const parsedConfig = readTsConfig(options)
  const internalFiles = new Set(
    parsedConfig.fileNames
      .map(normalizePath)
      .filter((fileName) => !fileName.endsWith(".d.ts"))
      .filter((fileName) => fs.existsSync(fileName))
      .filter((fileName) => !shouldIgnoreFile(fileName, options)),
  )
  const program = ts.createProgram({
    rootNames: [...internalFiles],
    options: parsedConfig.options,
  })
  const resolveModule = createModuleResolver(parsedConfig.options, internalFiles)
  const sourceFiles = program
    .getSourceFiles()
    .filter((sourceFile) => internalFiles.has(normalizePath(sourceFile.fileName)))
  const analysis = {
    edges: new Map(),
    exportsByFile: new Map(),
    starEdges: new Map(),
    unusedExportsByFile: new Map(),
    usedExports: new Set(),
  }

  // Build the export graph first, then mark imports as live and propagate through barrels.
  for (const sourceFile of sourceFiles) {
    collectExports(sourceFile, resolveModule, analysis, options)
  }

  const usage = createUsageMarker(analysis)

  for (const sourceFile of sourceFiles) {
    collectImportUsage(sourceFile, resolveModule, usage)
  }

  for (const [fileName, exportNames] of analysis.exportsByFile) {
    for (const name of exportNames) {
      const record = createExportRecord({ fileName, name })

      if (analysis.usedExports.has(record)) {
        continue
      }

      const unusedExports = analysis.unusedExportsByFile.get(fileName) ?? new Set()
      unusedExports.add(name)
      analysis.unusedExportsByFile.set(fileName, unusedExports)
    }
  }

  analysisCache.set(cacheKey, analysis)

  return analysis
}

function getExportedNamesFromDeclaration(declaration) {
  if (!declaration) {
    return []
  }

  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.flatMap((item) => getBindingNames(item.id))
  }

  const id = declaration.id

  return id?.name ? [{ name: id.name, node: id }] : []
}

function getBindingNames(node) {
  if (!node) {
    return []
  }

  if (node.type === "Identifier") {
    return [{ name: node.name, node }]
  }

  if (node.type === "ObjectPattern" || node.type === "ArrayPattern") {
    const elements = node.properties ?? node.elements ?? []

    return elements.flatMap((element) => {
      if (!element) {
        return []
      }

      if (element.type === "Property") {
        return getBindingNames(element.value)
      }

      if (element.type === "RestElement") {
        return getBindingNames(element.argument)
      }

      return getBindingNames(element)
    })
  }

  return []
}

function getExportSpecifierName(specifier) {
  const exported = specifier.exported

  if (!exported) {
    return undefined
  }

  if (exported.type === "Identifier") {
    return exported.name
  }

  if (exported.type === "Literal") {
    return String(exported.value)
  }

  return undefined
}

function reportUnusedExport(context, unusedExports, reportedExports, name, node) {
  if (!unusedExports.has(name) || reportedExports.has(name)) {
    return
  }

  reportedExports.add(name)

  context.report({
    node,
    message: `Export "${name}" is never imported by another module. Remove the export or keep the symbol file-local.`,
  })
}

const noUnusedModuleExportsRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow module exports that are not imported elsewhere.",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          project: { type: "string" },
          rootDir: { type: "string" },
          ignoreExports: {
            type: "array",
            items: { type: "string" },
          },
          ignoreExportPatterns: {
            type: "array",
            items: { type: "string" },
          },
          ignoreFilePatterns: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    ],
  },
  create(context) {
    const analysis = analyzeProject(context.options?.[0])
    const fileName = normalizePath(context.filename)
    const unusedExports = analysis.unusedExportsByFile.get(fileName)
    const reportedExports = new Set()

    if (!unusedExports) {
      return {}
    }

    return {
      ExportDefaultDeclaration(node) {
        reportUnusedExport(
          context,
          unusedExports,
          reportedExports,
          "default",
          node.declaration ?? node,
        )
      },
      ExportNamedDeclaration(node) {
        for (const item of getExportedNamesFromDeclaration(node.declaration)) {
          reportUnusedExport(
            context,
            unusedExports,
            reportedExports,
            item.name,
            item.node,
          )
        }

        for (const specifier of node.specifiers ?? []) {
          const name = getExportSpecifierName(specifier)

          if (!name) {
            continue
          }

          reportUnusedExport(
            context,
            unusedExports,
            reportedExports,
            name,
            specifier.exported ?? specifier,
          )
        }
      },
    }
  },
}

const plugin = {
  meta: {
    name: "project",
  },
  rules: {
    [RULE_NAME]: noUnusedModuleExportsRule,
  },
}

export default plugin
