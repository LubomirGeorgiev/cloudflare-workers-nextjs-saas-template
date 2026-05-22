const OBJECT_PARAM_NAMES = new Set(["options", "params", "props", "input"])

function isIdentifier(node, name) {
  return node?.type === "Identifier" && node.name === name
}

function getMemberPropertyName(node) {
  if (!node) {
    return undefined
  }

  if (node.type === "Identifier") {
    return node.name
  }

  if (node.type === "Literal") {
    return String(node.value)
  }

  return undefined
}

function getTypeAnnotationType(node) {
  return node?.typeAnnotation?.typeAnnotation?.type
}

function isObjectLikeTypeAnnotation(node) {
  const annotationType = getTypeAnnotationType(node)

  if (!annotationType) {
    return false
  }

  if (annotationType === "TSTypeLiteral") {
    return true
  }

  if (
    annotationType === "TSTypeReference" &&
    node.typeAnnotation.typeAnnotation.typeName?.type === "Identifier"
  ) {
    const typeName = node.typeAnnotation.typeAnnotation.typeName.name
    return /(?:Options|Params|Props|Input)$/.test(typeName)
  }

  return false
}

function getObjectParamNode(param) {
  if (param.type === "ObjectPattern") {
    return param
  }

  if (param.type === "AssignmentPattern") {
    if (param.left.type === "ObjectPattern" || param.right.type === "ObjectExpression") {
      return param
    }

    return getObjectParamNode(param.left)
  }

  if (
    param.type === "Identifier" &&
    (OBJECT_PARAM_NAMES.has(param.name) || isObjectLikeTypeAnnotation(param))
  ) {
    return param
  }

  return undefined
}

function getFunctionNodeFromCacheCall(node) {
  const [callback] = node.arguments ?? []

  if (
    callback?.type === "ArrowFunctionExpression" ||
    callback?.type === "FunctionExpression"
  ) {
    return callback
  }

  return undefined
}

function isReactCacheCall(node, cacheImports, reactNamespaces) {
  const callee = node.callee

  if (callee?.type === "Identifier" && cacheImports.has(callee.name)) {
    return true
  }

  if (
    callee?.type === "MemberExpression" &&
    callee.object?.type === "Identifier" &&
    reactNamespaces.has(callee.object.name) &&
    getMemberPropertyName(callee.property) === "cache"
  ) {
    return true
  }

  return false
}

export const noObjectParamsInReactCacheRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow object parameters in React cache callbacks.",
    },
    schema: [],
  },
  create(context) {
    const cacheImports = new Set()
    const reactNamespaces = new Set()

    return {
      ImportDeclaration(node) {
        if (node.source?.value !== "react") {
          return
        }

        for (const specifier of node.specifiers ?? []) {
          if (
            specifier.type === "ImportSpecifier" &&
            getMemberPropertyName(specifier.imported) === "cache"
          ) {
            cacheImports.add(specifier.local?.name ?? "cache")
          }

          if (specifier.type === "ImportNamespaceSpecifier") {
            reactNamespaces.add(specifier.local.name)
          }
        }
      },
      CallExpression(node) {
        if (!isReactCacheCall(node, cacheImports, reactNamespaces)) {
          return
        }

        const callback = getFunctionNodeFromCacheCall(node)

        if (!callback) {
          return
        }

        for (const param of callback.params ?? []) {
          const objectParamNode = getObjectParamNode(param)

          if (!objectParamNode) {
            continue
          }

          context.report({
            node: objectParamNode,
            message:
              "Do not use object parameters in React cache callbacks. React cache keys objects by reference, so use primitive arguments or a stable serialized key instead.",
          })
        }
      },
    }
  },
}
