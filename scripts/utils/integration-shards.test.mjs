import { describe, expect, test } from "vitest";

import { selectShardPlan } from "./integration-shards.mjs";

describe("integration shard plan", () => {
  test("gives each shard two cores", () => {
    expect(selectShardPlan({ cpuCount: 4 }).shardCount).toBe(2);
    expect(selectShardPlan({ cpuCount: 6 }).shardCount).toBe(3);
    expect(selectShardPlan({ cpuCount: 7 }).shardCount).toBe(3);
  });

  test("always runs at least one shard", () => {
    expect(selectShardPlan({ cpuCount: 1 }).shardCount).toBe(1);
    expect(selectShardPlan({ cpuCount: 0 }).shardCount).toBe(1);
  });

  test("keeps the worker count per shard fixed", () => {
    expect(selectShardPlan({ cpuCount: 2 }).workersPerShard)
      .toBe(selectShardPlan({ cpuCount: 32 }).workersPerShard);
  });
});
