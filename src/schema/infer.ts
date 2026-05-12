import type { ColumnDef } from "./columns.ts";
import type { TableDef } from "./table.ts";

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

// Insert-тип отличается: PK с автоинкрементом опциональные

export type InferInsert<T extends TableDef<string, any>> = {
  [K in keyof T["_columns"] as T["_columns"][K]["_pk"] extends true ? never : K]: InferColumn<
    T["_columns"][K]
  >;
} & {
  [K in keyof T["_columns"] as T["_columns"][K]["_pk"] extends true ? K : never]?: InferColumn<
    T["_columns"][K]
  >;
};

/**
 * example
 */
// const users = table("users", {
//   id: primaryKey(integer()),
//   name: text(),
//   email: text(),
//   age: nullable(integer()),
// });

// type User = InferRow<typeof users>;
// //   ^? { id: number; name: string; email: string; age: number | null }

// type NewUser = InferInsert<typeof users>;
// //   ^? { name: string; email: string; age: number | null; id?: number }
