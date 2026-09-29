// Each shard is one Vitest process whose main thread feeds its `workerd` runners, so a shard needs
// a core of its own. Measured on 4 and 6 cores: more workers per shard only wait on that thread.
const CPUS_PER_SHARD = 2;
const WORKERS_PER_SHARD = 3;

/** Shared with `vitest.integration.config.ts`, so the runner counts the files Vitest will run. */
export const INTEGRATION_TEST_FILES = "tests/integration/**/*.test.ts";
/** Set by the runner on each shard process; read by `vitest.integration.config.ts`. */
export const INTEGRATION_SHARD_ENV = "INTEGRATION_TEST_SHARD";
const SHARD_CACHE_DIR_PREFIX = "node_modules/.vite/integration-shard-";

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

/**
 * Vite commits its dependency optimizer cache with renames and no lock across processes, so
 * shards that share one cache can fail on a cold start. Each shard gets its own; a run without
 * shards keeps the Vite default.
 * @param {{ shard: string | undefined }} params
 * @returns {string | undefined}
 */
export function selectShardCacheDir({ shard }) {
  return shard ? `${SHARD_CACHE_DIR_PREFIX}${shard}` : undefined;
}
