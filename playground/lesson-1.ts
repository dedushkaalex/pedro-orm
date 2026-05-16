// example/lesson-1.ts
import { Effect, Layer, Metric } from "effect";
import { Driver } from "../src/driver.ts";
import {
  MetricsLayer,
  connectionsActive,
  queryCount,
  queryDuration,
} from "../src/driver-metrics.ts";
import { TracingLayer } from "../src/driver-tracing.ts";
import * as PGliteDriver from "../src/drivers/pglite.ts";
import * as SqliteDriver from "../src/drivers/sqlite.ts";

const program = Effect.gen(function* () {
  const db = yield* Driver;
  const ph = (n: number) => db.dialect.placeholder(n);
  const id = db.dialect.quoteIdentifier;

  yield* db.executeRaw(
    `CREATE TABLE IF NOT EXISTS ${id("users")} (
       id ${db.dialect.id === "postgres" ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY"},
       name TEXT NOT NULL,
       email TEXT UNIQUE NOT NULL,
       active ${db.dialect.id === "postgres" ? "BOOLEAN" : "INTEGER"} NOT NULL
     )`,
    [],
  );

  // На PGlite даст $1, $2, $3; на SQLite ?, ?, ?
  // bool(true) проходит через codec и становится `1` на SQLite
  const inserted = yield* db.executeRaw(
    `INSERT INTO ${id("users")} (name, email, active) VALUES (${ph(1)}, ${ph(2)}, ${ph(3)}) RETURNING *`,
    ["Vassiliy", "v@example.com", db.dialect.id === "sqlite" ? 1 : true],
  );

  return inserted.rows;
}).pipe(
  Effect.catchTag("UniqueViolationError", (e) =>
    Effect.logWarning(`User already exists: ${e.constraint}`).pipe(Effect.as([])),
  ),
  Effect.tap((rows) => Effect.log("inserted rows", rows)),
);

// Layer-стек: SqliteDriver → TracingLayer → MetricsLayer.
// MetricsLayer наружу — duration в гистограмме включает overhead трейсинга,
// что соответствует видимой задержке для вызывающего кода.
const sqliteLayer = MetricsLayer.pipe(
  Layer.provide(TracingLayer.pipe(Layer.provide(SqliteDriver.layer({ path: ":memory:" })))),
);
const pgLayer = MetricsLayer.pipe(
  Layer.provide(TracingLayer.pipe(Layer.provide(PGliteDriver.layer({})))),
);

// Сводка метрик в лог после прогона.
// Важно: порядок тэгов должен совпадать с порядком в driver-metrics.ts (op, потом dialect),
// иначе Metric.value читает другую серию и видит count: 0.
const dumpMetrics = (engine: "sqlite" | "postgres") =>
  Effect.gen(function* () {
    const taggedFor = (op: string) =>
      queryCount.pipe(Metric.tagged("op", op), Metric.tagged("dialect", engine));

    const [createCount, insertCount, duration, active] = yield* Effect.all([
      Metric.value(taggedFor("CREATE")),
      Metric.value(taggedFor("INSERT")),
      Metric.value(queryDuration),
      Metric.value(connectionsActive),
    ]);

    yield* Effect.log("metrics", {
      engine,
      counts: { create: createCount.count, insert: insertCount.count },
      duration: { count: duration.count, sum: duration.sum, mean: duration.sum / duration.count },
      activeConnections: active.value,
    });
  });

await Effect.runPromise(
  Effect.scoped(program).pipe(
    Effect.tap(() => dumpMetrics("sqlite")),
    Effect.provide(sqliteLayer),
    Effect.annotateLogs({ engine: "sqlite" }),
  ),
);
await Effect.runPromise(
  Effect.scoped(program).pipe(
    Effect.tap(() => dumpMetrics("postgres")),
    Effect.provide(pgLayer),
    Effect.annotateLogs({ engine: "pglite" }),
  ),
);
