// Before hydration a click submits the server HTML natively. The default GET puts every field,
// passwords included, into the URL. A POST keeps the fields in the request body.
const SAFE_METHODS = new Set(["post", "dialog"])

const MISSING_METHOD_MESSAGE =
  'Add method="post" to this <form>. Before hydration the browser submits it natively, and the default GET puts every field, passwords included, into the URL, browser history, and server logs.'
const SPREAD_AFTER_METHOD_MESSAGE =
  'Move the spread before method="post" on this <form>. A spread after the method can set it back to GET, which puts every field into the URL.'

function getStaticStringValue(value) {
  if (value?.type === "Literal" && typeof value.value === "string") {
    return value.value
  }

  if (value?.type === "JSXExpressionContainer") {
    return getStaticStringValue(value.expression)
  }

  return null
}

function findAttribute({ attributes, name }) {
  return attributes.find((attribute) => attribute.type === "JSXAttribute" && attribute.name?.name === name)
}

// React 19 sets the method of a function action itself, and warns in development when a method is also set.
function hasFunctionAction(attributes) {
  const actionValue = findAttribute({ attributes, name: "action" })?.value

  return actionValue?.type === "JSXExpressionContainer" && getStaticStringValue(actionValue) === null
}

function getProblemMessage(attributes) {
  if (hasFunctionAction(attributes)) {
    return null
  }

  const methodAttribute = findAttribute({ attributes, name: "method" })

  if (!SAFE_METHODS.has(getStaticStringValue(methodAttribute?.value)?.toLowerCase())) {
    return MISSING_METHOD_MESSAGE
  }

  const methodIndex = attributes.indexOf(methodAttribute)
  const hasLaterSpread = attributes.slice(methodIndex + 1).some((attribute) => attribute.type === "JSXSpreadAttribute")

  return hasLaterSpread ? SPREAD_AFTER_METHOD_MESSAGE : null
}

export const requireFormMethodPostRule = {
  meta: {
    type: "problem",
    docs: {
      description: 'Require method="post" on every <form>, so a submit before hydration keeps fields out of the URL.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name?.type !== "JSXIdentifier" || node.name.name !== "form") {
          return
        }

        const message = getProblemMessage(node.attributes)

        if (message) {
          context.report({ node, message })
        }
      },
    }
  },
}
