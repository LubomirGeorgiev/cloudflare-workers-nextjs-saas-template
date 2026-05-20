import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const RECORD_SEPARATOR = "\0"
const EXPORT_KIND_TYPE = 1
const EXPORT_KIND_VALUE = 2
const EXPORT_KIND_BOTH = EXPORT_KIND_TYPE | EXPORT_KIND_VALUE

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

function getFileMtime(fileName) {
  try {
    return fs.statSync(fileName).mtimeMs
  } catch {
    return undefined
  }
}

function isCachedAnalysisStale(cachedAnalysis, currentFileName) {
  if (!currentFileName) {
    return false
  }

  if (!cachedAnalysis.fileMtimes.has(currentFileName)) {
    return false
  }

  return cachedAnalysis.fileMtimes.get(currentFileName) !== getFileMtime(currentFileName)
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

function mergeExportKind(currentKind, nextKind) {
  return (currentKind ?? 0) | nextKind
}

function addExport(exportsByFile, fileName, name, kind, options) {
  if (shouldIgnoreExport(name, options)) {
    return
  }

  const exports = exportsByFile.get(fileName) ?? new Map()
  exports.set(name, mergeExportKind(exports.get(name), kind))
  exportsByFile.set(fileName, exports)
}

function addEdge(edges, fromFile, fromName, toFile, toName, kind) {
  const fromRecord = createExportRecord({ fileName: fromFile, name: fromName })
  const targets = edges.get(fromRecord) ?? []

  targets.push({ fileName: toFile, name: toName, kind })
  edges.set(fromRecord, targets)
}

function addStarEdge(starEdges, fromFile, toFile, kind) {
  const starTargets = starEdges.get(fromFile) ?? new Map()
  starTargets.set(toFile, mergeExportKind(starTargets.get(toFile), kind))
  starEdges.set(fromFile, starTargets)
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

function createExportItem({ name, kind }) {
  return { name, kind }
}

function getDeclarationExportItems(declaration) {
  if (ts.isVariableStatement(declaration)) {
    return declaration.declarationList.declarations.flatMap((item) =>
      collectBindingNames(item.name).map((name) =>
        createExportItem({ name, kind: EXPORT_KIND_VALUE }),
      ),
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
    return [
      createExportItem({
        name: declaration.name.text,
        kind: getDeclarationExportKind(declaration),
      }),
    ]
  }

  return []
}

function getDeclarationExportKind(declaration) {
  if (
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration)
  ) {
    return EXPORT_KIND_TYPE
  }

  if (ts.isClassDeclaration(declaration) || ts.isEnumDeclaration(declaration)) {
    return EXPORT_KIND_BOTH
  }

  return EXPORT_KIND_VALUE
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

function getLocalExportedName(specifier) {
  return (specifier.propertyName ?? specifier.name).text
}

function getReExportedName(specifier) {
  return specifier.name.text
}

function getExportDeclarationKind(node, specifier, localExportKinds) {
  if (node.isTypeOnly || specifier?.isTypeOnly) {
    return EXPORT_KIND_TYPE
  }

  if (!node.moduleSpecifier && specifier) {
    return localExportKinds.get(getLocalExportedName(specifier)) ?? EXPORT_KIND_BOTH
  }

  return EXPORT_KIND_BOTH
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

function getImportClauseUsageKind(importClause) {
  return importClause?.isTypeOnly ? EXPORT_KIND_TYPE : EXPORT_KIND_VALUE
}

function getImportSpecifierUsageKind(importClause, specifier) {
  return importClause?.isTypeOnly || specifier.isTypeOnly
    ? EXPORT_KIND_TYPE
    : EXPORT_KIND_VALUE
}

function getLeftmostEntityName(name) {
  if (ts.isIdentifier(name)) {
    return name.text
  }

  if (ts.isQualifiedName(name)) {
    return getLeftmostEntityName(name.left)
  }

  return undefined
}

function getQualifiedNameParts(name, parts = []) {
  if (ts.isIdentifier(name)) {
    parts.push(name.text)
    return parts
  }

  if (ts.isQualifiedName(name)) {
    getQualifiedNameParts(name.left, parts)
    parts.push(name.right.text)
  }

  return parts
}

function isNamespaceImportIdentifier(node, parent) {
  return parent ? ts.isNamespaceImport(parent) && parent.name === node : false
}

function isHandledNamespaceMemberExpression(node, parent) {
  return (
    (parent
      ? ts.isPropertyAccessExpression(parent) && parent.expression === node
      : false) ||
    (parent
      ? ts.isElementAccessExpression(parent) && parent.expression === node
      : false) ||
    (parent ? ts.isQualifiedName(parent) && parent.left === node : false)
  )
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
  const visitedStarExports = new Set()

  function markAllExports(fileName, usageKind = EXPORT_KIND_BOTH) {
    const starRecord = createExportRecord({ fileName, name: `*:${usageKind}` })

    if (visitedStarExports.has(starRecord)) {
      return
    }

    visitedStarExports.add(starRecord)

    const fileExports = exportsByFile.get(fileName)

    for (const [name, exportKind] of fileExports ?? []) {
      const matchedKind = exportKind & usageKind

      if (matchedKind) {
        markUsed(fileName, name, matchedKind)
      }
    }

    for (const [targetFile, starKind] of starEdges.get(fileName) ?? []) {
      const matchedKind = starKind & usageKind

      if (matchedKind) {
        markAllExports(targetFile, matchedKind)
      }
    }
  }

  function markUsed(fileName, name, usageKind = EXPORT_KIND_BOTH) {
    if (name === "*") {
      markAllExports(fileName, usageKind)
      return
    }

    const record = createExportRecord({ fileName, name })
    const previousKind = usedExports.get(record) ?? 0
    const nextKind = previousKind | usageKind
    const newKind = nextKind & ~previousKind

    if (!newKind) {
      return
    }

    usedExports.set(record, nextKind)
    pending.push({ record, usageKind: newKind })

    while (pending.length > 0) {
      const { record: currentRecord, usageKind: currentUsageKind } = pending.shift()
      const current = parseExportRecord(currentRecord)

      for (const target of edges.get(currentRecord) ?? []) {
        const matchedKind = target.kind & currentUsageKind

        if (matchedKind) {
          markUsed(target.fileName, target.name, matchedKind)
        }
      }

      for (const [targetFile, starKind] of starEdges.get(current.fileName) ?? []) {
        const targetExports = exportsByFile.get(targetFile)
        const targetKind = targetExports?.get(current.name)

        if (targetKind) {
          const matchedKind = targetKind & starKind & currentUsageKind

          if (matchedKind) {
            markUsed(targetFile, current.name, matchedKind)
          }
        }
      }
    }
  }

  return { markAllExports, markUsed }
}

function collectExports(sourceFile, resolveModule, analysis, options) {
  const fileName = normalizePath(sourceFile.fileName)
  const localExportKinds = new Map()

  sourceFile.forEachChild((node) => {
    for (const item of getDeclarationExportItems(node)) {
      localExportKinds.set(
        item.name,
        mergeExportKind(localExportKinds.get(item.name), item.kind),
      )
    }
  })

  sourceFile.forEachChild((node) => {
    if (hasExportModifier(node) && !hasDefaultModifier(node)) {
      for (const item of getDeclarationExportItems(node)) {
        addExport(analysis.exportsByFile, fileName, item.name, item.kind, options)
      }
    }

    if (hasExportModifier(node) && hasDefaultModifier(node)) {
      addExport(
        analysis.exportsByFile,
        fileName,
        "default",
        getDeclarationExportKind(node),
        options,
      )
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
        addStarEdge(
          analysis.starEdges,
          fileName,
          targetFile,
          node.isTypeOnly ? EXPORT_KIND_TYPE : EXPORT_KIND_BOTH,
        )
      }

      return
    }

    if (ts.isNamespaceExport(node.exportClause)) {
      const exportedName = node.exportClause.name.text
      const exportKind = node.isTypeOnly ? EXPORT_KIND_TYPE : EXPORT_KIND_VALUE
      addExport(analysis.exportsByFile, fileName, exportedName, exportKind, options)

      if (targetFile) {
        addEdge(analysis.edges, fileName, exportedName, targetFile, "*", exportKind)
      }

      return
    }

    for (const specifier of node.exportClause.elements) {
      const exportedName = getReExportedName(specifier)
      const exportKind = getExportDeclarationKind(node, specifier, localExportKinds)
      addExport(analysis.exportsByFile, fileName, exportedName, exportKind, options)

      if (targetFile) {
        addEdge(
          analysis.edges,
          fileName,
          exportedName,
          targetFile,
          getExportedName(specifier),
          exportKind,
        )
      }
    }
  })
}

function collectImportUsage(sourceFile, resolveModule, usage) {
  const fileName = normalizePath(sourceFile.fileName)
  const namespaceImports = new Map()

  function markNamespaceMember(alias, name, usageKind) {
    const namespaceImport = namespaceImports.get(alias)

    if (!namespaceImport) {
      return false
    }

    usage.markUsed(namespaceImport.targetFile, name, usageKind)
    return true
  }

  function markNamespaceObject(alias) {
    const namespaceImport = namespaceImports.get(alias)

    if (!namespaceImport) {
      return false
    }

    usage.markAllExports(namespaceImport.targetFile, namespaceImport.usageKind)
    return true
  }

  function visit(node, parent) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = getModuleSpecifierText(node)
      const targetFile = moduleSpecifier
        ? resolveModule(moduleSpecifier, fileName)
        : undefined

      if (targetFile && node.importClause) {
        if (node.importClause.name) {
          usage.markUsed(
            targetFile,
            "default",
            getImportClauseUsageKind(node.importClause),
          )
        }

        if (node.importClause.namedBindings) {
          if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            namespaceImports.set(node.importClause.namedBindings.name.text, {
              targetFile,
              usageKind: getImportClauseUsageKind(node.importClause),
            })
          } else {
            for (const specifier of node.importClause.namedBindings.elements) {
              usage.markUsed(
                targetFile,
                (specifier.propertyName ?? specifier.name).text,
                getImportSpecifierUsageKind(node.importClause, specifier),
              )
            }
          }
        }
      }
    }

    if (isImportLikeCall(node, "import")) {
      const targetFile = resolveModule(node.arguments[0].text, fileName)

      if (targetFile) {
        usage.markAllExports(targetFile, EXPORT_KIND_VALUE)
      }
    }

    if (isImportLikeCall(node, "require")) {
      const targetFile = resolveModule(node.arguments[0].text, fileName)

      if (targetFile) {
        if (
          parent &&
          ts.isVariableDeclaration(parent) &&
          ts.isObjectBindingPattern(parent.name)
        ) {
          for (const element of parent.name.elements) {
            if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) {
              continue
            }

            const importName =
              element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text

            usage.markUsed(targetFile, importName, EXPORT_KIND_VALUE)
          }
        } else if (
          parent &&
          ts.isVariableDeclaration(parent) &&
          ts.isIdentifier(parent.name)
        ) {
          namespaceImports.set(parent.name.text, {
            targetFile,
            usageKind: EXPORT_KIND_VALUE,
          })
        } else {
          usage.markAllExports(targetFile, EXPORT_KIND_VALUE)
        }
      }
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      markNamespaceMember(
        node.expression.text,
        node.name.text,
        namespaceImports.get(node.expression.text)?.usageKind ?? EXPORT_KIND_BOTH,
      )
    }

    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const namespaceImport = namespaceImports.get(node.expression.text)

      if (namespaceImport) {
        if (
          ts.isStringLiteralLike(node.argumentExpression) ||
          ts.isNumericLiteral(node.argumentExpression)
        ) {
          usage.markUsed(
            namespaceImport.targetFile,
            node.argumentExpression.text,
            namespaceImport.usageKind,
          )
        } else {
          usage.markAllExports(namespaceImport.targetFile, namespaceImport.usageKind)
        }
      }
    }

    if (ts.isQualifiedName(node)) {
      const parts = getQualifiedNameParts(node)

      if (parts.length >= 2) {
        markNamespaceMember(parts[0], parts[1], EXPORT_KIND_TYPE)
      }
    }

    if (
      ts.isIdentifier(node) &&
      !isNamespaceImportIdentifier(node, parent) &&
      !isHandledNamespaceMemberExpression(node, parent)
    ) {
      markNamespaceObject(node.text)
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      const targetFile = resolveModule(node.argument.literal.text, fileName)

      if (!targetFile) {
        ts.forEachChild(node, (child) => visit(child, node))
        return
      }

      if (node.qualifier) {
        const importName = getLeftmostEntityName(node.qualifier)

        if (importName) {
          usage.markUsed(targetFile, importName, EXPORT_KIND_TYPE)
        }
      } else {
        usage.markAllExports(targetFile, EXPORT_KIND_TYPE)
      }
    }

    ts.forEachChild(node, (child) => visit(child, node))
  }

  visit(sourceFile)
}

