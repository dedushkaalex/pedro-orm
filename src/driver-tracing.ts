import { Effect, Layer } from "effect";
import { Driver } from "./driver.ts";

export const TracingLayer = Layer.effect(
  Driver,
  Effect.gen(function* () {
    const inner = yield* Driver;

    return Driver.of({
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
