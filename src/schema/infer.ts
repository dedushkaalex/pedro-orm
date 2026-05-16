import { integer, nullable, primaryKey, text, type ColumnDef } from "./columns.ts";
import { table, type TableDef } from "./table.ts";

export type SqlToTs = {
  integer: number;
  real: number;
  text: string;
  boolean: boolean;
  blob: Uint8Array;
};

// Достаем TS-тип одной колонки с учетом nullable
export type InferColumn<C extends ColumnDef> = C["_nullable"] extends true
  ? SqlToTs[C["_type"]] | null
  : SqlToTs[C["_type"]];

// Row-тип таблицы: запись из всех ее колонок
export type InferRow<T extends TableDef<string, any>> = {
  [K in keyof T["_columns"]]: InferColumn<T["_columns"][K]>;
};

// Helpers для читаемости — раскладываем логику InferInsert на шаги.
type Prettify<T> = { [K in keyof T]: T[K] } & {};
type Cols<T> = T extends TableDef<string, infer C> ? C : never;
type Col<T, K extends keyof Cols<T>> = Cols<T>[K];

// Optional в insert = PK ИЛИ has default.
type IsOptional<C> = C extends { _pk: true }
  ? true
  : C extends { _hasDefault: true }
    ? true
    : false;

type OptionalKeys<T> = {
  [K in keyof Cols<T>]: IsOptional<Col<T, K>> extends true ? K : never;
}[keyof Cols<T>];

type RequiredKeys<T> = Exclude<keyof Cols<T>, OptionalKeys<T>>;

export type InferInsert<T extends TableDef<string, any>> = Prettify<
  { [K in RequiredKeys<T>]: InferColumn<Col<T, K>> } & {
    [K in OptionalKeys<T>]?: InferColumn<Col<T, K>>;
  }
>;

/**
 * example
 */
const users = table("users", {
  id: primaryKey(integer(2)),
  name: text("hello"),
  email: text(),
  age: nullable(integer()),
});

export type User = InferRow<typeof users>;
// //   ^? { id: number; name: string; email: string; age: number | null }

export type NewUser = InferInsert<typeof users>;
// //   ^? { name: string; email: string; age: number | null; id?: number }
