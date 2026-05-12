import { Effect, Layer } from "effect";
import { DriverDependency } from "./driver.ts";

export const TracingLayer = Layer.effect(
  DriverDependency,
  Effect.gen(function* () {
    const inner = yield* DriverDependency;

    return DriverDependency.of({
      dialect: inner.dialect,
      executeRaw: (sql, params) =>
        inner.executeRaw(sql, params).pipe(
          Effect.withSpan("db.query", {
            attributes: {
              "db.system": inner.dialect.id,
              "db.statement": sql,
              "db.params.count": params.length,
            },
          }),
          Effect.tap((r) =>
            Effect.annotateCurrentSpan({
              "db.rows.returned": r.rows.length,
              "db.rows.affected": r.affectedRows,
            }),
          ),
        ),
    });
  }),
);
