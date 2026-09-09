// The bounded fan-out built on `chunk`. What matters is that nothing is dropped or reordered,
// and that no more than one batch is ever in flight.

import { describe, expect, test } from "vitest";

import { mapInBatches } from "@/utils/map-in-batches";

describe("mapInBatches", () => {
  test("returns results in input order, whatever order they settle in", async () => {
    const results = await mapInBatches({
      items: [30, 10, 20],
      batchSize: 2,
      fn: async (item) => item,
    });

    expect(results).toEqual([30, 10, 20]);
  });

  // The index is the item's place in the whole list, not in its batch: a caller that reports
  // progress or looks something up by position depends on it counting across batch boundaries.
  test("passes the index within the whole list", async () => {
    const seen: number[] = [];

    await mapInBatches({
      items: ["a", "b", "c", "d", "e"],
      batchSize: 2,
      fn: async (_item, index) => {
        seen.push(index);
      },
    });

    expect([...seen].sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4]);
  });

  test("never dispatches more than `batchSize` at once", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapInBatches({
      items: Array.from({ length: 11 }, (_unused, index) => index),
      batchSize: 3,
      fn: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
      },
    });

    expect(peak).toBeLessThanOrEqual(3);
  });
});
