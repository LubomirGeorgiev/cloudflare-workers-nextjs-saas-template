import { readFile } from "node:fs/promises";
import { getD1Database } from "../../scripts/utils/parse-wrangler.mjs";
import { getE2ERuntimeEnv, scaleE2ETimeout } from "./e2e-environment.mjs";

const { E2E_BASE_URL: e2eBaseUrl, E2E_PREVIEW_LOG_FILE: previewLogFile } = getE2ERuntimeEnv();
const localExplorerD1Path = "/cdn-cgi/local/explorer/api/d1/database";
const localEmailPollDelayMs = 50;
// Local Queues may hold a message briefly while filling a delivery batch.
const localEmailTimeoutMs = scaleE2ETimeout(10_000);

interface LocalExplorerD1Response {
  success: boolean;
  errors?: { message: string }[];
  result?: { results?: { rows?: unknown[][] } }[] | null;
}

function getLocalD1QueryUrl(): URL {
  const databaseId = getD1Database()?.id;

  if (!databaseId) {
    throw new Error("Could not find a D1 database_id in wrangler.jsonc.");
  }

  return new URL(`${localExplorerD1Path}/${databaseId}/raw`, e2eBaseUrl);
}

function parseLocalExplorerResponse(body: string): LocalExplorerD1Response | undefined {
  try {
    return JSON.parse(body) as LocalExplorerD1Response;
  } catch {
    return undefined;
  }
}

// sqlite3 CLI list format: "|" between columns, one row per line, NULL as "".
function formatD1Rows(rows: unknown[][]): string {
  return rows
    .map((row) => row.map((value) => (value === null ? "" : String(value))).join("|"))
    .join("\n")
    .trim();
}

// Runs SQL inside the preview's own D1 Durable Object via Miniflare's local explorer API.
// Opening the SQLite file from another process races workerd's lock, and workerd then fails the
// app's D1 query at once (no busy wait), so a sign-in or form action randomly errors.
export async function queryLocalD1({ sql }: { sql: string }): Promise<string> {
  const response = await fetch(getLocalD1QueryUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const body = await response.text();
  const payload = parseLocalExplorerResponse(body);

  if (!response.ok || !payload?.success) {
    const message = payload?.errors?.map((error) => error.message).join("; ") ?? body.slice(0, 200);
    throw new Error(`Local D1 query failed (HTTP ${response.status}): ${message}\n${sql}`);
  }

  return formatD1Rows(payload.result?.at(-1)?.results?.rows ?? []);
}

export async function waitForLocalEmailUrl({
  email,
  pathname,
}: {
  email: string;
  pathname: string;
}): Promise<URL> {
  if (!previewLogFile) {
    throw new Error("E2E_PREVIEW_LOG_FILE is not configured.");
  }

  const timeoutAt = Date.now() + localEmailTimeoutMs;

  while (Date.now() < timeoutAt) {
    const previewLog = await readFile(previewLogFile, "utf8").catch(() => "");
    const lines = previewLog.split("\n");

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (lines[index]?.trim() !== `To: ${email}`) {
        continue;
      }

      const textFileLine = lines
        .slice(index + 1, index + 6)
        .find((line) => line.trim().startsWith("Text: "));
      const textFile = textFileLine?.trim().slice("Text: ".length);

      if (!textFile) {
        continue;
      }

      const emailText = await readFile(textFile, "utf8").catch(() => "");
      for (const match of emailText.matchAll(/https?:\/\/[^\s]+/g)) {
        const url = new URL(match[0]);

        if (url.pathname === pathname) {
          return url;
        }
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, localEmailPollDelayMs);
    });
  }

  throw new Error(`Timed out waiting for ${pathname} email sent to ${email}.`);
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
