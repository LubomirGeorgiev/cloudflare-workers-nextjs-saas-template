import { Fragment, type ReactNode } from "react";

// Example payloads are already plain JS values, so they are colored while being serialized rather
// than serialized and then re-parsed by a highlighter: no client bundle, no hydration, no lowlight.
//
// Tokens are built by plain recursive calls, never as components: a component per token would put a
// tree node (and, in development, a debug row) in the RSC payload for every brace and comma.

const INDENT = "  ";

const TOKEN_STYLES = {
  key: "text-sky-700 dark:text-sky-300",
  string: "text-emerald-700 dark:text-emerald-300",
  literal: "text-violet-700 dark:text-violet-300",
  punctuation: "text-muted-foreground",
} as const;

function punctuation(text: string, key?: string): ReactNode {
  return (
    <span key={key} className={TOKEN_STYLES.punctuation}>
      {text}
    </span>
  );
}

function jsonToken({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (typeof value === "string") {
    return <span className={TOKEN_STYLES.string}>{JSON.stringify(value)}</span>;
  }

  // `undefined` folds into null: a schema branch with no example must still serialize.
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return <span className={TOKEN_STYLES.literal}>{JSON.stringify(value ?? null)}</span>;
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  const [open, close] = isArray ? ["[", "]"] : ["{", "}"];

  if (entries.length === 0) {
    return punctuation(`${open}${close}`);
  }

  return (
    <>
      {punctuation(open)}
      {"\n"}
      {entries.map(([name, item], index) => (
        <Fragment key={name}>
          {INDENT.repeat(depth + 1)}
          {isArray ? null : (
            <>
              <span className={TOKEN_STYLES.key}>{JSON.stringify(name)}</span>
              {punctuation(": ")}
            </>
          )}
          {jsonToken({ value: item, depth: depth + 1 })}
          {index < entries.length - 1 ? punctuation(",") : null}
          {"\n"}
        </Fragment>
      ))}
      {INDENT.repeat(depth)}
      {punctuation(close)}
    </>
  );
}

export function ApiJsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto whitespace-pre p-4 font-mono text-xs leading-relaxed">
      <code>{jsonToken({ value, depth: 0 })}</code>
    </pre>
  );
}
