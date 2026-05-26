import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getE2ERuntimeEnv } from "./e2e-environment.mjs";

const execFileAsync = promisify(execFile);
const wranglerStateDir = getE2ERuntimeEnv().E2E_WRANGLER_STATE_DIR;

let d1SqlitePath: string | undefined;
let kvSqlitePath: string | undefined;
let kvBlobDirectory: string | undefined;

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

async function getKVSqlitePath(): Promise<string> {
  if (!wranglerStateDir) {
    throw new Error("E2E_WRANGLER_STATE_DIR is not configured.");
  }

  kvSqlitePath ??= await findFirstSqliteFile({
    directory: join(wranglerStateDir, "v3", "kv", "miniflare-KVNamespaceObject"),
  });

  if (!kvSqlitePath) {
    throw new Error("Could not find the local Miniflare KV SQLite database.");
  }

  return kvSqlitePath;
}

async function getKVBlobDirectory(): Promise<string> {
  if (!wranglerStateDir) {
    throw new Error("E2E_WRANGLER_STATE_DIR is not configured.");
  }

  if (kvBlobDirectory) {
    return kvBlobDirectory;
  }

  const kvDirectory = join(wranglerStateDir, "v3", "kv");
  const namespaceDirectories = (await readdir(kvDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "miniflare-KVNamespaceObject")
    .map((entry) => entry.name);

  if (namespaceDirectories.length !== 1) {
    throw new Error(
      `Expected exactly one local Miniflare KV namespace directory, found ${namespaceDirectories.length}.`
    );
  }

  kvBlobDirectory = join(kvDirectory, namespaceDirectories[0]!, "blobs");

  return kvBlobDirectory;
}

async function querySqlite({
  databasePath,
  sql,
}: {
  databasePath: string;
  sql: string;
}): Promise<string> {
  const { stdout } = await execFileAsync("sqlite3", [databasePath, sql]);

  return stdout.trim();
}

export async function queryLocalD1({ sql }: { sql: string }): Promise<string> {
  return querySqlite({
    databasePath: await getD1SqlitePath(),
    sql,
  });
}

export async function listLocalKVEntries({
  prefix,
}: {
  prefix: string;
}): Promise<Array<{ key: string; value: string }>> {
  const [databasePath, blobDirectory] = await Promise.all([
    getKVSqlitePath(),
    getKVBlobDirectory(),
  ]);
  const output = await querySqlite({
    databasePath,
    sql: `select key, blob_id from _mf_entries where key like ${sqlStringLiteral(`${prefix}%`)};`,
  });

  const entries: Array<{ key: string; value: string }> = [];

  for (const line of output.split("\n")) {
    const [key, blobId] = line.split("|");

    if (!key || !blobId || !key.startsWith(prefix)) {
      continue;
    }

    entries.push({
      key,
      value: await readFile(join(blobDirectory, blobId), "utf8"),
    });
  }

  return entries;
}

export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
