// Before hydration a click submits the server HTML natively. The default GET puts every field,
// passwords included, into the URL. A POST keeps the fields in the request body.
const REQUIRED_METHOD = "post"

function getStaticStringValue(value) {
  if (value?.type === "Literal" && typeof value.value === "string") {
    return value.value
  }

  if (value?.type === "JSXExpressionContainer") {
    return getStaticStringValue(value.expression)
  }

  return null
}

function hasRequiredMethod(openingElement) {
  const methodAttribute = openingElement.attributes.find(
    (attribute) => attribute.type === "JSXAttribute" && attribute.name?.name === "method"
  )

  return getStaticStringValue(methodAttribute?.value)?.toLowerCase() === REQUIRED_METHOD
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
        if (node.name?.type !== "JSXIdentifier" || node.name.name !== "form" || hasRequiredMethod(node)) {
          return
        }

        context.report({
          node,
          message:
            'Add method="post" to this <form>. Before hydration the browser submits it natively, and the default GET puts every field, passwords included, into the URL, browser history, and server logs.',
        })
      },
    }
  },
}
