import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tmpDir = resolve(projectRoot, "tmp/e2e");
const stateDir = resolve(tmpDir, "wrangler-state");
const previewLogFile = resolve(tmpDir, "preview.log");
const buildFingerprintFile = resolve(tmpDir, "build-fingerprint.json");
const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:18788";
const previewPort = new URL(baseUrl).port || "18788";
const buildCacheVersion = 3;
const buildInputExactFiles = [
  ".env",
  ".env.example",
  ".env.local",
  ".env.production",
  ".env.test",
  "cms.config.ts",
  "components.json",
  "next-env.d.ts",
  "next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vite.config.ts",
  "worker-entrypoint.ts",
  "wrangler.jsonc",
];
const buildInputPathPrefixes = ["public/", "src/"];
const ignoredBuildInputExactFiles = ["vitest.e2e.config.ts"];
const ignoredBuildInputPathPrefixes = ["tests/e2e/"];
const buildInputExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".mjs",
  ".mts",
  ".scss",
  ".sql",
  ".ts",
  ".tsx",
]);
const requiredBuildOutputs = [
  "dist/client/.vite/manifest.json",
  "dist/server/__vite_rsc_assets_manifest.js",
  "dist/server/index.js",
  "dist/server/ssr/__vite_rsc_assets_manifest.js",
  "dist/server/ssr/index.js",
  "dist/server/wrangler.json",
];

export function getE2ERuntimeEnv() {
  return {
    E2E_BASE_URL: baseUrl,
    E2E_PREVIEW_LOG_FILE: previewLogFile,
    E2E_WRANGLER_STATE_DIR: stateDir,
    NODE_ENV: "test",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
    TURNSTILE_SECRET_KEY: "",
  };
}

