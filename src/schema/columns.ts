// schema/columns.ts

import { booleanCodec, dateCodec, jsonCodec, type Codec } from "../codec.ts";
import type { DbDialectId } from "../dialect.ts";

export type SqlType = "integer" | "real" | "text" | "blob" | "boolean";

// Column definition трекает три параметра на уровне типов:
// - SQL type
// - nullable?
// - primary key?
export interface ColumnDef<
  T extends SqlType = SqlType,
  Null extends boolean = boolean,
  PK extends boolean = boolean,
> {
  readonly _type: T;
  readonly _nullable: Null;
  readonly _pk: PK;
  readonly _default?: unknown;
  readonly _codec?: (dialectId: "postgres" | "sqlite") => Codec<unknown, unknown>;
}

export const withCodec = <TS, SQL, Column extends ColumnDef>(
  c: Column,
  codecFn: (d: DbDialectId) => Codec<TS, SQL>,
): Column => ({ ...c, _codec: codecFn as never });

// Smart constructors: каждый возвращает максимально узкий тип
export const integer = (): ColumnDef<"integer", false, false> => ({
  _type: "integer",
  _nullable: false,
  _pk: false,
});

export const text = (): ColumnDef<"text", false, false> => ({
  _type: "text",
  _nullable: false,
  _pk: false,
});

export const real = (): ColumnDef<"real", false, false> => ({
  _type: "real",
  _nullable: false,
  _pk: false,
});

export const boolean = (): ColumnDef<"boolean", false, false> =>
  withCodec(
    {
      _type: "boolean",
      _nullable: false,
      _pk: false,
    },
    booleanCodec,
  );

export const timestamp = (): ColumnDef<"text", false, false> =>
  withCodec({ _type: "text", _nullable: false, _pk: false }, dateCodec);

export const json = <T>(): ColumnDef<"text", false, false> =>
  withCodec({ _type: "text", _nullable: false, _pk: false }, jsonCodec<T>);

// Modifiers: иммутабельно "уточняют" column на уровне типов
export const nullable = <T extends SqlType, PK extends boolean>(
  c: ColumnDef<T, false, PK>,
): ColumnDef<T, true, PK> => ({ ...c, _nullable: true });

export const primaryKey = <T extends SqlType, N extends boolean>(
  c: ColumnDef<T, N, false>,
): ColumnDef<T, N, true> => ({ ...c, _pk: true });
