"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TerminalLine {
  /** Text shown after a `$` prompt; rendered as a typed command. */
  command?: string;
  /** Output line printed instantly once the preceding command finishes. */
  output?: string;
  /** Marks a successful step (renders a leading check in the edge accent). */
  ok?: boolean;
  /** Marks the final "live" status line. */
  live?: boolean;
}

const LINES: TerminalLine[] = [
  { command: "git clone saas-template && cd saas-template" },
  { command: "pnpm install" },
  { output: "packages resolved · workspace ready", ok: true },
  { command: "pnpm deploy" },
  { output: "vinext build → vite bundle complete", ok: true },
  { output: "uploaded worker to cloudflare", ok: true },
  { output: "live on 330 cities · 0ms cold start", live: true },
];

const TYPE_MS = 32;
const LINE_PAUSE_MS = 320;

export function DeployTerminal() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion.current) {
      setVisibleCount(LINES.length);
      setDone(true);
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function runLine(index: number) {
      if (cancelled || index >= LINES.length) {
        setDone(true);
        return;
      }

      const line = LINES[index];

      if (!line.command) {
        setVisibleCount(index + 1);
        timers.push(setTimeout(() => runLine(index + 1), LINE_PAUSE_MS));
        return;
      }

      let charIndex = 0;
      setTyped("");

      function typeChar() {
        if (cancelled) return;
        charIndex += 1;
        setTyped(line.command!.slice(0, charIndex));

        if (charIndex < line.command!.length) {
          timers.push(setTimeout(typeChar, TYPE_MS));
        } else {
          setVisibleCount(index + 1);
          setTyped("");
          timers.push(setTimeout(() => runLine(index + 1), LINE_PAUSE_MS));
        }
      }

      timers.push(setTimeout(typeChar, LINE_PAUSE_MS));
    }

    timers.push(setTimeout(() => runLine(0), 600));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  const activeLine = !done ? LINES[visibleCount] : undefined;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-px rounded-xl bg-edge/20 blur-2xl"
      />
      <div className="relative overflow-hidden rounded-xl border border-border bg-card/80 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-border/80 px-4 py-3">
          <span className="size-3 rounded-full bg-foreground/15" />
          <span className="size-3 rounded-full bg-foreground/15" />
          <span className="size-3 rounded-full bg-edge/70" />
          <span className="ml-3 font-mono text-xs text-muted-foreground">
            ~/your-saas — deploy
          </span>
        </div>

        <div className="min-h-[270px] px-4 py-4 font-mono text-[13px] leading-relaxed sm:px-5 sm:text-sm">
          {LINES.slice(0, visibleCount).map((line, i) => (
            <TerminalRow key={i} line={line} />
          ))}

          {activeLine?.command !== undefined && (
            <div className="flex gap-2 text-foreground">
              <span className="select-none text-edge">$</span>
              <span>
                {typed}
                <Cursor />
              </span>
            </div>
          )}

          {done && (
            <div className="mt-1 flex gap-2 text-foreground/70">
              <span className="select-none text-edge">$</span>
              <Cursor />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TerminalRow({ line }: { line: TerminalLine }) {
  if (line.command !== undefined) {
    return (
      <div className="flex gap-2 text-foreground">
        <span className="select-none text-edge">$</span>
        <span className="break-all">{line.command}</span>
      </div>
    );
  }

  if (line.live) {
    return (
      <div className="mt-1 flex items-center gap-2 text-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-edge" />
        <span className="font-medium text-edge">{line.output}</span>
      </div>
    );
  }

  return (
    <div className="flex gap-2 text-muted-foreground">
      <span className={cn("select-none", line.ok ? "text-edge" : "text-muted-foreground")}>
        {line.ok ? "✓" : "·"}
      </span>
      <span>{line.output}</span>
    </div>
  );
}

function Cursor() {
  return (
    <span className="ml-0.5 inline-block h-[1.05em] w-[0.55em] translate-y-[0.15em] animate-pulse bg-edge align-middle" />
  );
}
