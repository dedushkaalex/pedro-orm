import { Context, type Effect } from "effect";
import type { Dialect } from "./dialect.ts";
import type { DriverError } from "./errors.ts";

export interface RawResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly affectedRows: number;
  readonly lastInsertRowId?: number | bigint;
}

export interface DriverImpl {
  readonly dialect: Dialect;
  readonly executeRaw: (
    sql: string,
    params: ReadonlyArray<unknown>,
  ) => Effect.Effect<RawResult, DriverError>;
}

export class DriverDependency extends Context.Tag("our-orm/Driver")<
  DriverDependency,
  DriverImpl
>() {}
