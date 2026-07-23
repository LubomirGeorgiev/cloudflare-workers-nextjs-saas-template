import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getE2ERuntimeEnv } from "./e2e-environment.mjs";

const execFileAsync = promisify(execFile);
const {
  E2E_PREVIEW_LOG_FILE: previewLogFile,
  E2E_WRANGLER_STATE_DIR: wranglerStateDir,
} = getE2ERuntimeEnv();
const sqliteRetryDelayMs = 100;
const sqliteRetryLimit = 8;
const localEmailPollDelayMs = 50;
// Local Queues may hold a message briefly while filling a delivery batch.
const localEmailTimeoutMs = 10_000;

let d1SqlitePath: string | undefined;

async function findFirstSqliteFile({
  directory,
}: {
  directory: string;
}): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const sqliteFile = entries.find(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".sqlite") &&
      entry.name !== "metadata.sqlite"
  );

  return sqliteFile ? join(directory, sqliteFile.name) : undefined;
}

async function getD1SqlitePath(): Promise<string> {
  if (!wranglerStateDir) {
    throw new Error("E2E_WRANGLER_STATE_DIR is not configured.");
  }

  d1SqlitePath ??= await findFirstSqliteFile({
    directory: join(wranglerStateDir, "v3", "d1", "miniflare-D1DatabaseObject"),
  });

  if (!d1SqlitePath) {
    throw new Error("Could not find the local Miniflare D1 SQLite database.");
  }

  return d1SqlitePath;
}

async function querySqlite({
  databasePath,
  sql,
}: {
  databasePath: string;
  sql: string;
}): Promise<string> {
  for (let attempt = 0; attempt <= sqliteRetryLimit; attempt++) {
    try {
      const { stdout } = await execFileAsync("sqlite3", [databasePath, sql]);

      return stdout.trim();
    } catch (error) {
      if (!isSqliteLockedError(error) || attempt === sqliteRetryLimit) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, sqliteRetryDelayMs);
      });
    }
  }

  throw new Error("Unreachable SQLite retry state.");
}

function isSqliteLockedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("database is locked");
}

export async function queryLocalD1({ sql }: { sql: string }): Promise<string> {
  return querySqlite({
    databasePath: await getD1SqlitePath(),
    sql,
  });
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
