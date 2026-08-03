import {
  SiClaude,
  SiCursor,
  SiGithubcopilot,
  SiGooglegemini,
} from "@icons-pack/react-simple-icons";
import type { ComponentType } from "react";

import type { AgentClient } from "@/constants/agent-clients";

// Every mark is drawn in currentColor rather than its brand hex, so the same file stays legible
// against both themes. The marks simple-icons does not carry are inlined below, traced from
// homarr-labs/dashboard-icons (Apache-2.0).

const LOGO_SIZE = 16;

interface BrandMarkProps {
  size?: number;
  title?: string;
}

function OpenAiMark({ size = LOGO_SIZE, title = "OpenAI" }: BrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <title>{title}</title>
      <path d="M22.282 9.821a6 6 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206 6 6 0 0 0 3.997-2.9 6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023-.141-.085-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z" />
    </svg>
  );
}

function GrokMark({ size = LOGO_SIZE, title = "Grok" }: BrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0.36 0.5 33.33 32"
      fill="currentColor"
    >
      <title>{title}</title>
      <path d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436" />
      <path d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341" />
    </svg>
  );
}

// The only non-square mark here: kept at its 4:5 viewBox so the frame stays a rectangle, and the
// two brand tones collapse to one colour plus opacity, which reads correctly against both themes.
function OpencodeMark({ size = LOGO_SIZE, title = "opencode" }: BrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 240 300"
      fill="currentColor"
    >
      <title>{title}</title>
      <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" />
      <path d="M180 240H60V120H180V240Z" opacity={0.4} />
    </svg>
  );
}

// Keyed on the registry's own ids, so a client added to `agent-clients.ts` without a mark here is
// a compile error rather than a silent fall back to initials.
const AGENT_CLIENT_LOGOS: Record<AgentClient["id"], ComponentType<BrandMarkProps>> = {
  "claude-code": SiClaude,
  "claude-app": SiClaude,
  chatgpt: OpenAiMark,
  "codex-cli": OpenAiMark,
  cursor: SiCursor,
  vscode: SiGithubcopilot,
  antigravity: SiGooglegemini,
  grok: GrokMark,
  opencode: OpencodeMark,
};

export function AgentClientLogo({ client }: { client: AgentClient }) {
  const Logo = AGENT_CLIENT_LOGOS[client.id];

  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px] font-semibold text-foreground"
    >
      {Logo ? <Logo size={LOGO_SIZE} title={client.name} /> : client.initials}
    </span>
  );
}
