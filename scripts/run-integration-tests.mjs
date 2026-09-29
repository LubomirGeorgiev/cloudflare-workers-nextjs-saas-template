import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { selectShardPlan } from "./utils/integration-shards.mjs";

const CONFIG_FILE = "vitest.integration.config.ts";
const VITEST_BIN = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");

const passedArgs = process.argv.slice(2);
const { shardCount, workersPerShard } = selectShardPlan({ cpuCount: availableParallelism() });

// A filtered run can match fewer files than there are shards, and a shard with no files fails.
if (passedArgs.length > 0 || shardCount === 1) {
  process.exitCode = await runVitest(["run", "--config", CONFIG_FILE, ...passedArgs]);
} else {
  process.exitCode = await runShards();
}

// One Vitest process feeds every `workerd` runner from a single main thread, which caps the suite
// at about two busy cores. Separate processes each bring their own main thread.
async function runShards() {
  const reportsDir = await mkdtemp(join(tmpdir(), "integration-reports-"));

  try {
    const shardExitCodes = await Promise.all(
      Array.from({ length: shardCount }, (_, index) => runVitest([
        "run",
        "--config",
        CONFIG_FILE,
        `--shard=${index + 1}/${shardCount}`,
        `--maxWorkers=${workersPerShard}`,
        "--reporter=blob",
        `--outputFile=${join(reportsDir, `blob-${index + 1}.json`)}`,
      ])),
    );
    const mergeExitCode = await runVitest(["run", "--config", CONFIG_FILE, `--mergeReports=${reportsDir}`]);

    // A shard that crashed writes no blob, so the merged report alone would not show it.
    return [...shardExitCodes, mergeExitCode].every((code) => code === 0) ? 0 : 1;
  } finally {
    await rm(reportsDir, { recursive: true, force: true });
  }
}

function runVitest(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VITEST_BIN, ...args], { stdio: "inherit" });

    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
