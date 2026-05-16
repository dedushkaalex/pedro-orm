// schema/columns.ts

import { booleanCodec, dateCodec, jsonCodec, type Codec } from "../codec.ts";
import type { DbDialectId } from "../dialect.ts";

export type SqlType = "integer" | "real" | "text" | "blob" | "boolean" | "varchar";

export interface ColumnDef<
  T extends SqlType = SqlType,
  Null extends boolean = boolean,
  PK extends boolean = boolean,
  Default = never,
  HasD extends boolean = false,
  VarcharLength extends number = never,
> {
  readonly _type: T;
  readonly _nullable: Null;
  readonly _pk: PK;
  readonly _default?: Default;
  readonly _hasDefault: HasD;
  readonly _codec?: (dialectId: "postgres" | "sqlite") => Codec<unknown, unknown>;
  readonly _varcharLength?: VarcharLength;
}

export const withCodec = <TS, SQL, Column extends ColumnDef>(
  c: Column,
  codecFn: (d: DbDialectId) => Codec<TS, SQL>,
): Column => ({ ...c, _codec: codecFn as never });

export const withDefault = <
  const DefaultOut = never,
  T extends SqlType = SqlType,
  Null extends boolean = boolean,
  PK extends boolean = boolean,
  DefaultIn = unknown,
  HasDIn extends boolean = boolean,
>(
  c: ColumnDef<T, Null, PK, DefaultIn, HasDIn>,
  d?: DefaultOut,
): ColumnDef<T, Null, PK, DefaultOut, true> =>
  d !== undefined
    ? { ...c, _default: d, _hasDefault: true }
    : (c as unknown as ColumnDef<T, Null, PK, DefaultOut, true>);

// Smart constructors: каждый возвращает максимально узкий тип.
// HasD выводится из того, передан ли default: [T] extends [never] => false, иначе true.
type HasD<T> = [T] extends [never] ? false : true;

export const integer = <T extends number = never>(
  _default?: T,
): ColumnDef<"integer", false, false, T, HasD<T>> => {
  const base = { _type: "integer", _nullable: false, _pk: false, _hasDefault: false } as const;
  return (_default !== undefined ? { ...base, _default, _hasDefault: true } : base) as ColumnDef<
    "integer",
    false,
    false,
    T,
    HasD<T>
  >;
};

export const varchar = <T extends number = never>(
  num: T,
): ColumnDef<"varchar", false, false, never, false, T> => ({
  _type: "varchar",
  _nullable: false,
  _pk: false,
  _varcharLength: num,
  _hasDefault: false,
});

export const text = <T extends string = never>(
  _default?: T,
): ColumnDef<"text", false, false, T, HasD<T>> => {
  const base = { _type: "text", _nullable: false, _pk: false, _hasDefault: false } as const;
  return (_default !== undefined ? { ...base, _default, _hasDefault: true } : base) as ColumnDef<
    "text",
    false,
    false,
    T,
    HasD<T>
  >;
};

export const real = <T extends number = never>(
  _default?: T,
): ColumnDef<"real", false, false, T, HasD<T>> => {
  const base = { _type: "real", _nullable: false, _pk: false, _hasDefault: false } as const;
  return (_default !== undefined ? { ...base, _default, _hasDefault: true } : base) as ColumnDef<
    "real",
    false,
    false,
    T,
    HasD<T>
  >;
};

export const boolean = <T extends boolean = never>(
  _default?: T,
): ColumnDef<"boolean", false, false, T, HasD<T>> => {
  const base = withCodec(
    { _type: "boolean", _nullable: false, _pk: false, _hasDefault: false } as ColumnDef<
      "boolean",
      false,
      false,
      never,
      false
    >,
    booleanCodec,
  );
  return (_default !== undefined ? { ...base, _default, _hasDefault: true } : base) as ColumnDef<
    "boolean",
    false,
    false,
    T,
    HasD<T>
  >;
};

export const timestamp = <T extends string = never>(
  _default?: T,
): ColumnDef<"text", false, false, T, HasD<T>> => {
  const base = withCodec(
    { _type: "text", _nullable: false, _pk: false, _hasDefault: false } as ColumnDef<
      "text",
      false,
      false,
      never,
      false
    >,
    dateCodec,
  );
  return (_default !== undefined ? { ...base, _default, _hasDefault: true } : base) as ColumnDef<
    "text",
    false,
    false,
    T,
    HasD<T>
  >;
};

export const json = <T, D = never>(_default?: D): ColumnDef<"text", false, false, D, HasD<D>> => {
  const base = withCodec(
    { _type: "text", _nullable: false, _pk: false, _hasDefault: false } as ColumnDef<
      "text",
      false,
      false,
      never,
      false
    >,
    jsonCodec<T>,
  );
  return (_default !== undefined ? { ...base, _default, _hasDefault: true } : base) as ColumnDef<
    "text",
    false,
    false,
    D,
    HasD<D>
  >;
};

// Modifiers: иммутабельно "уточняют" column на уровне типов
export const nullable = <T extends SqlType, PK extends boolean, D, H extends boolean>(
  c: ColumnDef<T, false, PK, D, H>,
): ColumnDef<T, true, PK, D, H> => ({ ...c, _nullable: true });

export const primaryKey = <T extends SqlType, N extends boolean, D, H extends boolean>(
  c: ColumnDef<T, N, false, D, H>,
): ColumnDef<T, N, true, D, H> => ({ ...c, _pk: true });
