"use client";

import { useEffect } from "react";

// Vinext (like Next.js) streams async generateMetadata output into a
// `<div hidden>` in <body> for JS-capable user agents, and nothing ever moves
// the tags into <head>. Google ignores rel=canonical/hreflang/robots outside
// <head> even in the rendered DOM, so we hoist them after hydration for
// JS-executing crawlers. HTML-limited bots (Facebook/Twitter/Slack/Bing…)
// already receive blocking <head> metadata from the server and never run this.
// Upstream context: https://github.com/cloudflare/vinext/issues/2007

const HOISTED_MARKER = "data-streamed-metadata";
const METADATA_TAG_NAMES = new Set(["TITLE", "META", "LINK"]);

function isStreamedMetadataOutlet(node: Node): node is HTMLDivElement {
  return (
    node instanceof HTMLDivElement &&
    node.hidden &&
    node.childElementCount > 0 &&
    Array.from(node.children).every((child) => METADATA_TAG_NAMES.has(child.tagName))
  );
}

function containsStreamedMetadataOutlet(node: Node): boolean {
  if (isStreamedMetadataOutlet(node)) return true;
  return (
    node instanceof Element &&
    Array.from(node.querySelectorAll("div[hidden]")).some(isStreamedMetadataOutlet)
  );
}

function hoistStreamedMetadata(): void {
  const outlets = Array.from(document.body.querySelectorAll("div[hidden]")).filter(
    isStreamedMetadataOutlet,
  );
  if (outlets.length === 0) return;

  // Drop the tags hoisted for the previous route before installing the new
  // ones, so soft navigations never leave two canonicals/titles in <head>.
  for (const stale of document.head.querySelectorAll(`[${HOISTED_MARKER}]`)) {
    stale.remove();
  }

  // Moving (not cloning) keeps exactly one instance of each tag in the
  // document. The outlet is rendered via dangerouslySetInnerHTML, so React
  // never reconciles its children individually — emptying it is safe, and a
  // soft navigation that rewrites the outlet's innerHTML re-triggers the
  // observer with fresh nodes.
  for (const tag of outlets.flatMap((outlet) => Array.from(outlet.children))) {
    tag.setAttribute(HOISTED_MARKER, "");
    document.head.appendChild(tag);
  }
}

export function StreamedMetadataHoister() {
  useEffect(() => {
    hoistStreamedMetadata();

    // Streamed metadata can arrive after hydration (late Suspense flush) and
    // is replaced on soft navigations; re-hoist whenever an outlet (re)fills.
    // Hoisting empties the outlets, so re-entrant callbacks find nothing and
    // bail — no observe/mutate loop.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (
          containsStreamedMetadataOutlet(record.target) ||
          Array.from(record.addedNodes).some(containsStreamedMetadataOutlet)
        ) {
          hoistStreamedMetadata();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
