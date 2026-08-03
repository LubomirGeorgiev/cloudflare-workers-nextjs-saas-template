import { MCP_PATH, SITE_URL } from "@/constants";

// ---------------------------------------------------------------------------
// The agent clients this template ships setup snippets for.
//
// Data only: the settings page, the post-create key dialog, and the public docs all render from
// this one array, so adding or removing a client — or following a CLI's flag churn — is a one-file
// edit with no UI change. Snippet text is deliberately untranslated; commands and config are code.
//
// Two auth flavors, because the clients split cleanly in two: hosted assistants have no field for
// a bearer token and must connect over OAuth (paste the URL, approve once), while CLI and editor
// clients can send an API key header instead.
// ---------------------------------------------------------------------------

/** Stands in for a real key everywhere the secret is not (or no longer) available. */
export const API_KEY_PLACEHOLDER = "<YOUR_API_KEY>";

const MCP_URL_TOKEN = "{{MCP_URL}}";
const API_KEY_TOKEN = "{{API_KEY}}";
const SERVER_KEY_TOKEN = "{{SERVER_KEY}}";

/** The server name agent clients register the connection under; safe as a config object key. */
export const AGENT_SERVER_KEY = "saas-template";

export type AgentClientAuthFlavor = "oauth" | "api-key";
/** Drives the code-block label and syntax highlighting: what a user has to do with the snippet. */
export type AgentClientSnippetFormat = "command" | "json" | "toml" | "url";

export interface AgentClientSnippet {
  authFlavor: AgentClientAuthFlavor;
  format: AgentClientSnippetFormat;
  /** Where a config snippet belongs, when it is a file rather than a command. */
  file?: string;
  template: string;
}

export interface AgentClient {
  id: string;
  name: string;
  /** Fallback text mark, rendered when a client has no logo in `agent-client-logo.tsx`. */
  initials: string;
  /** Every client here speaks Streamable HTTP; the field exists for forks that add others. */
  transport: "streamable-http";
  authFlavors: AgentClientAuthFlavor[];
  docsUrl: string;
  snippets: AgentClientSnippet[];
}

