// example/lesson-1.ts
import { Effect, Layer } from "effect";
import { Driver } from "../src/driver.ts";
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

// Tracing layer оборачивает базовый driver. Меняется только нижний
// слой, бизнес-код выше не знает, на каком движке исполняется.
const sqliteLayer = TracingLayer.pipe(Layer.provide(SqliteDriver.layer({ path: ":memory:" })));
const pgLayer = TracingLayer.pipe(Layer.provide(PGliteDriver.layer({})));

await Effect.runPromise(
  Effect.scoped(program).pipe(
    Effect.provide(sqliteLayer),
    Effect.annotateLogs({ engine: "sqlite" }),
  ),
);
await Effect.runPromise(
  Effect.scoped(program).pipe(Effect.provide(pgLayer), Effect.annotateLogs({ engine: "pglite" })),
);
