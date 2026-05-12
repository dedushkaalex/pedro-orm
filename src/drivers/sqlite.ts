// drivers/sqlite.ts
import { Effect, Layer } from "effect";
import Database from "better-sqlite3";
import { DriverDependency } from "../driver.ts";
import { SqliteDialect } from "../dialect.ts";
import {
  DbError,
  UniqueViolationError,
  ForeignKeyViolationError,
  type DriverError,
} from "../errors.ts";

export interface SqliteOptions {
  readonly path: string; // ":memory:" или путь к файлу
  readonly readonly?: boolean;
  readonly enableForeignKeys?: boolean; // default true
}

const make = (options: SqliteOptions) =>
  Effect.gen(function* () {
    const db = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const instance = new Database(options.path, { readonly: options.readonly ?? false });
          // Foreign keys в SQLite по умолчанию OFF, всегда включаем
          if (options.enableForeignKeys !== false) {
            instance.pragma("foreign_keys = ON");
          }
          return instance;
        },
        catch: (cause) => new DbError({ cause, sql: "<connect>", params: [] }),
      }),
      (instance) => Effect.sync(() => instance.close()),
    );

    return DriverDependency.of({
      dialect: SqliteDialect,
      executeRaw: (sql, params) =>
        Effect.try({
          try: () => {
            const stmt = db.prepare(sql);
            if (stmt.reader) {
              const rows = stmt.all(...(params as unknown[])) as Record<string, unknown>[];
              return { rows, affectedRows: 0 };
            }
            const info = stmt.run(...(params as unknown[]));
            return {
              rows: [],
              affectedRows: info.changes,
              lastInsertRowId: info.lastInsertRowid,
            };
          },
          catch: (cause) => mapSqliteError(cause, sql, params),
        }),
    });
  });

const mapSqliteError = (
  cause: unknown,
  sql: string,
  params: ReadonlyArray<unknown>,
): DriverError => {
  const code = (cause as { code?: string })?.code;
  const msg = (cause as Error)?.message ?? "";

  if (code?.startsWith("SQLITE_CONSTRAINT_UNIQUE") || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    const constraint = msg.match(/UNIQUE constraint failed: (.+)$/)?.[1] ?? "unknown";
    return new UniqueViolationError({ constraint, sql });
  }
  if (code?.startsWith("SQLITE_CONSTRAINT_FOREIGNKEY")) {
    return new ForeignKeyViolationError({ constraint: "fk_violation", sql });
  }
  return new DbError({ cause, sql, params });
};

export const layer = (options: SqliteOptions) => Layer.scoped(DriverDependency, make(options));