function analyzeProject(rawOptions, currentFileName) {
  const options = getRuleOptions(rawOptions)
  const cacheKey = getCacheKey(options)
  const cachedAnalysis = analysisCache.get(cacheKey)

  if (cachedAnalysis && !isCachedAnalysisStale(cachedAnalysis, currentFileName)) {
    return cachedAnalysis.analysis
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
    usedExports: new Map(),
  }
  const fileMtimes = new Map(
    [...internalFiles].map((fileName) => [fileName, getFileMtime(fileName)]),
  )

  // Build the export graph first, then mark imports as live and propagate through barrels.
  for (const sourceFile of sourceFiles) {
    collectExports(sourceFile, resolveModule, analysis, options)
  }

  const usage = createUsageMarker(analysis)

  for (const sourceFile of sourceFiles) {
    collectImportUsage(sourceFile, resolveModule, usage)
  }

  for (const [fileName, exportNames] of analysis.exportsByFile) {
    for (const name of exportNames.keys()) {
      const record = createExportRecord({ fileName, name })

      if (analysis.usedExports.has(record)) {
        continue
      }

      const unusedExports = analysis.unusedExportsByFile.get(fileName) ?? new Set()
      unusedExports.add(name)
      analysis.unusedExportsByFile.set(fileName, unusedExports)
    }
  }

  analysisCache.set(cacheKey, { analysis, fileMtimes })

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

export const noUnusedModuleExportsRule = {
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
    const fileName = normalizePath(context.filename)
    const analysis = analyzeProject(context.options?.[0], fileName)
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
