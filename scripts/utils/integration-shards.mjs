// Each shard is one Vitest process whose main thread feeds its `workerd` runners, so a shard needs
// a core of its own. Measured on 4 and 6 cores: more workers per shard only wait on that thread.
const CPUS_PER_SHARD = 2;
const WORKERS_PER_SHARD = 3;

/**
 * How many integration shards to run side by side, and how many test files each runs at once.
 * @param {{ cpuCount: number }} params
 * @returns {{ shardCount: number, workersPerShard: number }}
 */
export function selectShardPlan({ cpuCount }) {
  return {
    shardCount: Math.max(1, Math.floor(cpuCount / CPUS_PER_SHARD)),
    workersPerShard: WORKERS_PER_SHARD,
  };
}
