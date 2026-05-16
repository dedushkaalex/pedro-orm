// drivers/pglite.ts
import { Effect, Layer } from "effect";
import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
import { Driver } from "../driver.ts";
import { PgDialect } from "../dialect.ts";
import {
  DbError,
  ForeignKeyViolationError,
  NotNullViolationError,
  UniqueViolationError,
  type DriverError,
} from "../errors.ts";

const make = (options: PGliteOptions = {}) =>
  Effect.gen(function* () {
    // acquireRelease гарантирует, что close() выполнится при размотке Scope
    const pg = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => PGlite.create(options),
        catch: (cause) => new DbError({ cause, sql: "<connect>", params: [] }),
      }),
      (instance) => Effect.promise(() => instance.close()),
    );

    return Driver.of({
      dialect: PgDialect,
      executeRaw: (sql, params) =>
        Effect.tryPromise({
          try: () => pg.query(sql, params as unknown[]),
          catch: (cause) => mapPgError(cause, sql, params),
        }).pipe(
          Effect.map((r) => ({
            rows: r.rows as ReadonlyArray<Record<string, unknown>>,
            affectedRows: r.affectedRows ?? 0,
          })),
        ),
    });
  });

// Postgres SQLSTATE -> tagged error
const mapPgError = (cause: unknown, sql: string, params: ReadonlyArray<unknown>): DriverError => {
  const code = (cause as { code?: string })?.code;
  const c = cause as { constraint?: string; message?: string };
  const constraint = c.constraint ?? c.message?.match(/constraint "([^"]+)"/)?.[1] ?? "unknown";

  if (code === "23505") return new UniqueViolationError({ constraint, sql });
  if (code === "23503") return new ForeignKeyViolationError({ constraint, sql });
  if (code === "23502") {
    const column = (cause as { column?: string }).column ?? "unknown";
    return new NotNullViolationError({ column, sql });
  }
  return new DbError({ cause, sql, params });
};

export const layer = (options?: PGliteOptions) => Layer.scoped(Driver, make(options));
