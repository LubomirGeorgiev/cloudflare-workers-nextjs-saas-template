// The connect-your-agent registry is rendered verbatim into settings and the public docs, so what
// matters is that every snippet resolves against this fork's own URL and never leaks a secret it
// was not given. Assertions derive from the constants a fork rebrands.

import { describe, expect, test } from "vitest";

import { API_KEY_PREFIX_LIVE, MCP_PATH, SITE_URL } from "@/constants";
import {
  AGENT_CLIENTS,
  AGENT_SERVER_KEY,
  API_KEY_PLACEHOLDER,
  getAgentClientSnippet,
  getAgentClientsForFlavor,
  getMcpEndpointUrl,
  renderAgentClientSnippet,
  type AgentClient,
} from "@/constants/agent-clients";

const FRESH_SECRET = `${API_KEY_PREFIX_LIVE}exampleSecretValue`;

function idsWhere(predicate: (client: AgentClient) => boolean): string[] {
  return AGENT_CLIENTS.filter(predicate).map((client) => client.id);
}

describe("agent client registry", () => {
  test("the endpoint every snippet points at is derived from the site URL", () => {
    expect(getMcpEndpointUrl()).toBe(`${SITE_URL}${MCP_PATH}`);
  });

  // Failures are reported as lists of client ids so a broken entry names itself.
  test("client ids are unique and every client is renderable", () => {
    const ids = AGENT_CLIENTS.map((client) => client.id);

    expect(AGENT_CLIENTS.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(idsWhere((client) => client.snippets.length === 0)).toEqual([]);
    expect(idsWhere((client) => !client.docsUrl.startsWith("https://"))).toEqual([]);
    expect(idsWhere((client) => !client.initials)).toEqual([]);
  });

  // The two lists drive two different tabs; a client that claims a flavor with no snippet would
  // render an empty code block.
  test("every declared auth flavor has a snippet, and every snippet a declared flavor", () => {
    expect(
      idsWhere((client) =>
        client.authFlavors.some((authFlavor) => !getAgentClientSnippet({ client, authFlavor })),
      ),
    ).toEqual([]);
    expect(
      idsWhere((client) =>
        client.snippets.some((snippet) => !client.authFlavors.includes(snippet.authFlavor)),
      ),
    ).toEqual([]);
  });

  test("hosted assistants are offered over OAuth and CLI clients over both", () => {
    expect(getAgentClientsForFlavor("oauth").length).toBe(AGENT_CLIENTS.length);
    expect(getAgentClientsForFlavor("api-key").length).toBeGreaterThan(0);
  });
});

describe("renderAgentClientSnippet", () => {
  test("templates resolve to this fork's URL and server key, with no tokens left behind", () => {
    const unresolved = idsWhere((client) =>
      client.snippets.some((snippet) => {
        const rendered = renderAgentClientSnippet({ snippet });

        return (
          !rendered.includes(getMcpEndpointUrl())
          || rendered.includes("{{")
          || (snippet.authFlavor === "api-key"
            && (!rendered.includes(API_KEY_PLACEHOLDER) || !rendered.includes(AGENT_SERVER_KEY)))
        );
      }),
    );

    expect(unresolved).toEqual([]);
  });

  // The post-create dialog interpolates the real secret client-side while it is still on screen;
  // every other render must show the placeholder instead.
  test("a supplied secret replaces the placeholder and nothing else", () => {
    const client = AGENT_CLIENTS.find((candidate) => candidate.authFlavors.includes("api-key"))!;
    const snippet = getAgentClientSnippet({ client, authFlavor: "api-key" })!;

    const withSecret = renderAgentClientSnippet({ snippet, apiKey: FRESH_SECRET });

    expect(withSecret).toContain(FRESH_SECRET);
    expect(withSecret).not.toContain(API_KEY_PLACEHOLDER);
    expect(renderAgentClientSnippet({ snippet })).not.toContain(FRESH_SECRET);
  });
});
