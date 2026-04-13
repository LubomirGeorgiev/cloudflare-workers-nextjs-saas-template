"use client";

import { useEffect, useRef, useState } from "react";
import { SearchIcon, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useHotkeys } from "react-hotkeys-hook";
import { useAction } from "next-safe-action/hooks";
import { useDebounceValue } from "usehooks-ts";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { searchDocsAction } from "../_actions/search-docs.action";

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

interface DocsSearchProps {
  className?: string;
  registerHotkeys?: boolean;
}

interface DocsSearchResult {
  entryId: string;
  title: string;
  slug: string;
  seoDescription: string | null;
  resolvedPath: string;
  snippet: string;
}

interface HighlightedTextProps {
  text: string;
  query: string;
  className?: string;
}

export function DocsSearch({
  className,
  registerHotkeys = false,
}: DocsSearchProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocsSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [debouncedQuery] = useDebounceValue(query, SEARCH_DEBOUNCE_MS);
  const searchRequestIdRef = useRef(0);
  const { executeAsync: executeDocsSearch } = useAction(searchDocsAction);

  useHotkeys(
    "meta+k, ctrl+k",
    (event) => {
      event.preventDefault();
      setIsOpen((current) => !current);
    },
    {
      enabled: registerHotkeys,
      enableOnContentEditable: false,
      enableOnFormTags: false,
    }
  );

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setIsLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const trimmedQuery = debouncedQuery.trim();
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;

    setIsLoading(true);

    void (async () => {
      try {
        const response = await executeDocsSearch({
          q: trimmedQuery,
        });

        if (searchRequestIdRef.current !== requestId) {
          return;
        }

        if (!response?.data) {
          setResults([]);
          return;
        }

        setResults(response.data.results);
      } catch {
        if (searchRequestIdRef.current === requestId) {
          setResults([]);
        }
      } finally {
        if (searchRequestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      searchRequestIdRef.current += 1;
    };
  }, [debouncedQuery, executeDocsSearch, isOpen]);

  function navigateToResult(path: string) {
    setIsOpen(false);
    router.push(path as Route);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn(
          "w-full justify-between gap-3 text-muted-foreground sm:w-auto sm:min-w-64",
          className
        )}
        onClick={() => setIsOpen(true)}
      >
        <span className="flex items-center gap-2">
          <SearchIcon className="size-4" />
          Search docs
        </span>
        {registerHotkeys ? (
          <span className="hidden rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">
            ⌘K
          </span>
        ) : null}
      </Button>

      <CommandDialog open={isOpen} onOpenChange={setIsOpen}>
        <CommandInput
          placeholder="Search docs..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {isLoading
              ? "Searching docs..."
              : query.trim().length < MIN_QUERY_LENGTH
                ? "Type at least 2 characters to search."
                : "No matching docs found."}
          </CommandEmpty>
          <CommandGroup heading="Documentation">
            {results.map((result) => (
              <CommandItem
                key={result.entryId}
                value={`${result.title} ${result.snippet} ${result.resolvedPath}`}
                onSelect={() => navigateToResult(result.resolvedPath)}
                className="items-start gap-3 py-3"
              >
                <FileText className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium text-foreground">
                    <HighlightedText text={result.title} query={query} />
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    <HighlightedText text={result.snippet} query={query} />
                  </p>
                  <p className="truncate text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
                    <HighlightedText text={result.resolvedPath} query={query} />
                  </p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

function HighlightedText({ text, query, className }: HighlightedTextProps) {
  const terms = getHighlightTerms(query);

  if (terms.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);

  return (
    <span className={className}>
      {parts.map((part, index) =>
        terms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
          <span key={`${part}-${index}`} className="font-semibold text-foreground">
            {part}
          </span>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </span>
  );
}

function getHighlightTerms(query: string) {
  return Array.from(
    new Set(
      query
        .trim()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= MIN_QUERY_LENGTH)
        .sort((left, right) => right.length - left.length)
    )
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
