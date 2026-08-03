"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  API_FILTER_ATTRIBUTE_NAMES,
  API_FILTER_SELECTORS,
  methodStyle,
} from "./api-reference-dom";

// The reference itself is server-rendered, so filtering hides nodes instead of re-rendering a
// client-side copy of the document: the operations stay in the HTML (and in view-source, and for
// crawlers) whatever the query is. Only the query, the chips, and the counter live in React.

const ALL_METHODS = "";
const FOCUS_HOTKEY = "/";
/** Elements whose keystrokes belong to the reader, never to the hotkey. */
const TYPING_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

interface FilterState {
  tokens: string[];
  method: string;
}

function matches({
  element,
  attribute,
  state,
}: {
  element: Element;
  attribute: string;
  state: FilterState;
}): boolean {
  if (state.method !== ALL_METHODS) {
    if (element.getAttribute(API_FILTER_ATTRIBUTE_NAMES.method) !== state.method) {
      return false;
    }
  }

  const haystack = element.getAttribute(attribute) ?? "";

  return state.tokens.every((token) => haystack.includes(token));
}

function applyVisibility({ elements, attribute, state }: {
  elements: Iterable<Element>;
  attribute: string;
  state: FilterState;
}): number {
  let visible = 0;

  for (const element of elements) {
    const isMatch = matches({ element, attribute, state });

    element.toggleAttribute("hidden", !isMatch);
    if (isMatch) {
      visible += 1;
    }
  }

  return visible;
}

/** A tag section disappears once nothing inside it survives the filter, in the list and the index. */
function applyGroupVisibility(): void {
  for (const group of document.querySelectorAll(API_FILTER_SELECTORS.group)) {
    const members = group.querySelectorAll(
      `${API_FILTER_SELECTORS.operation}, ${API_FILTER_SELECTORS.index}`,
    );
    const hasVisibleMember = [...members].some((member) => !member.hasAttribute("hidden"));

    group.toggleAttribute("hidden", !hasVisibleMember);
  }
}

/** Applies the filter to the whole page and answers how many operations survived. */
function applyFilter(state: FilterState): number {
  const visible = applyVisibility({
    elements: document.querySelectorAll(API_FILTER_SELECTORS.operation),
    attribute: API_FILTER_ATTRIBUTE_NAMES.haystack,
    state,
  });

  applyVisibility({
    elements: document.querySelectorAll(API_FILTER_SELECTORS.index),
    attribute: API_FILTER_ATTRIBUTE_NAMES.indexHaystack,
    state,
  });

  applyGroupVisibility();

  for (const emptyState of document.querySelectorAll(API_FILTER_SELECTORS.emptyState)) {
    emptyState.toggleAttribute("hidden", visible > 0);
  }

  return visible;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || TYPING_TAGS.includes(target.tagName);
}

function isBareHotkey(event: KeyboardEvent): boolean {
  return event.key === FOCUS_HOTKEY && !event.metaKey && !event.ctrlKey && !event.altKey;
}

// The docs shell already owns Cmd+K for full-text search; this takes the bare "/", and only while
// the reader is not typing somewhere else.
function useFocusHotkey(target: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    function focusOnHotkey(event: KeyboardEvent) {
      if (!isBareHotkey(event) || isTypingTarget(event.target)) {
        return;
      }

      event.preventDefault();
      target.current?.focus();
    }

    document.addEventListener("keydown", focusOnHotkey);

    return () => document.removeEventListener("keydown", focusOnHotkey);
  }, [target]);
}

function FilterChip({
  label,
  isActive,
  activeClassName,
  className,
  onClick,
}: {
  label: string;
  isActive: boolean;
  activeClassName: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        isActive
          ? activeClassName
          : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
        className,
      )}
    >
      {label}
    </button>
  );
}

export function ApiReferenceFilter({
  methods,
  total,
}: {
  methods: string[];
  total: number;
}) {
  const t = useTranslations("Client.Docs.ApiReference");
  const [query, setQuery] = useQueryState("q", { defaultValue: "", clearOnDefault: true });
  const [method, setMethod] = useQueryState("method", {
    defaultValue: ALL_METHODS,
    clearOnDefault: true,
  });
  const [visibleCount, setVisibleCount] = useState(total);
  const inputRef = useRef<HTMLInputElement>(null);

  useFocusHotkey(inputRef);

  // A method the document does not use (a fork removed the last one, or a stale link) filters
  // nothing rather than emptying the page.
  const activeMethod = methods.includes(method) ? method : ALL_METHODS;

  useEffect(() => {
    setVisibleCount(
      applyFilter({
        tokens: query.toLowerCase().split(/\s+/).filter(Boolean),
        method: activeMethod,
      }),
    );
  }, [query, activeMethod]);

  const reset = useCallback(() => {
    void setQuery(null);
    void setMethod(null);
  }, [setQuery, setMethod]);

  const isFiltered = query.length > 0 || activeMethod !== ALL_METHODS;

  return (
    <div className="space-y-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => void setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              reset();
            }
          }}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          // Chrome draws its own clear button inside a search input, right where ours sits.
          className="h-11 pl-9 pr-24 [&::-webkit-search-cancel-button]:appearance-none"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {isFiltered ? (
            <button
              type="button"
              onClick={reset}
              aria-label={t("clearFilters")}
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">
            {FOCUS_HOTKEY}
          </kbd>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          label={t("allMethods")}
          isActive={activeMethod === ALL_METHODS}
          activeClassName="border-foreground/20 bg-foreground/10 text-foreground"
          onClick={() => void setMethod(null)}
        />

        {methods.map((candidate) => (
          <FilterChip
            key={candidate}
            label={candidate}
            isActive={activeMethod === candidate}
            activeClassName={cn(methodStyle(candidate), "border-transparent ring-1 ring-inset")}
            className="font-mono font-semibold uppercase"
            onClick={() => void setMethod(activeMethod === candidate ? null : candidate)}
          />
        ))}

        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {t("resultCount", { visible: visibleCount, total })}
        </span>
      </div>
    </div>
  );
}