export const AGENT_CLIENTS: AgentClient[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    initials: "CC",
    transport: "streamable-http",
    authFlavors: ["oauth", "api-key"],
    docsUrl: "https://docs.claude.com/en/docs/claude-code/mcp",
    snippets: [
      {
        authFlavor: "oauth",
        format: "command",
        template: `claude mcp add --transport http ${SERVER_KEY_TOKEN} ${MCP_URL_TOKEN}\n# then run /mcp inside Claude Code and authenticate in the browser`,
      },
      {
        authFlavor: "api-key",
        format: "command",
        template: `claude mcp add --transport http ${SERVER_KEY_TOKEN} ${MCP_URL_TOKEN} \\\n  --header "Authorization: Bearer ${API_KEY_TOKEN}"`,
      },
    ],
  },
  {
    id: "claude-app",
    name: "claude.ai / Claude Desktop",
    initials: "CL",
    transport: "streamable-http",
    authFlavors: ["oauth"],
    docsUrl: "https://support.anthropic.com/en/articles/11175166-about-custom-connectors-remote-mcp",
    snippets: [
      {
        authFlavor: "oauth",
        format: "url",
        template: MCP_URL_TOKEN,
      },
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    initials: "GP",
    transport: "streamable-http",
    authFlavors: ["oauth"],
    docsUrl: "https://developers.openai.com/api/docs/mcp",
    snippets: [
      {
        authFlavor: "oauth",
        format: "url",
        template: MCP_URL_TOKEN,
      },
    ],
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    initials: "CX",
    transport: "streamable-http",
    authFlavors: ["oauth", "api-key"],
    docsUrl: "https://developers.openai.com/codex/mcp",
    snippets: [
      {
        authFlavor: "oauth",
        format: "command",
        template: `codex mcp add ${SERVER_KEY_TOKEN} --url ${MCP_URL_TOKEN}\ncodex mcp login ${SERVER_KEY_TOKEN}`,
      },
      {
        authFlavor: "api-key",
        format: "toml",
        file: "~/.codex/config.toml",
        template: `[mcp_servers.${SERVER_KEY_TOKEN}]\nurl = "${MCP_URL_TOKEN}"\nhttp_headers = { Authorization = "Bearer ${API_KEY_TOKEN}" }`,
      },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    initials: "CU",
    transport: "streamable-http",
    authFlavors: ["oauth", "api-key"],
    docsUrl: "https://cursor.com/docs/context/mcp",
    snippets: [
      {
        authFlavor: "oauth",
        format: "json",
        file: "~/.cursor/mcp.json",
        template: `{\n  "mcpServers": {\n    "${SERVER_KEY_TOKEN}": {\n      "url": "${MCP_URL_TOKEN}"\n    }\n  }\n}`,
      },
      {
        authFlavor: "api-key",
        format: "json",
        file: "~/.cursor/mcp.json",
        template: `{\n  "mcpServers": {\n    "${SERVER_KEY_TOKEN}": {\n      "url": "${MCP_URL_TOKEN}",\n      "headers": {\n        "Authorization": "Bearer ${API_KEY_TOKEN}"\n      }\n    }\n  }\n}`,
      },
    ],
  },
  {
    id: "vscode",
    name: "VS Code (Copilot)",
    initials: "VS",
    transport: "streamable-http",
    authFlavors: ["oauth", "api-key"],
    docsUrl: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
    snippets: [
      {
        authFlavor: "oauth",
        format: "json",
        file: ".vscode/mcp.json",
        template: `{\n  "servers": {\n    "${SERVER_KEY_TOKEN}": {\n      "type": "http",\n      "url": "${MCP_URL_TOKEN}"\n    }\n  }\n}`,
      },
      {
        authFlavor: "api-key",
        format: "json",
        file: ".vscode/mcp.json",
        template: `{\n  "servers": {\n    "${SERVER_KEY_TOKEN}": {\n      "type": "http",\n      "url": "${MCP_URL_TOKEN}",\n      "headers": {\n        "Authorization": "Bearer ${API_KEY_TOKEN}"\n      }\n    }\n  }\n}`,
      },
    ],
  },
  {
    // Successor to Gemini CLI, which stopped serving requests in June 2026. Remote servers must
    // use `serverUrl`; the older `httpUrl`/`url` keys are not read.
    id: "antigravity",
    name: "Antigravity",
    initials: "AG",
    transport: "streamable-http",
    authFlavors: ["oauth", "api-key"],
    docsUrl: "https://antigravity.google/docs/mcp",
    snippets: [
      {
        authFlavor: "oauth",
        format: "json",
        file: "~/.gemini/config/mcp_config.json",
        template: `{\n  "mcpServers": {\n    "${SERVER_KEY_TOKEN}": {\n      "serverUrl": "${MCP_URL_TOKEN}"\n    }\n  }\n}`,
      },
      {
        authFlavor: "api-key",
        format: "json",
        file: "~/.gemini/config/mcp_config.json",
        template: `{\n  "mcpServers": {\n    "${SERVER_KEY_TOKEN}": {\n      "serverUrl": "${MCP_URL_TOKEN}",\n      "headers": {\n        "Authorization": "Bearer ${API_KEY_TOKEN}"\n      }\n    }\n  }\n}`,
      },
    ],
  },
  {
    id: "grok",
    name: "Grok CLI",
    initials: "GR",
    transport: "streamable-http",
    authFlavors: ["oauth", "api-key"],
    docsUrl: "https://docs.x.ai/build/features/mcp-servers",
    snippets: [
      {
        authFlavor: "oauth",
        format: "command",
        template: `grok mcp add --transport http ${SERVER_KEY_TOKEN} ${MCP_URL_TOKEN}\n# OAuth runs on first use; approve in the browser, or press i on the server in /mcps`,
      },
      {
        authFlavor: "api-key",
        format: "command",
        template: `grok mcp add --transport http ${SERVER_KEY_TOKEN} ${MCP_URL_TOKEN} \\\n  --header "Authorization: Bearer ${API_KEY_TOKEN}"`,
      },
    ],
  },
  {
    // Config key is `mcp`, not `mcpServers`, and remote servers need `"type": "remote"`. OAuth is
    // discovered automatically (dynamic client registration); `opencode mcp auth saas-template`
    // forces the browser flow early. A project-local `opencode.json` works the same way.
    id: "opencode",
    name: "opencode",
    initials: "OC",
    transport: "streamable-http",
    authFlavors: ["oauth", "api-key"],
    docsUrl: "https://opencode.ai/docs/mcp-servers/",
    snippets: [
      {
        authFlavor: "oauth",
        format: "json",
        file: "~/.config/opencode/opencode.json",
        template: `{\n  "mcp": {\n    "${SERVER_KEY_TOKEN}": {\n      "type": "remote",\n      "url": "${MCP_URL_TOKEN}",\n      "enabled": true\n    }\n  }\n}`,
      },
      {
        authFlavor: "api-key",
        format: "json",
        file: "~/.config/opencode/opencode.json",
        template: `{\n  "mcp": {\n    "${SERVER_KEY_TOKEN}": {\n      "type": "remote",\n      "url": "${MCP_URL_TOKEN}",\n      "enabled": true,\n      "headers": {\n        "Authorization": "Bearer ${API_KEY_TOKEN}"\n      }\n    }\n  }\n}`,
      },
    ],
  },
];

/** The endpoint every snippet points at, built from the fork's own site URL. */
export function getMcpEndpointUrl(): string {
  return `${SITE_URL}${MCP_PATH}`;
}

/**
 * Fills a snippet in. `apiKey` is only ever a real secret in the browser, right after a key is
 * created and while it is still on screen; everything rendered from the server uses the
 * placeholder, which is why interpolation lives here rather than in the registry.
 */
export function renderAgentClientSnippet({
  snippet,
  apiKey = API_KEY_PLACEHOLDER,
  mcpUrl = getMcpEndpointUrl(),
  serverKey = AGENT_SERVER_KEY,
}: {
  snippet: AgentClientSnippet;
  apiKey?: string;
  mcpUrl?: string;
  serverKey?: string;
}): string {
  return snippet.template
    .replaceAll(MCP_URL_TOKEN, mcpUrl)
    .replaceAll(API_KEY_TOKEN, apiKey)
    .replaceAll(SERVER_KEY_TOKEN, serverKey);
}

export function getAgentClientSnippet({
  client,
  authFlavor,
}: {
  client: AgentClient;
  authFlavor: AgentClientAuthFlavor;
}): AgentClientSnippet | undefined {
  return client.snippets.find((snippet) => snippet.authFlavor === authFlavor);
}

export function getAgentClientsForFlavor(authFlavor: AgentClientAuthFlavor): AgentClient[] {
  return AGENT_CLIENTS.filter((client) => client.authFlavors.includes(authFlavor));
}
