import { Effect, Layer, Metric } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { Driver } from "../src/driver.ts";
import {
  MetricsLayer,
  connectionsActive,
  queryCount,
  queryDuration,
} from "../src/driver-metrics.ts";
import * as SqliteDriver from "../src/drivers/sqlite.ts";

const driverLayer = MetricsLayer.pipe(Layer.provide(SqliteDriver.layer({ path: ":memory:" })));

const runWithLayer = <A>(eff: Effect.Effect<A, unknown, Driver>): Promise<A> =>
  Effect.runPromise(Effect.scoped(Effect.provide(eff, driverLayer)));

describe("MetricsLayer", () => {
  it("counter инкрементируется на каждом executeRaw (с тэгами op, dialect)", async () => {
    const taggedSelectSqlite = queryCount.pipe(
      Metric.tagged("op", "SELECT"),
      Metric.tagged("dialect", "sqlite"),
    );
    const value = await runWithLayer(
      Effect.gen(function* () {
        const driver = yield* Driver;
        yield* driver.executeRaw("SELECT 1", []);
        yield* driver.executeRaw("SELECT 2", []);
        return yield* Metric.value(taggedSelectSqlite);
      }),
    );
    expect(value.count).toBe(2);
  });

  it("histogram записывает duration", async () => {
    const value = await runWithLayer(
      Effect.gen(function* () {
        const driver = yield* Driver;
        yield* driver.executeRaw("SELECT 1", []);
        return yield* Metric.value(queryDuration);
      }),
    );
    // count в histogram-state — количество observations
    expect(value.count).toBeGreaterThanOrEqual(1);
    // и сумма >= 0 (длительность всегда неотрицательна)
    expect(value.sum).toBeGreaterThanOrEqual(0);
  });

  it("gauge возвращается в 0 после завершения запроса", async () => {
    const value = await runWithLayer(
      Effect.gen(function* () {
        const driver = yield* Driver;
        yield* driver.executeRaw("SELECT 1", []);
        return yield* Metric.value(connectionsActive);
      }),
    );
    expect(value.value).toBe(0);
  });
});
