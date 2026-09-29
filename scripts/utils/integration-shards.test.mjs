import { describe, expect, test } from "vitest";

import { selectShardCacheDir, selectShardPlan } from "./integration-shards.mjs";

const MANY_FILES = 1000;

describe("integration shard plan", () => {
  test("gives each shard two cores", () => {
    expect(selectShardPlan({ cpuCount: 4, testFileCount: MANY_FILES }).shardCount).toBe(2);
    expect(selectShardPlan({ cpuCount: 6, testFileCount: MANY_FILES }).shardCount).toBe(3);
    expect(selectShardPlan({ cpuCount: 7, testFileCount: MANY_FILES }).shardCount).toBe(3);
  });

  test("never plans more shards than test files", () => {
    expect(selectShardPlan({ cpuCount: 84, testFileCount: 41 }).shardCount).toBe(41);
    expect(selectShardPlan({ cpuCount: 24, testFileCount: 10 }).shardCount).toBe(10);
  });

  test("always runs at least one shard", () => {
    expect(selectShardPlan({ cpuCount: 1, testFileCount: MANY_FILES }).shardCount).toBe(1);
    expect(selectShardPlan({ cpuCount: 0, testFileCount: MANY_FILES }).shardCount).toBe(1);
    expect(selectShardPlan({ cpuCount: 8, testFileCount: 0 }).shardCount).toBe(1);
  });

  test("keeps the worker count per shard fixed", () => {
    expect(selectShardPlan({ cpuCount: 2, testFileCount: MANY_FILES }).workersPerShard)
      .toBe(selectShardPlan({ cpuCount: 32, testFileCount: MANY_FILES }).workersPerShard);
  });
});

describe("integration shard cache directory", () => {
  test("gives each shard a directory of its own", () => {
    expect(selectShardCacheDir({ shard: "1" })).not.toBe(selectShardCacheDir({ shard: "2" }));
  });

  test("keeps the Vite default for a run without shards", () => {
    expect(selectShardCacheDir({ shard: undefined })).toBeUndefined();
    expect(selectShardCacheDir({ shard: "" })).toBeUndefined();
  });
});
