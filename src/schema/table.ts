import type { ColumnDef, SqlType } from "./columns.ts";

export interface TableDef<
  Name extends string,
  Cols extends Record<string, ColumnDef<SqlType, boolean, boolean, unknown, boolean, number>>,
> {
  readonly _name: Name;
  readonly _columns: Cols;
}

// Constraint у параметра `columns` намеренно ослаблен до `Record<string, unknown>`,
// потому что Record<string, ColumnDef<..., boolean, ...>> приводит к widening литералов
// _hasDefault: true|false до boolean при инференции C, что ломает InferInsert.
// Sanity-check формы колонок делается на возврате через conditional return type.
export const table = <N extends string, C extends Record<string, unknown>>(
  name: N,
  columns: C,
): TableDef<
  N,
  C extends Record<string, ColumnDef<SqlType, boolean, boolean, unknown, boolean, number>>
    ? C
    : never
> => ({
  _name: name,
  _columns: columns as never,
});
