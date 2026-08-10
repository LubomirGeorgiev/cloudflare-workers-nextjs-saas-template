import "server-only"

import type { Messages, NestedValueOf } from "next-intl"
import type { ImageResponse } from "next/og"

import type { Locale } from "@/i18n/config"
import { getTranslator, type TranslatorNamespace } from "@/i18n/translator"

import { renderOgImage } from "./og-image"
import type { OgEyebrowKey } from "./types"

// Spelled inline at both call sites below, never hoisted to a constant: `message-usage.test.ts`
// scans lexically for `namespace: "Literal"`, and the eyebrow key is dynamic, so a constant here
// hides every `OgImage.*` row from that scan and it reports them all as orphaned.

// Only namespaces that carry both rows this helper reads. Nothing validates a message key at
// runtime — a namespace without them printed the literal path "Client.Docs.meta.title" onto the
// card — so the catalog itself decides which namespaces are a legal argument here.
type MetaNamespace = {
  [Namespace in TranslatorNamespace]: NestedValueOf<Messages, Namespace> extends {
    title: string
    description: string
  }
    ? Namespace
    : never
}[TranslatorNamespace]

// Renders the card from a page's existing `*.meta` catalog rows, so the OpenGraph image and the
// `<title>`/`<meta name="description">` of that page can never drift apart.
export async function renderTranslatedOgImage({
  locale,
  namespace,
  eyebrow,
  meta,
}: {
  locale: Locale
  // Namespace holding the page's own meta copy, e.g. "Legal.Privacy.meta".
  namespace: MetaNamespace
  eyebrow?: OgEyebrowKey
  meta?: string
}): Promise<ImageResponse> {
  const [t, tEyebrow] = await Promise.all([
    getTranslator({ locale, namespace }),
    eyebrow ? getTranslator({ locale, namespace: "OgImage" }) : undefined,
  ])

  return renderOgImage({
    title: t("title"),
    description: t("description"),
    eyebrow: tEyebrow && eyebrow ? tEyebrow(eyebrow) : undefined,
    meta,
  })
}

// Card for a title that is already resolved (CMS entries, dynamic routes) but still wants a
// localized section kicker.
export async function renderOgImageWithLocalizedEyebrow({
  locale,
  eyebrow,
  ...rest
}: {
  locale: Locale
  eyebrow: OgEyebrowKey
  title: string
  description?: string
  meta?: string
}): Promise<ImageResponse> {
  const tEyebrow = await getTranslator({ locale, namespace: "OgImage" })

  return renderOgImage({ ...rest, eyebrow: tEyebrow(eyebrow) })
}