export function createE2EEnvironment() {
  const runtimeEnv = getE2ERuntimeEnv();
  let previewProcess;
  let previewLog = "";
  const runningCommands = new Set();

  function log(message) {
    process.stdout.write(`[e2e] ${message}\n`);
  }

  function ensureTmpDirectory() {
    mkdirSync(tmpDir, { recursive: true });
  }

  function applyRuntimeEnv() {
    Object.assign(process.env, runtimeEnv);
  }

  function appendPreviewLog(chunk) {
    const message = chunk.toString();
    previewLog = `${previewLog}${message}`.slice(-12_000);
    appendFileSync(previewLogFile, message);
  }

  function formatCommand(command, args) {
    return [command, ...args].join(" ");
  }

  function formatDuration(startedAt) {
    return `${((Date.now() - startedAt) / 1_000).toFixed(1)}s`;
  }

  function getSortedBuildFiles() {
    const gitFiles = [
      ...getGitFiles(["ls-files", "-z"]),
      ...getGitFiles(["ls-files", "--others", "--exclude-standard", "-z"]),
    ];

    return [...new Set(gitFiles.filter(isBuildInputFile))].sort();
  }

  function getGitFiles(args) {
    const output = runCommand("git", args, { quiet: true });

    if (!output) {
      return [];
    }

    return output.split("\0").filter(Boolean);
  }

  function isBuildInputFile(file) {
    if (isIgnoredBuildInputFile(file)) {
      return false;
    }

    return (
      buildInputExactFiles.includes(file) ||
      buildInputPathPrefixes.some((prefix) => file.startsWith(prefix)) ||
      buildInputExtensions.has(getFileExtension(file))
    );
  }

  function isIgnoredBuildInputFile(file) {
    return (
      ignoredBuildInputExactFiles.includes(file) ||
      ignoredBuildInputPathPrefixes.some((prefix) => file.startsWith(prefix))
    );
  }

  function getFileExtension(file) {
    const extensionStart = file.lastIndexOf(".");

    return extensionStart >= 0 ? file.slice(extensionStart) : "";
  }

  function getBuildFingerprint() {
    const hash = createHash("sha256");

    hash.update(`e2e-build-cache:${buildCacheVersion}\n`);
    hash.update(`node:${process.version}\n`);

    for (const file of getSortedBuildFiles()) {
      const absolutePath = resolve(projectRoot, file);
      const stats = statSync(absolutePath);

      hash.update(`file:${file}:${stats.size}\n`);
      hash.update(readFileSync(absolutePath));
      hash.update("\n");
    }

    return hash.digest("hex");
  }

  function hasRequiredBuildOutputs() {
    return getMissingRequiredBuildOutputs().length === 0;
  }

  function getMissingRequiredBuildOutputs() {
    return requiredBuildOutputs.filter((file) => !existsSync(resolve(projectRoot, file)));
  }

  function readBuildFingerprint() {
    if (!existsSync(buildFingerprintFile)) {
      return undefined;
    }

    try {
      const stamp = JSON.parse(readFileSync(buildFingerprintFile, "utf8"));

      return typeof stamp.fingerprint === "string" ? stamp.fingerprint : undefined;
    } catch {
      return undefined;
    }
  }

  function writeBuildFingerprint(fingerprint) {
    writeFileSync(
      buildFingerprintFile,
      `${JSON.stringify(
        {
          fingerprint,
          version: buildCacheVersion,
          writtenAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    );
  }

  function runCommand(command, args, options = {}) {
    const result = spawnSync(command, args, {
      cwd: projectRoot,
      encoding: "utf8",
      input: options.input,
      stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...options.env,
      },
    });

    if (result.status === 0) {
      if (!options.quiet) {
        process.stdout.write(result.stdout ?? "");
        process.stderr.write(result.stderr ?? "");
      }

      return result.stdout?.trim() ?? "";
    }

    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Command failed: ${formatCommand(command, args)}`);
  }

  function runCommandAsync(command, args, options = {}) {
    return new Promise((resolveCommand, rejectCommand) => {
      let stdout = "";
      let stderr = "";
      const childProcess = spawn(command, args, {
        cwd: projectRoot,
        env: {
          ...process.env,
          ...options.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      runningCommands.add(childProcess);

      childProcess.stdout?.on("data", (chunk) => {
        const message = chunk.toString();
        stdout += message;

        if (!options.quiet) {
          process.stdout.write(message);
        }
      });

      childProcess.stderr?.on("data", (chunk) => {
        const message = chunk.toString();
        stderr += message;

        if (!options.quiet) {
          process.stderr.write(message);
        }
      });

      childProcess.once("error", (error) => {
        runningCommands.delete(childProcess);
        rejectCommand(error);
      });
      childProcess.once("close", (status) => {
        runningCommands.delete(childProcess);

        if (status === 0) {
          resolveCommand(stdout.trim());
          return;
        }

        if (options.quiet) {
          process.stdout.write(stdout);
          process.stderr.write(stderr);
        }

        rejectCommand(new Error(`Command failed: ${formatCommand(command, args)}`));
      });

      if (options.input) {
        childProcess.stdin.end(options.input);
      } else {
        childProcess.stdin.end();
      }
    });
  }

  async function waitForPreview() {
    const startedAt = Date.now();
    const timeoutMs = 120_000;
    let lastError;

    while (Date.now() - startedAt < timeoutMs) {
      if (previewProcess && previewProcess.exitCode !== null) {
        throw new Error(`Wrangler preview exited early.\n\n${previewLog}`);
      }

      try {
        const response = await fetch(baseUrl, { redirect: "manual" });

        if (response.status < 500) {
          return;
        }

        lastError = new Error(`Preview returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }

    throw new Error(
      `Timed out waiting for ${baseUrl}.\nLast error: ${String(lastError)}\n\n${previewLog}`
    );
  }

  function stopPreview() {
    if (!previewProcess?.pid || previewProcess.exitCode !== null) {
      return;
    }

    try {
      process.kill(-previewProcess.pid, "SIGTERM");
    } catch {
      previewProcess.kill("SIGTERM");
    }
  }

  function stopRunningCommands() {
    for (const childProcess of runningCommands) {
      childProcess.kill("SIGTERM");
    }
  }

  function stopAll() {
    stopRunningCommands();
    stopPreview();
  }

  function registerSignalHandlers() {
    process.once("SIGINT", () => {
      stopAll();
      process.exit(130);
    });

    process.once("SIGTERM", () => {
      stopAll();
      process.exit(143);
    });
  }

  async function prepareD1(dbName) {
    const startedAt = Date.now();
    log("Resetting isolated Wrangler/D1 state");
    rmSync(stateDir, { recursive: true, force: true });

    log("Applying D1 migrations");
    await runCommandAsync(
      "pnpm",
      [
        "wrangler",
        "d1",
        "migrations",
        "apply",
        dbName,
        "--local",
        "--persist-to",
        stateDir,
      ],
      { input: "yes\n", quiet: true }
    );

    log("Seeding D1");
    await runCommandAsync(
      "pnpm",
      [
        "wrangler",
        "d1",
        "execute",
        dbName,
        "--local",
        "--persist-to",
        stateDir,
        "--file",
        "./src/db/seed.sql",
      ],
      { quiet: true }
    );

    log(`D1 ready (${formatDuration(startedAt)})`);
  }

  async function buildPreview() {
    const startedAt = Date.now();
    const fingerprint = getBuildFingerprint();

    if (hasRequiredBuildOutputs() && readBuildFingerprint() === fingerprint) {
      log("Reusing fresh Vinext preview build");
      return;
    }

    log("Building Vinext preview");
    await runCommandAsync("pnpm", ["build"], { env: runtimeEnv, quiet: true });
    const missingBuildOutputs = getMissingRequiredBuildOutputs();

    if (missingBuildOutputs.length > 0) {
      throw new Error(
        `Vinext preview build is missing required output files: ${missingBuildOutputs.join(", ")}`
      );
    }

    writeBuildFingerprint(fingerprint);
    log(`Vinext preview built (${formatDuration(startedAt)})`);
  }

  async function startPreview() {
    log(`Starting Wrangler preview at ${baseUrl}`);
    previewProcess = spawn(
      "pnpm",
      ["wrangler", "dev", "--local", `--port=${previewPort}`, `--persist-to=${stateDir}`],
      {
        cwd: projectRoot,
        detached: true,
        env: {
          ...process.env,
          ...runtimeEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    previewProcess.stdout?.on("data", appendPreviewLog);
    previewProcess.stderr?.on("data", appendPreviewLog);

    await waitForPreview();
    log("Preview ready");
  }

  async function prepareAndStart() {
    applyRuntimeEnv();
    ensureTmpDirectory();
    writeFileSync(previewLogFile, "");

    const setupStartedAt = Date.now();
    const dbName = runCommand("node", ["scripts/get-db-name.mjs"], { quiet: true });

    await Promise.all([prepareD1(dbName), buildPreview()]);
    log(`E2E setup ready (${formatDuration(setupStartedAt)})`);
    await startPreview();
  }

  return {
    baseUrl,
    previewLogFile,
    projectRoot,
    runtimeEnv,
    stateDir,
    tmpDir,
    prepareAndStart,
    registerSignalHandlers,
    stopAll,
  };
}
