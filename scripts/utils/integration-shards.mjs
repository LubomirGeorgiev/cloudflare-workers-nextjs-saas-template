// Each shard is one Vitest process whose main thread feeds its `workerd` runners, so a shard needs
// a core of its own. Measured on 4 and 6 cores: more workers per shard only wait on that thread.
const CPUS_PER_SHARD = 2;
const WORKERS_PER_SHARD = 3;

/** Shared with `vitest.integration.config.ts`, so the runner counts the files Vitest will run. */
export const INTEGRATION_TEST_FILES = "tests/integration/**/*.test.ts";

/**
 * How many integration shards to run side by side, and how many test files each runs at once.
 * Vitest fails a shard that gets no files, so there are never more shards than files.
 * @param {{ cpuCount: number, testFileCount: number }} params
 * @returns {{ shardCount: number, workersPerShard: number }}
 */
export function selectShardPlan({ cpuCount, testFileCount }) {
  return {
    shardCount: Math.max(1, Math.min(testFileCount, Math.floor(cpuCount / CPUS_PER_SHARD))),
    workersPerShard: WORKERS_PER_SHARD,
  };
}
